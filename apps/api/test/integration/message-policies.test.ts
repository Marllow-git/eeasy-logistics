import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { CredentialsKeys } from '@eeasy-logistics/config';
import { createCredentialsCipher, Secret } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuditWriter } from '../../src/modules/kernel/audit/audit-writer.js';
import type {
  MessageSender,
  SendTemplateInput,
} from '../../src/modules/kernel/messaging/message-sender.js';
import { MessageSenders } from '../../src/modules/kernel/messaging/message-sender.js';
import { redisCapCounter } from '../../src/modules/kernel/messaging/message-policies.js';
import type { MessagePolicies } from '../../src/modules/kernel/messaging/message.handler.js';
import { MessageKindHandler } from '../../src/modules/kernel/messaging/message.handler.js';
import type * as Templates from '../../src/modules/kernel/messaging/templates.js';
import { OptOutList } from '../../src/modules/kernel/messaging/opt-out-list.js';
import { accountSenderResolver } from '../../src/modules/kernel/messaging/sender-resolver.js';
import { ProviderFailure } from '../../src/modules/kernel/outbox/provider-failure.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { messagingStore } from '../../src/modules/kernel/platform/messaging.repository.js';
import type { OutboxJob } from '../../src/worker/system/outbox-workers.js';
import { processOutboxJob } from '../../src/worker/system/outbox-workers.js';
import { otpPurgeAuditAction, purgeOtpRows } from '../../src/worker/system/otp-purge.js';
import { auditRowsOf } from './audit-rows.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-9 item H on the real database and Redis (plan 2.5 to 2.8, 2.11; integrations §2.4, §4.3,
// §5.4 to §5.6): the send-time policies of the `message` handler and the OTP purge. Wave 0 has no
// recipient WhatsApp template yet, so this file adds two to the registry (one deferrable); the
// sender is a recording double, since the policies decide before any provider call.

vi.mock('../../src/modules/kernel/messaging/templates.js', async (importOriginal) => {
  const original = await importOriginal<typeof Templates>();
  const recipient = {
    channel: 'whatsapp',
    category: 'utility',
    params: ['name'],
    secretParams: [],
    deferrable: false,
    engineMessageType: 'shipment_issued',
  } as const;
  const messageTemplates = {
    ...original.messageTemplates,
    test_recipient: recipient,
    test_reminder: { ...recipient, deferrable: true },
  };
  return {
    ...original,
    messageTemplates,
    isTemplateKey: (value: unknown) =>
      typeof value === 'string' && Object.hasOwn(messageTemplates, value),
  };
});

const config = integrationConfig();
const credentials: CredentialsKeys = {
  keys: { t1: new Secret(randomBytes(32).toString('base64')) },
  activeKeyId: 't1',
};
const cipher = createCredentialsCipher(credentials);
const prefix = `elx-test-${randomBytes(4).toString('hex')}:msgcap`;
const quiet = { log: () => undefined, warn: () => undefined };
const platformRoute = { engineAccountId: 1, senderInstanceId: randomUUID() };
const phone = () => `+96657${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;

interface Stored {
  status: string;
  attempts: number;
  deferrals: number;
  last_error: string | null;
  next_attempt_at: Date;
}

describe('message policies on the database and Redis (PLAT-9 item H)', () => {
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let redis: Redis;
  const account = uuidv7();
  const rows: string[] = [];
  const sent: SendTemplateInput[] = [];
  let limit: number | undefined;
  let failNext = false;

  const sender: MessageSender = {
    channel: 'whatsapp',
    provider: 'engine',
    sendTemplate: (input) => {
      if (failNext) {
        return Promise.reject(
          new ProviderFailure('transient', 'refused for the test', { status: 503 }),
        );
      }
      sent.push(input);
      return Promise.resolve({
        providerMessageId: input.idempotencyKey,
        providerState: 'accepted',
      });
    },
    listTemplates: () => Promise.resolve([]),
  };
  const handlerWith = (policies: Partial<MessagePolicies> = {}) => {
    const store = messagingStore(pool.db);
    return new MessageKindHandler({
      senders: new MessageSenders({ whatsapp: sender, mail: null, platformRoute }),
      cipher,
      resolver: accountSenderResolver(store, platformRoute),
      policies: {
        optOuts: new OptOutList(store),
        caps: { counter: redisCapCounter(redis, prefix), pseudonymKey: Buffer.alloc(32, 5) },
        budget: {
          sentThisMonth: (id) => store.run((repo) => repo.sentThisMonth(id)),
          countSent: (id) => store.run((repo) => repo.countSent(id)),
          limitOf: () => Promise.resolve(limit),
        },
        ...policies,
      },
      logger: quiet,
    });
  };
  const plant = async (
    payload: Record<string, unknown>,
    accountId: string | null = account,
    extra: { createdAgoS?: number; attempts?: number } = {},
  ) => {
    const id = uuidv7();
    rows.push(id);
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind, status, attempts, created_at)
      VALUES (${id}, 'core.otp_challenge.created', 1, ${accountId}, 'otp_challenge', ${uuidv7()}, 1,
              ${owner.json(payload as postgres.JSONValue)}, 'message', 'enqueued', ${extra.attempts ?? 0},
              now() - make_interval(secs => ${extra.createdAgoS ?? 0}))`;
    return id;
  };
  const recipientRow = (to: string, extra: Record<string, unknown> = {}) =>
    plant({
      channel: 'whatsapp',
      template_key: 'test_recipient',
      to,
      locale: 'ar',
      params: { name: 'Sara' },
      ...extra,
    });
  const otpRow = (to: string, accountId: string | null, createdAgoS = 0, attempts = 0) => {
    const challenge = uuidv7();
    const blob = cipher.encrypt('246810', `core_otp_challenges:${challenge}`).blob;
    return plant(
      {
        channel: 'whatsapp',
        template_key: 'auth_otp',
        to,
        locale: 'en',
        challenge_id: challenge,
        params: { code: { encrypted: blob.toString('base64') } },
      },
      accountId,
      { createdAgoS, attempts },
    );
  };
  const run = (handler: MessageKindHandler, outboxId: string, now?: Date) => {
    const job = {
      data: { outboxId },
      moveToDelayed: vi.fn(() => Promise.resolve()),
      updateData: vi.fn(() => Promise.resolve()),
    } as unknown as OutboxJob;
    return processOutboxJob(
      {
        db: pool.db,
        registry: new KindHandlerRegistry([handler]),
        logger: quiet,
        random: () => 0.5,
        ...(now === undefined ? {} : { now: () => now }),
      },
      'message',
      job,
      'token',
    ).catch((error: unknown) => (error instanceof Error ? error.name : 'error'));
  };
  const stored = async (id: string) =>
    (
      await owner<Stored[]>`
        SELECT status, attempts, deferrals, last_error, next_attempt_at FROM core_outbox WHERE id = ${id}`
    )[0];
  const sentTo = (to: string) => sent.filter((input) => input.to === to);

  beforeAll(async () => {
    const redisUrl = config.redis.url?.reveal();
    if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
    redis = new Redis(redisUrl);
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'message-policies-test');
    await owner`INSERT INTO core_accounts (id, name, status) VALUES (${account}, 'policies', 'active')`;
    await owner`
      INSERT INTO core_messaging_senders (account_id, sender_instance_id)
      VALUES (${account}, ${randomUUID()})`;
  });

  afterAll(async () => {
    if (rows.length > 0) await owner`DELETE FROM core_outbox WHERE id IN ${owner(rows)}`;
    await owner`DELETE FROM core_messaging_opt_outs WHERE account_id = ${account}`;
    await owner`DELETE FROM core_messaging_usage WHERE account_id = ${account}`;
    await owner`DELETE FROM core_messaging_senders WHERE account_id = ${account}`;
    await owner`DELETE FROM core_accounts WHERE id = ${account}`;
    const left = await redis.keys(`${prefix}:*`);
    if (left.length > 0) await redis.del(...left);
    redis.disconnect();
    await Promise.all([owner.end(), pool.close()]);
  });

  it('sends a recipient message through the account’s own sender and counts it', async () => {
    const to = phone();
    const id = await recipientRow(to);
    expect(await run(handlerWith(), id)).toBe('done');
    expect(await stored(id)).toMatchObject({ status: 'done', last_error: null });
    const [input] = sentTo(to);
    expect(input?.route?.engineAccountId).toBeGreaterThanOrEqual(2);
    expect(input?.route?.senderInstanceId).not.toBe(platformRoute.senderInstanceId);
    const [usage] = await owner<{ sent: number }[]>`
      SELECT sent FROM core_messaging_usage WHERE account_id = ${account}`;
    expect(usage?.sent).toBeGreaterThanOrEqual(1);
  });

  it('skips a recipient message to an opted-out phone, and never an OTP to it', async () => {
    const to = phone();
    await new OptOutList(messagingStore(pool.db)).fromReply(account, to, ' إلغاء ');
    const recipient = await recipientRow(to);
    expect(await run(handlerWith(), recipient)).toBe('done');
    expect(await stored(recipient)).toMatchObject({
      status: 'done',
      last_error: 'skipped: opted_out',
    });
    const otp = await otpRow(to, account);
    expect(await run(handlerWith(), otp)).toBe('done');
    expect(await stored(otp)).toMatchObject({ status: 'done', last_error: null });
    expect(sentTo(to).map((input) => input.templateKey)).toEqual(['auth_otp']);
    expect(sentTo(to)[0]?.route).toEqual(platformRoute);
    // START reverses it.
    await new OptOutList(messagingStore(pool.db)).fromReply(account, to, 'START');
    expect(await run(handlerWith(), await recipientRow(to))).toBe('done');
    expect(sentTo(to).map((input) => input.templateKey)).toEqual(['auth_otp', 'test_recipient']);
  });

  it('caps a phone at 10 a day and an order at 6, never an OTP', async () => {
    const to = phone();
    const order = uuidv7();
    const handler = handlerWith();
    for (let index = 0; index < 6; index += 1) {
      expect(await run(handler, await recipientRow(to, { order_id: order }))).toBe('done');
    }
    const seventh = await recipientRow(to, { order_id: order });
    await run(handler, seventh);
    expect((await stored(seventh))?.last_error).toBe('skipped: cap_order');
    for (let index = 0; index < 4; index += 1) {
      expect(await run(handler, await recipientRow(to))).toBe('done');
    }
    const eleventh = await recipientRow(to);
    await run(handler, eleventh);
    expect((await stored(eleventh))?.last_error).toBe('skipped: cap_phone');
    expect(sentTo(to)).toHaveLength(10);
    const otp = await otpRow(to, account);
    await run(handler, otp);
    expect((await stored(otp))?.last_error).toBeNull();
  });

  it('skips recipient messages at the monthly budget, never an OTP', async () => {
    const to = phone();
    const handler = handlerWith();
    const [usage] = await owner<{ sent: number }[]>`
      SELECT sent FROM core_messaging_usage WHERE account_id = ${account}`;
    limit = usage?.sent ?? 0;
    try {
      const recipient = await recipientRow(to);
      await run(handler, recipient);
      expect((await stored(recipient))?.last_error).toBe('skipped: budget');
      const otp = await otpRow(to, account);
      await run(handler, otp);
      expect(await stored(otp)).toMatchObject({ status: 'done', last_error: null });
    } finally {
      limit = undefined;
    }
  });

  it('holds a deferrable template through the quiet hours without an attempt', async () => {
    const to = phone();
    const night = new Date('2026-11-01T20:00:00Z'); // 23:00 in Riyadh
    const handler = handlerWith({ now: () => night });
    const id = await recipientRow(to, { template_key: 'test_reminder' });
    expect(await run(handler, id, night)).toBe('DelayedError');
    const row = await stored(id);
    expect(row).toMatchObject({ status: 'enqueued', attempts: 0, deferrals: 1 });
    expect(row?.next_attempt_at.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(sentTo(to)).toHaveLength(0);
  });

  it('supersedes every row while messaging is disabled, OTP included', async () => {
    const to = phone();
    const handler = handlerWith({ disabled: true });
    const otp = await otpRow(to, null);
    expect(await run(handler, otp)).toBe('superseded');
    expect(await stored(otp)).toMatchObject({ status: 'superseded', last_error: 'disabled' });
    expect(sentTo(to)).toHaveLength(0);
  });

  it('supersedes an OTP row older than 4 minutes instead of sending it', async () => {
    const to = phone();
    const stale = await otpRow(to, null, 241);
    expect(await run(handlerWith(), stale)).toBe('superseded');
    expect(await stored(stale)).toMatchObject({ status: 'superseded', last_error: 'stale' });
    const fresh = await otpRow(to, null, 200);
    expect(await run(handlerWith(), fresh)).toBe('done');
    expect(sentTo(to)).toHaveLength(1);
  });

  it('gives OTP three attempts (the otp schedule), other messages five', async () => {
    failNext = true;
    try {
      const otp = await otpRow(phone(), null, 0, 2);
      await run(handlerWith(), otp);
      expect(await stored(otp)).toMatchObject({ status: 'dead', attempts: 3 });
      const other = await recipientRow(phone());
      await owner`UPDATE core_outbox SET attempts = 2 WHERE id = ${other}`;
      await run(handlerWith(), other);
      expect(await stored(other)).toMatchObject({ status: 'enqueued', attempts: 3 });
    } finally {
      failNext = false;
    }
  });
});

describe('OTP purge (PLAT-9 item H, plan 2.6)', () => {
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  const rows: string[] = [];

  const plant = async (
    status: string,
    doneAgoS: number | null,
    createdAgoS: number,
    template = 'auth_otp',
  ) => {
    const id = uuidv7();
    rows.push(id);
    await owner`
      INSERT INTO core_outbox (id, type, event_version, aggregate_type, aggregate_id, sequence,
                               payload, kind, status, done_at, created_at)
      VALUES (${id}, 'core.otp_challenge.created', 1, 'otp_challenge', ${uuidv7()}, 1,
              ${owner.json({ channel: 'whatsapp', template_key: template })}, 'message', ${status},
              ${doneAgoS === null ? null : owner`now() - make_interval(secs => ${doneAgoS})`},
              now() - make_interval(secs => ${createdAgoS}))`;
    return id;
  };

  beforeAll(() => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'otp-purge-test');
  });

  afterAll(async () => {
    if (rows.length > 0) await owner`DELETE FROM core_outbox WHERE id IN ${owner(rows)}`;
    await Promise.all([owner.end(), pool.close()]);
  });

  it('deletes OTP rows an hour after they finished, expired challenges and old nonces, with one audit row', async () => {
    const oldDone = await plant('done', 3_700, 3_800);
    const recentDone = await plant('done', 600, 700);
    const oldDead = await plant('dead', null, 3_700);
    const oldSuperseded = await plant('superseded', 3_650, 3_700);
    const otherTemplate = await plant('done', 3_700, 3_800, 'password_reset');
    const oldChallenge = uuidv7();
    const freshChallenge = uuidv7();
    for (const [id, ago] of [
      [oldChallenge, 3_700 + 300],
      [freshChallenge, 0],
    ] as const) {
      await owner`
        INSERT INTO core_otp_challenges (id, phone, purpose, code_hash, expires_at, created_at)
        VALUES (${id}, ${phone()}, 'driver_login', ${Buffer.alloc(32)},
                now() - make_interval(secs => ${ago - 300}), now() - make_interval(secs => ${ago}))`;
    }
    const oldNonce = randomBytes(16).toString('hex');
    const freshNonce = randomBytes(16).toString('hex');
    await owner`
      INSERT INTO core_engine_callback_nonces (service_identity, nonce, created_at) VALUES
        ('eeasy-whatsapp-engine', ${oldNonce}, now() - interval '25 hours'),
        ('eeasy-whatsapp-engine', ${freshNonce}, now())`;

    const runId = randomUUID();
    const counts = await purgeOtpRows(pool.db, new AuditWriter(pool), runId);

    const left = await owner<
      { id: string }[]
    >`SELECT id FROM core_outbox WHERE id IN ${owner(rows)}`;
    expect(left.map((row) => row.id).sort()).toEqual([recentDone, otherTemplate].sort());
    void oldDone;
    void oldDead;
    void oldSuperseded;
    const challenges = await owner<{ id: string }[]>`
      SELECT id FROM core_otp_challenges WHERE id IN (${oldChallenge}, ${freshChallenge})`;
    expect(challenges.map((row) => row.id)).toEqual([freshChallenge]);
    const nonces = await owner<{ nonce: string }[]>`
      SELECT nonce FROM core_engine_callback_nonces WHERE nonce IN (${oldNonce}, ${freshNonce})`;
    expect(nonces.map((row) => row.nonce)).toEqual([freshNonce]);
    expect(counts.messages).toBeGreaterThanOrEqual(3);
    expect(counts.challenges).toBeGreaterThanOrEqual(1);
    expect(counts.nonces).toBeGreaterThanOrEqual(1);

    const audit = await auditRowsOf(owner, runId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorType: 'system',
      accountId: null,
      action: otpPurgeAuditAction,
      targetType: 'otp_purge',
      after: counts,
    });
  });
});
