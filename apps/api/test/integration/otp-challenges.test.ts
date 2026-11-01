import { randomBytes, randomInt } from 'node:crypto';
import type { CredentialsKeys } from '@eeasy-logistics/config';
import { createCredentialsCipher, Secret } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiException } from '../../src/modules/kernel/errors/api-exception.js';
import { OtpHasher, otpHmacKey } from '../../src/modules/kernel/messaging/otp-code.js';
import { OtpService } from '../../src/modules/kernel/messaging/otp.service.js';
import { OutboxWriter } from '../../src/modules/kernel/outbox/outbox-writer.js';
import { otpStore } from '../../src/modules/kernel/platform/otp-challenges.repository.js';
import {
  RateLimiter,
  redisRateLimitStore,
} from '../../src/modules/kernel/rate-limit/rate-limiter.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-9 item C on the real database and Redis (plan 2.4, 2.11; identity and tenancy §3.2, §8;
// data §2.1, §10): a request writes one challenge and one `message` outbox row with no code in
// clear; verification is single use under a row lock, capped at five attempts, and every failure is
// `otp_invalid`; the cooldown, the per-phone and per-address budgets keyed by the E.164 phone.

const config = integrationConfig();
const credentials: CredentialsKeys = {
  keys: { t1: new Secret(randomBytes(32).toString('base64')) },
  activeKeyId: 't1',
};
const cipher = createCredentialsCipher(credentials);
const hmacKey = otpHmacKey(credentials.keys.t1?.reveal() ?? '');
const prefix = `elx:rl-test:otp:${randomBytes(4).toString('hex')}`;

/** A fresh Saudi mobile number per test, so runs and tests never share a phone. */
const saudiMobile = () => `+96655${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
const nationalForm = (phone: string) => `0${phone.slice(4)}`;
const address = () => `198.51.100.${randomInt(1, 255)}`;

interface ChallengeRow {
  id: string;
  code_hash: Buffer;
  attempts: number;
  consumed_at: Date | null;
  ip: string | null;
  ttl: number;
}

interface OutboxRow {
  id: string;
  type: string;
  kind: string;
  status: string;
  account_id: string | null;
  supersede_key: string | null;
  aggregate_type: string;
  aggregate_id: string;
  payload: {
    channel: string;
    template: string;
    to: string;
    locale: string;
    challenge_id: string;
    params: { code: { encrypted: string } };
  };
}

describe('OtpService on the database (PLAT-9 item C)', () => {
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let limiter: RateLimiter;
  let available = true;
  const logs: string[] = [];
  const phones: string[] = [];
  let service: OtpService;

  const fresh = () => {
    const phone = saudiMobile();
    phones.push(phone);
    return phone;
  };
  const challenges = (phone: string) =>
    owner<ChallengeRow[]>`
      SELECT id, code_hash, attempts, consumed_at, host(ip) AS ip,
             extract(epoch from (expires_at - created_at))::int AS ttl
      FROM core_otp_challenges WHERE phone = ${phone} ORDER BY created_at, id`;
  const outboxRows = (phone: string) =>
    owner<OutboxRow[]>`
      SELECT id, type, kind, status, account_id, supersede_key, aggregate_type, aggregate_id::text,
             payload
      FROM core_outbox WHERE kind = 'message' AND payload->>'to' = ${phone} ORDER BY id`;
  /** The code a worker would send: decrypted from the row under the challenge's context. */
  const codeOf = (row: OutboxRow) =>
    cipher.decrypt(
      Buffer.from(row.payload.params.code.encrypted, 'base64'),
      `core_otp_challenges:${row.payload.challenge_id}`,
    );
  /** Moves a phone's challenges back past the 60 s cooldown. */
  const pastCooldown = (phone: string) =>
    owner`UPDATE core_otp_challenges SET created_at = created_at - interval '61 seconds'
          WHERE phone = ${phone}`;
  const request = (phone: string, ip = address()) =>
    service.request({ phone, purpose: 'driver_login', ip, locale: 'ar' });
  const verify = (phone: string, code: string) =>
    service.verify({ phone, purpose: 'driver_login', code });
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => 'resolved',
      (error: unknown) => (error instanceof ApiException ? error.code : String(error)),
    );

  beforeAll(() => {
    const redisUrl = config.redis.url?.reveal();
    if (redisUrl === undefined) throw new Error('REDIS_URL is required for this suite');
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'otp-challenges-test');
    limiter = new RateLimiter(redisRateLimitStore(redisUrl), { prefix });
    service = new OtpService({
      store: otpStore(pool.db),
      cipher,
      hasher: new OtpHasher(hmacKey, [hmacKey]),
      outbox: new OutboxWriter(),
      limiter,
      availability: { whatsappAvailable: () => Promise.resolve(available) },
      logger: { log: (line: string) => logs.push(line), warn: (line: string) => logs.push(line) },
    });
  });

  afterAll(async () => {
    if (phones.length > 0) {
      await owner`DELETE FROM core_outbox WHERE kind = 'message' AND payload->>'to' IN ${owner(phones)}`;
      await owner`DELETE FROM core_otp_challenges WHERE phone IN ${owner(phones)}`;
    }
    limiter.onApplicationShutdown();
    await Promise.all([owner.end(), pool.close()]);
  });

  it('writes one challenge and one message row, with the code nowhere in clear', async () => {
    const phone = fresh();
    const ip = address();
    await request(nationalForm(phone), ip);

    const [challenge, ...moreChallenges] = await challenges(phone);
    expect(moreChallenges).toEqual([]);
    expect(challenge).toMatchObject({ attempts: 0, consumed_at: null, ip, ttl: 300 });
    expect(challenge?.code_hash).toHaveLength(32);

    const [row, ...moreRows] = await outboxRows(phone);
    expect(moreRows).toEqual([]);
    expect(row).toMatchObject({
      type: 'core.otp_challenge.created',
      kind: 'message',
      status: 'pending',
      account_id: null,
      supersede_key: `otp:${phone}:driver_login`,
      aggregate_type: 'otp_challenge',
      aggregate_id: challenge?.id,
      payload: { channel: 'whatsapp', template: 'auth_otp', to: phone, locale: 'ar' },
    });
    const code = codeOf(row as OutboxRow);
    expect(code).toMatch(/^[0-9]{6}$/);
    expect(JSON.stringify(row?.payload)).not.toContain(code);
    expect(challenge?.code_hash.toString('hex')).not.toContain(Buffer.from(code).toString('hex'));
    // The code decrypts only under its own challenge's context.
    expect(() =>
      cipher.decrypt(
        Buffer.from(row?.payload.params.code.encrypted ?? '', 'base64'),
        'core_otp_challenges:019a0000-0000-7000-8000-000000000000',
      ),
    ).toThrow();

    const written = logs.join('\n');
    expect(written).not.toContain(code);
    expect(written).not.toContain(phone);
    expect(written).not.toContain(phone.slice(4));
    expect(written).toContain(`phone=…${phone.slice(-2)}`);
  });

  it('verifies once: the second use of the same code is otp_invalid', async () => {
    const phone = fresh();
    await request(phone);
    const code = codeOf((await outboxRows(phone))[0] as OutboxRow);
    await expect(verify(`+966 ${phone.slice(4, 6)} ${phone.slice(6)}`, code)).resolves.toEqual({
      phone,
    });
    expect(await failure(verify(phone, code))).toBe('otp_invalid');
    expect((await challenges(phone))[0]?.consumed_at).toBeInstanceOf(Date);
  });

  it('lets exactly one of two concurrent verifications succeed (row lock)', async () => {
    const phone = fresh();
    await request(phone);
    const code = codeOf((await outboxRows(phone))[0] as OutboxRow);
    // Both verifications start while another transaction holds the row, so both have read past
    // any check before either can write: only the lock makes the second see the first's consume.
    let pending: Promise<string>[] = [];
    await owner.begin(async (tx) => {
      await tx`SELECT id FROM core_otp_challenges WHERE phone = ${phone} FOR UPDATE`;
      pending = [failure(verify(phone, code)), failure(verify(phone, code))];
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    const outcomes = await Promise.all(pending);
    expect(outcomes.sort()).toEqual(['otp_invalid', 'resolved']);
  });

  it('invalidates the challenge after five wrong codes, the right one included', async () => {
    const phone = fresh();
    await request(phone);
    const code = codeOf((await outboxRows(phone))[0] as OutboxRow);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await failure(verify(phone, wrong))).toBe('otp_invalid');
    }
    expect((await challenges(phone))[0]?.attempts).toBe(5);
    expect(await failure(verify(phone, code))).toBe('otp_invalid');
    expect((await challenges(phone))[0]?.consumed_at).toBeNull();
  });

  it('answers otp_invalid for an expired code, an unknown phone, a malformed phone or code', async () => {
    const phone = fresh();
    await request(phone);
    const code = codeOf((await outboxRows(phone))[0] as OutboxRow);
    await owner`UPDATE core_otp_challenges SET expires_at = now() - interval '1 second'
                WHERE phone = ${phone}`;
    expect(await failure(verify(phone, code))).toBe('otp_invalid');
    expect(await failure(verify(fresh(), '123456'))).toBe('otp_invalid');
    expect(await failure(verify('not a phone', '123456'))).toBe('otp_invalid');
    expect(await failure(verify(phone, '12345'))).toBe('otp_invalid');
  });

  it('refuses a resend inside 60 s with 429 and Retry-After, and writes nothing', async () => {
    const phone = fresh();
    await request(phone);
    const refused = await request(nationalForm(phone)).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiException);
    const { code, options } = refused as ApiException;
    expect(code).toBe('rate_limited');
    const wait = Number(options.headers?.['Retry-After']);
    expect(wait).toBeGreaterThanOrEqual(55);
    expect(wait).toBeLessThanOrEqual(60);
    expect(options.details).toEqual({ retry_after_s: wait });
    expect(await challenges(phone)).toHaveLength(1);
    expect(await outboxRows(phone)).toHaveLength(1);
  });

  it('after the cooldown, a resend supersedes the unsent row and only the new code verifies', async () => {
    const phone = fresh();
    await request(phone);
    const first = (await outboxRows(phone))[0] as OutboxRow;
    await pastCooldown(phone);
    await request(phone);
    const rows = await outboxRows(phone);
    expect(rows.map((row) => row.status)).toEqual(['superseded', 'pending']);
    const firstCode = codeOf(first);
    const secondCode = codeOf(rows[1] as OutboxRow);
    if (firstCode !== secondCode) {
      expect(await failure(verify(phone, firstCode))).toBe('otp_invalid');
    }
    await expect(verify(phone, secondCode)).resolves.toEqual({ phone });
  });

  it('allows 5 requests per phone an hour, whatever the spelling (budget keyed by E.164)', async () => {
    const phone = fresh();
    const spellings = [phone, nationalForm(phone), `00${phone.slice(1)}`];
    for (let index = 0; index < 5; index += 1) {
      await request(spellings[index % spellings.length] ?? phone);
      await pastCooldown(phone);
    }
    expect(await failure(request(nationalForm(phone)))).toBe('rate_limited');
    expect(await challenges(phone)).toHaveLength(5);
  });

  it('allows 20 requests per address an hour', async () => {
    const ip = '203.0.113.77';
    for (let index = 0; index < 20; index += 1) await request(fresh(), ip);
    const phone = fresh();
    expect(await failure(request(phone, ip))).toBe('rate_limited');
    expect(await challenges(phone)).toHaveLength(0);
  });

  it('answers 503 messaging_unavailable while messaging is unavailable, writing nothing', async () => {
    const phone = fresh();
    available = false;
    try {
      expect(await failure(request(phone))).toBe('messaging_unavailable');
    } finally {
      available = true;
    }
    expect(await challenges(phone)).toHaveLength(0);
    expect(await outboxRows(phone)).toHaveLength(0);
  });

  it('refuses a malformed phone before any budget or row', async () => {
    const refused = await request('12').catch((error: unknown) => error);
    expect(refused).toMatchObject({
      code: 'validation_failed',
      options: { fields: [{ pointer: '/body/phone', code: 'invalid' }] },
    });
  });
});
