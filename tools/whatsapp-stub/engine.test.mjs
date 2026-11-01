// Run with: node --test tools/whatsapp-stub/
// The stub's engine door (PLAT-9 plan 2A.7): signed commands verified in the contract's order,
// dedupe by idempotency key, message.status, the last code per phone, signed callbacks.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import {
  callbackPath,
  canonical,
  commandPath,
  instant,
  sha256,
  sign,
  signedHeaders,
} from './engine.mjs';
import { createStub } from './server.mjs';

const settings = {
  serviceId: 'eeasy-laravel-control-plane',
  keyId: 'test-command',
  commandSecret: 'fake-command-secret-0123456789abcdef0123',
  callbackKeyId: 'test-callback',
  callbackSecret: 'fake-callback-secret-0123456789abcdef012',
};
const key = { service: settings.serviceId, keyId: settings.keyId, secret: settings.commandSecret };
const instance = '00000000-0000-4000-8000-000000000001';

let dir;
let stub;
let base;
let receiver;
const received = [];

function verification(id, to, overrides = {}) {
  return {
    command: 'message.send.verification',
    eeasy_account_id: 1,
    eeasy_store_id: null,
    sender_instance_id: instance,
    eeasy_message_id: id,
    message_type: 'verification',
    priority_class: 1,
    expires_at: instant(Date.now() + 600_000),
    idempotency_key: id,
    payload: {
      to_number: to,
      body: `123456 is your code`,
      locale: 'en',
      lane_key: to,
      suppression_check: false,
    },
    ...overrides,
  };
}

function command(envelope, headers = {}) {
  const raw = JSON.stringify(envelope);
  return fetch(`${base}${commandPath}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...signedHeaders(key, commandPath, raw),
      ...headers,
    },
    body: raw,
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'whatsapp-stub-engine-'));
  receiver = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({
        headers: req.headers,
        path: req.url,
        raw: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  stub = createStub({
    logPath: join(dir, 'sent.jsonl'),
    engine: { ...settings, callbackBase: `http://127.0.0.1:${receiver.address().port}` },
  });
  await new Promise((resolve) => stub.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${stub.server.address().port}`;
});

after(async () => {
  await stub.close();
  await new Promise((resolve) => receiver.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

test('accepts a signed verification, records it and exposes the code', async () => {
  const id = randomUUID();
  const res = await command(verification(id, '+966500000101'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.status, 'accepted');
  assert.equal(body.result.duplicate, false);
  const last = await (
    await fetch(`${base}/v1/last-code?to=${encodeURIComponent('+966500000101')}`)
  ).json();
  assert.equal(last.code, '123456');
  assert.equal(last.eeasy_message_id, id);
});

test('answers a repeated idempotency key with the original message, sending nothing twice', async () => {
  const id = randomUUID();
  await command(verification(id, '+966500000102'));
  const again = await (await command(verification(id, '+966500000102'))).json();
  assert.equal(again.result.duplicate, true);
  const sent = await (await fetch(`${base}/sent`)).json();
  assert.equal(sent.filter((r) => r.id === id).length, 1);
});

test('message.status knows an accepted message and not an unknown one', async () => {
  const id = randomUUID();
  await command(verification(id, '+966500000103'));
  const status = (target) =>
    command({
      ...verification(target, '+966500000103'),
      command: 'message.status',
      message_type: null,
      priority_class: null,
      expires_at: null,
      idempotency_key: null,
      payload: {},
    }).then((r) => r.json());
  assert.equal((await status(id)).result.exists, true);
  assert.equal((await status(randomUUID())).result.exists, false);
});

test('refuses in the contract order: service, key, timestamp, shape, signature, body, nonce', async () => {
  const envelope = verification(randomUUID(), '+966500000104');
  const raw = JSON.stringify(envelope);
  const good = signedHeaders(key, commandPath, raw);
  const codeOf = async (headers, body = raw) => {
    const res = await fetch(`${base}${commandPath}`, { method: 'POST', headers, body });
    return [res.status, (await res.json()).error?.code];
  };
  assert.deepEqual(await codeOf({ ...good, 'x-eeasy-service': 'someone' }), [
    401,
    'AUTH_UNKNOWN_SERVICE',
  ]);
  assert.deepEqual(await codeOf({ ...good, 'x-eeasy-key-id': 'old' }), [401, 'AUTH_UNKNOWN_KEY']);
  assert.deepEqual(await codeOf({ ...good, 'x-eeasy-timestamp': instant(Date.now() - 120_000) }), [
    401,
    'AUTH_STALE_TIMESTAMP',
  ]);
  assert.deepEqual(await codeOf({ ...good, 'x-eeasy-nonce': 'NOT-HEX' }), [
    401,
    'AUTH_MALFORMED_HEADER',
  ]);
  const forged = sign(
    canonical(
      'POST',
      commandPath,
      key.service,
      key.keyId,
      good['x-eeasy-timestamp'],
      good['x-eeasy-nonce'],
      good['x-eeasy-body-sha256'],
    ),
    'a-different-secret-0123456789abcdef0123',
  );
  assert.deepEqual(await codeOf({ ...good, 'x-eeasy-signature': forged }), [
    401,
    'AUTH_BAD_SIGNATURE',
  ]);
  assert.deepEqual(await codeOf(good, raw.replace('123456', '654321')), [
    401,
    'AUTH_BODY_HASH_MISMATCH',
  ]);
  assert.equal((await codeOf(good))[0], 200);
  assert.deepEqual(await codeOf(good), [401, 'AUTH_REPLAYED_NONCE']);
});

test('refuses a wrong priority, a 24-hour OTP and a URL in the payload', async () => {
  const refused = async (overrides) =>
    (await (await command(verification(randomUUID(), '+966500000105', overrides))).json()).error
      .code;
  assert.equal(await refused({ priority_class: 2 }), 'PRIORITY_MISMATCH');
  assert.equal(await refused({ expires_at: instant(Date.now() + 86_400_000) }), 'EXPIRY_MISMATCH');
  const payload = verification(randomUUID(), '+966500000105').payload;
  assert.equal(
    await refused({ payload: { ...payload, body: 'https://evil.test/x' } }),
    'PAYLOAD_URL_FORBIDDEN',
  );
  assert.equal(
    await refused({ payload: { ...payload, suppression_check: true } }),
    'SCHEMA_INVALID',
  );
});

test('posts signed sent and delivered callbacks for an accepted send', async () => {
  received.length = 0;
  const id = randomUUID();
  await command(verification(id, '+966500000106'));
  await stub.settle();
  const mine = received
    .map((r) => ({ ...r, body: JSON.parse(r.raw) }))
    .filter((r) => r.body.eeasy_message_id === id);
  assert.deepEqual(
    mine.map((r) => r.body.status),
    ['sent', 'delivered'],
  );
  for (const callback of mine) {
    const h = callback.headers;
    assert.equal(callback.path, callbackPath);
    assert.equal(h['x-eeasy-service'], 'eeasy-whatsapp-engine');
    assert.equal(h['x-eeasy-key-id'], settings.callbackKeyId);
    assert.equal(h['x-eeasy-body-sha256'], sha256(callback.raw));
    const expected = sign(
      canonical(
        'POST',
        callbackPath,
        h['x-eeasy-service'],
        h['x-eeasy-key-id'],
        h['x-eeasy-timestamp'],
        h['x-eeasy-nonce'],
        h['x-eeasy-body-sha256'],
      ),
      settings.callbackSecret,
    );
    assert.equal(h['x-eeasy-signature'], expected);
  }
});
