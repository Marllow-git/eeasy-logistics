// Run with: node --test tools/whatsapp-stub/server.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createStub } from './server.mjs';

let dir;
let stub;
let base;

async function start() {
  stub = createStub({ logPath: join(dir, 'sent.jsonl') });
  await new Promise((resolve) => stub.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${stub.server.address().port}`;
}

function post(body, headers = {}) {
  return fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'whatsapp-stub-test-'));
  await start();
});

after(async () => {
  await stub.close();
  rmSync(dir, { recursive: true, force: true });
});

test('health answers ok', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
});

test('a POST is recorded, logged and listed by GET /sent', async () => {
  const res = await post({ to: '+966500000001', text: 'OTP 123456' });
  assert.equal(res.status, 200);
  const { id } = await res.json();

  const sent = await (await fetch(`${base}/sent`)).json();
  const record = sent.find((r) => r.id === id);
  assert.deepEqual(record.body, { to: '+966500000001', text: 'OTP 123456' });
  assert.equal(record.path, '/v1/messages');

  const logged = readFileSync(join(dir, 'sent.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.ok(logged.some((r) => r.id === id));
});

test('sends survive a restart through the log', async () => {
  const { id } = await (await post({ to: '+966500000002' })).json();
  await stub.close();
  await start();
  const sent = await (await fetch(`${base}/sent`)).json();
  assert.ok(sent.some((r) => r.id === id));
});

test('DELETE /sent clears the list and the log', async () => {
  await post({ to: '+966500000003' });
  assert.equal((await fetch(`${base}/sent`, { method: 'DELETE' })).status, 204);
  assert.deepEqual(await (await fetch(`${base}/sent`)).json(), []);
  assert.equal(readFileSync(join(dir, 'sent.jsonl'), 'utf8'), '');
});

test('fault header returns the status and records nothing', async () => {
  await fetch(`${base}/sent`, { method: 'DELETE' });
  const limited = await post({ to: '+966500000004' }, { 'x-stub-fault': '429' });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1');
  assert.equal((await post({}, { 'x-stub-fault': '500' })).status, 500);
  assert.equal((await post({}, { 'x-stub-fault': '401' })).status, 401);
  assert.equal((await post({}, { 'x-stub-fault': 'bogus' })).status, 400);
  assert.deepEqual(await (await fetch(`${base}/sent`)).json(), []);
});

test('latency fault delays, then records', async () => {
  const started = Date.now();
  const res = await post({ to: '+966500000005' }, { 'x-stub-fault': 'latency=150' });
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started >= 140);
});

test('timeout fault never answers', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 200);
  await assert.rejects(
    fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: { 'x-stub-fault': 'timeout' },
      body: '{}',
      signal: controller.signal,
    }),
    { name: 'AbortError' },
  );
  clearTimeout(timer);
});

test('invalid JSON and wrong methods are rejected', async () => {
  const bad = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`${base}/v1/messages`, { method: 'PUT', body: '' })).status, 405);
});
