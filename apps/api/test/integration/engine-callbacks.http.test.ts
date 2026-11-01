import { randomBytes, randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttp, createHttpAdapter, httpAppOptions } from '../../src/http-app.js';
import {
  engineCallbackPath,
  engineServiceIdentity,
  signedHeaders,
  wireInstant,
} from '../../src/modules/kernel/messaging/engine/envelope.js';
import { accountSenderResolver } from '../../src/modules/kernel/messaging/sender-resolver.js';
import { messagingStore } from '../../src/modules/kernel/platform/messaging.repository.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-9 item G on the real app and database (plan 2A.2 to 2A.4; engine contract §2.3, §5): the
// callback door's fixed verification order (an unauthenticated request costs no body byte), the
// nonce table, dedupe by callback id, binding to our own account mapping, the monotonic message
// state, opt-outs from `suppression.changed`, sender state from `connection.event`, and the
// resolver's mapping (platform instance for OTP only, an account's own sender, else `no_sender`).

const callbackKey = {
  service: engineServiceIdentity,
  keyId: 'test-callback',
  secret: `fake-callback-secret-${randomBytes(12).toString('hex')}`,
};
const platformInstance = randomUUID();
const config = integrationConfig({
  WHATSAPP_ENGINE_CALLBACK_KEY_ID: callbackKey.keyId,
  WHATSAPP_ENGINE_CALLBACK_SECRET: callbackKey.secret,
  WHATSAPP_ENGINE_PLATFORM_INSTANCE_ID: platformInstance,
});

type Body = Record<string, unknown>;

describe('engine callback door (PLAT-9 item G)', () => {
  let app: NestExpressApplication;
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  const account = uuidv7();
  const accountInstance = randomUUID();
  let engineAccountId = 0;
  const rows: string[] = [];

  const http = () => request(app.getHttpServer());
  const post = (body: Body, headers: Record<string, string> = {}, raw?: string) => {
    const text = raw ?? JSON.stringify(body);
    return http()
      .post(engineCallbackPath)
      .set('content-type', 'application/json; charset=utf-8')
      .set({
        ...signedHeaders(callbackKey, 'POST', engineCallbackPath, JSON.stringify(body)),
        ...headers,
      })
      .send(text);
  };
  const status = (id: string, state: string, at: number, extra: Body = {}): Body => ({
    callback: 'message.status',
    eeasy_account_id: 1,
    eeasy_store_id: null,
    sender_instance_id: platformInstance,
    eeasy_message_id: id,
    message_type: 'verification',
    status: state,
    previous_status: null,
    occurred_at: wireInstant(at),
    wire_message_id: '3EB0AA',
    ack: null,
    attempt: 1,
    accept_seq: 1,
    error: null,
    callback_id: randomUUID(),
    ...extra,
  });
  const plantMessage = async (accountId: string | null) => {
    const id = uuidv7();
    rows.push(id);
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind, status)
      VALUES (${id}, 'core.otp_challenge.created', 1, ${accountId}, 'otp_challenge', ${uuidv7()}, 1,
              ${owner.json({ channel: 'whatsapp', template_key: 'auth_otp' })}, 'message', 'done')`;
    return id;
  };
  /** Sends the headers of a POST and never its body; the status, or 'no answer' after 500 ms. */
  const headersOnly = async (headers: Record<string, string>, contentLength: number) => {
    const server = app.getHttpServer();
    if (!server.listening) {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    }
    const { port } = server.address() as AddressInfo;
    return new Promise<number | 'no answer'>((resolve) => {
      const req = httpRequest({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: engineCallbackPath,
        headers: {
          'content-type': 'application/json',
          'content-length': String(contentLength),
          ...headers,
        },
      });
      const timer = setTimeout(() => {
        req.destroy();
        resolve('no answer');
      }, 500);
      req.on('response', (res) => {
        clearTimeout(timer);
        res.resume();
        resolve(res.statusCode ?? 0);
        req.destroy();
      });
      req.on('error', () => undefined);
      req.flushHeaders();
    });
  };
  const stateOf = async (id: string) =>
    (
      await owner<{ provider_state: string | null }[]>`
      SELECT provider_state FROM core_outbox WHERE id = ${id}`
    )[0]?.provider_state;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'engine-callbacks-test');
    await owner`INSERT INTO core_accounts (id, name, status) VALUES (${account}, 'callbacks', 'active')`;
    await owner`
      INSERT INTO core_messaging_senders (account_id, sender_instance_id)
      VALUES (${account}, ${accountInstance})`;
    const route = await accountSenderResolver(messagingStore(pool.db), null).resolve(
      account,
      'invitation',
    );
    if (route === 'no_sender') throw new Error('the account has a sender');
    engineAccountId = route.engineAccountId;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>(createHttpAdapter(config), {
      ...httpAppOptions,
      logger: false,
    });
    configureHttp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (rows.length > 0) await owner`DELETE FROM core_outbox WHERE id IN ${owner(rows)}`;
    await owner`DELETE FROM core_messaging_opt_outs WHERE account_id = ${account}`;
    await owner`DELETE FROM core_messaging_senders WHERE account_id = ${account}`;
    await owner`DELETE FROM core_accounts WHERE id = ${account}`;
    await Promise.all([owner.end(), pool.close()]);
  });

  it('refuses in the contract order, each with its class', async () => {
    const body = status(randomUUID(), 'sent', Date.now());
    const code = async (headers: Record<string, string>) => {
      const response = await post(body, headers);
      return [response.status, (response.body as { error?: { code?: string } }).error?.code];
    };
    expect(await code({ 'x-eeasy-service': 'eeasy-laravel-control-plane' })).toEqual([
      401,
      'AUTH_UNKNOWN_SERVICE',
    ]);
    expect(await code({ 'x-eeasy-key-id': 'old-key' })).toEqual([401, 'AUTH_UNKNOWN_KEY']);
    expect(await code({ 'x-eeasy-timestamp': wireInstant(Date.now() - 61_000) })).toEqual([
      401,
      'AUTH_STALE_TIMESTAMP',
    ]);
    expect(await code({ 'x-eeasy-nonce': 'NOT-A-NONCE' })).toEqual([401, 'AUTH_MALFORMED_HEADER']);
    expect(await code({ 'x-eeasy-signature': `v1=${'0'.repeat(64)}` })).toEqual([
      401,
      'AUTH_BAD_SIGNATURE',
    ]);
    // A signature over a different claimed hash: the signature fails first.
    expect(await code({ 'x-eeasy-body-sha256': 'f'.repeat(64) })).toEqual([
      401,
      'AUTH_BAD_SIGNATURE',
    ]);
    // A signed claim the body does not match.
    const tampered = await post(body, {}, JSON.stringify({ ...body, status: 'read' }));
    expect([tampered.status, (tampered.body as { error: { code: string } }).error.code]).toEqual([
      401,
      'AUTH_BODY_HASH_MISMATCH',
    ]);
  });

  it('refuses an oversized declared body before anything else (413)', async () => {
    const body = JSON.stringify(status(randomUUID(), 'sent', Date.now()));
    const good = signedHeaders(callbackKey, 'POST', engineCallbackPath, body);
    expect(await headersOnly(good, 262_145)).toBe(413);
    expect(await headersOnly({ ...good, 'x-eeasy-service': 'someone' }, 262_145)).toBe(413);
  });

  it('answers a bad signature without reading the body; a good one waits for it', async () => {
    const body = JSON.stringify(status(randomUUID(), 'sent', Date.now()));
    const good = signedHeaders(callbackKey, 'POST', engineCallbackPath, body);
    const length = Buffer.byteLength(body);
    expect(
      await headersOnly({ ...good, 'x-eeasy-signature': `v1=${'0'.repeat(64)}` }, length),
    ).toBe(401);
    expect(await headersOnly(good, length)).toBe('no answer');
  });

  it('applies a message status once, monotonically, and refuses a replayed nonce', async () => {
    const id = await plantMessage(null);
    const now = Date.now();
    const sent = status(id, 'sent', now - 3_000);
    const headers = signedHeaders(callbackKey, 'POST', engineCallbackPath, JSON.stringify(sent));
    await post(sent, headers).expect(200, { ok: true });
    expect(await stateOf(id)).toBe('sent');
    const replay = await post(sent, headers).expect(401);
    expect((replay.body as { error: { code: string } }).error.code).toBe('AUTH_REPLAYED_NONCE');
    const [nonce] = await owner<{ callback_id: string }[]>`
      SELECT callback_id FROM core_engine_callback_nonces
      WHERE service_identity = ${engineServiceIdentity} AND nonce = ${headers['x-eeasy-nonce'] ?? ''}`;
    expect(nonce?.callback_id).toBe(sent.callback_id);

    await post(status(id, 'read', now - 1_000)).expect(200);
    expect(await stateOf(id)).toBe('read');
    // A late `delivered` never lowers the rank.
    await post(status(id, 'delivered', now)).expect(200);
    expect(await stateOf(id)).toBe('read');
    // The same callback id again (a redelivery, fresh nonce) is acknowledged and not re-applied.
    const failed = status(id, 'failed', now, { callback_id: sent.callback_id });
    await post(failed).expect(200, { ok: true });
    expect(await stateOf(id)).toBe('read');
  });

  it('binds by our mapping: a wrong account id for the instance is 422, nothing applied', async () => {
    const id = await plantMessage(null);
    const response = await post(status(id, 'sent', Date.now(), { eeasy_account_id: 7 })).expect(
      422,
    );
    expect((response.body as { error: { code: string } }).error.code).toBe('BINDING_MISMATCH');
    expect(await stateOf(id)).toBeNull();
    // A platform instance's callback for an account's row is refused too.
    const accountRow = await plantMessage(account);
    await post(status(accountRow, 'sent', Date.now())).expect(422);
    expect(await stateOf(accountRow)).toBeNull();
    // The account's own instance, under the account's own engine id, applies.
    await post(
      status(accountRow, 'sent', Date.now(), {
        sender_instance_id: accountInstance,
        eeasy_account_id: engineAccountId,
      }),
    ).expect(200);
    expect(await stateOf(accountRow)).toBe('sent');
  });

  it('acknowledges a status for a purged row and a callback of an unknown instance', async () => {
    await post(status(uuidv7(), 'read', Date.now())).expect(200, { ok: true });
    await post(
      status(uuidv7(), 'read', Date.now(), {
        sender_instance_id: randomUUID(),
        eeasy_account_id: 99,
      }),
    ).expect(200, { ok: true });
  });

  it('feeds opt-outs from suppression.changed of an account sender, never of the platform', async () => {
    const phone = '+966500000777';
    const suppression = (suppressed: boolean, instance: string, engineId: number): Body => ({
      callback: 'suppression.changed',
      eeasy_account_id: engineId,
      sender_instance_id: instance,
      customer_number: phone,
      suppressed,
      term_class: suppressed ? 'stop' : 'start',
      occurred_at: wireInstant(Date.now()),
      callback_id: randomUUID(),
    });
    const optOuts = () =>
      owner<{ source: string }[]>`
        SELECT source FROM core_messaging_opt_outs WHERE account_id = ${account} AND phone = ${phone}`;
    await post(suppression(true, accountInstance, engineAccountId)).expect(200);
    expect(await optOuts()).toEqual([{ source: 'provider' }]);
    await post(suppression(false, accountInstance, engineAccountId)).expect(200);
    expect(await optOuts()).toEqual([]);
    await post(suppression(true, platformInstance, 1)).expect(200);
    expect(await owner`SELECT 1 FROM core_messaging_opt_outs WHERE phone = ${phone}`).toHaveLength(
      0,
    );
  });

  it('records a sender’s connection state in event order', async () => {
    const event = (name: string, at: number): Body => ({
      callback: 'connection.event',
      eeasy_account_id: engineAccountId,
      eeasy_store_id: null,
      sender_instance_id: accountInstance,
      event: name,
      desired_state: 'running',
      code: 401,
      reason: 'logged_out_from_device',
      action: 'await_operator_relink',
      corroborated: true,
      occurred_at: wireInstant(at),
      callback_id: randomUUID(),
    });
    const now = Date.now();
    await post(event('needs_relink', now - 1_000)).expect(200);
    await post(event('connected', now - 5_000)).expect(200);
    const [sender] = await owner<{ status: string }[]>`
      SELECT status FROM core_messaging_senders WHERE account_id = ${account}`;
    expect(sender?.status).toBe('needs_relink');
  });

  it('answers 400 for an unknown kind and 200 for inbound.message', async () => {
    const base = {
      eeasy_account_id: 1,
      sender_instance_id: platformInstance,
      occurred_at: wireInstant(Date.now()),
      callback_id: randomUUID(),
    };
    await post({ ...base, callback: 'message.reaction' }).expect(400);
    await post({ ...base, callback: 'inbound.message', callback_id: randomUUID() }).expect(200, {
      ok: true,
    });
    await post({ ...base, callback: 'message.status', callback_id: randomUUID() }).expect(422);
  });
});

describe('sender resolution (PLAT-9 item G, plan 2A.3 and 2A.4)', () => {
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  const linked = uuidv7();
  const unlinked = uuidv7();
  const platformRoute = { engineAccountId: 1, senderInstanceId: randomUUID() };

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'sender-resolution-test');
    for (const id of [linked, unlinked]) {
      await owner`INSERT INTO core_accounts (id, name, status) VALUES (${id}, 'resolution', 'active')`;
    }
    await owner`
      INSERT INTO core_messaging_senders (account_id, sender_instance_id)
      VALUES (${linked}, ${randomUUID()})`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core_messaging_senders WHERE account_id = ${linked}`;
    await owner`DELETE FROM core_accounts WHERE id IN (${linked}, ${unlinked})`;
    await Promise.all([owner.end(), pool.close()]);
  });

  it('gives OTP the platform instance, an account its own sender, and no account the platform’s', async () => {
    const resolver = accountSenderResolver(messagingStore(pool.db), platformRoute);
    expect(await resolver.resolve(null, 'auth_otp')).toEqual(platformRoute);
    expect(await resolver.resolve(unlinked, 'invitation')).toBe('no_sender');
    const first = await resolver.resolve(linked, 'invitation');
    const second = await resolver.resolve(linked, 'invitation');
    expect(first).not.toBe('no_sender');
    expect(first).toEqual(second);
    if (first === 'no_sender') return;
    expect(first.engineAccountId).toBeGreaterThanOrEqual(2);
    expect(first.senderInstanceId).not.toBe(platformRoute.senderInstanceId);
    const [stored] = await owner<{ engine_account_id: string }[]>`
      SELECT engine_account_id FROM core_accounts WHERE id = ${linked}`;
    expect(Number(stored?.engine_account_id)).toBe(first.engineAccountId);
    // An account that never sent has no engine id allocated.
    const [none] = await owner<{ engine_account_id: string | null }[]>`
      SELECT engine_account_id FROM core_accounts WHERE id = ${unlinked}`;
    expect(none?.engine_account_id).toBeNull();
  });

  it('refuses a second account on one instance and an engine id below 2', async () => {
    const [row] = await owner<{ sender_instance_id: string }[]>`
      SELECT sender_instance_id FROM core_messaging_senders WHERE account_id = ${linked}`;
    await expect(
      owner`INSERT INTO core_messaging_senders (account_id, sender_instance_id)
            VALUES (${unlinked}, ${row?.sender_instance_id ?? ''})`,
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      owner`UPDATE core_accounts SET engine_account_id = 1 WHERE id = ${unlinked}`,
    ).rejects.toMatchObject({ code: '23514' });
  });
});
