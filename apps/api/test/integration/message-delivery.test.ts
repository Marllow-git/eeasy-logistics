import { randomBytes, randomInt } from 'node:crypto';
import type { CredentialsKeys } from '@eeasy-logistics/config';
import { createCredentialsCipher, Secret } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryBreakerStateStore } from '../../src/modules/kernel/messaging/breaker.js';
import { BreakerSender } from '../../src/modules/kernel/messaging/breaker.js';
import { EngineMessageSender } from '../../src/modules/kernel/messaging/engine/engine-message-sender.js';
import type { MessageSender } from '../../src/modules/kernel/messaging/message-sender.js';
import { MessageSenders } from '../../src/modules/kernel/messaging/message-sender.js';
import type { SenderResolver } from '../../src/modules/kernel/messaging/message.handler.js';
import {
  MessageKindHandler,
  platformOnlyResolver,
} from '../../src/modules/kernel/messaging/message.handler.js';
import { OtpHasher, otpHmacKey } from '../../src/modules/kernel/messaging/otp-code.js';
import { OtpService } from '../../src/modules/kernel/messaging/otp.service.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { OutboxWriter } from '../../src/modules/kernel/outbox/outbox-writer.js';
import { otpStore } from '../../src/modules/kernel/platform/otp-challenges.repository.js';
import type { OutboxJob } from '../../src/worker/system/outbox-workers.js';
import { processOutboxJob } from '../../src/worker/system/outbox-workers.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-9 item F end to end on the real database and the stack's WhatsApp stub (plan 2A.1, 2A.7;
// exit criterion 1): an OTP requested through `OtpService` becomes a `message` row; the worker's
// processor runs the `message` handler, which decrypts the code and sends a signed
// `message.send.verification` through the engine adapter to the stub; the stub exposes the code,
// and it verifies once. Engine refusals and outages map to PLAT-8's outcomes.

const config = integrationConfig();
const credentials: CredentialsKeys = {
  keys: { t1: new Secret(randomBytes(32).toString('base64')) },
  activeKeyId: 't1',
};
const cipher = createCredentialsCipher(credentials);
const hmacKey = otpHmacKey(credentials.keys.t1?.reveal() ?? '');
const quiet = { log: () => undefined, warn: () => undefined };
const saudiMobile = () => `+96656${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;

interface Stored {
  status: string;
  attempts: number;
  deferrals: number;
  last_error: string | null;
}

/** The engine settings the suite needs from the environment (`.env` locally, CI's variables). */
function engineSettings() {
  const { stubUrl, engine } = config.messaging;
  const { serviceId, keyId, commandSecret, platformInstanceId } = engine;
  if (
    stubUrl === undefined ||
    serviceId === undefined ||
    keyId === undefined ||
    commandSecret === undefined ||
    platformInstanceId === undefined
  ) {
    throw new Error('MESSAGING_STUB_URL and the WHATSAPP_ENGINE_* variables are required');
  }
  return {
    stubUrl,
    key: { service: serviceId.reveal(), keyId: keyId.reveal(), secret: commandSecret.reveal() },
    route: { engineAccountId: 1, senderInstanceId: platformInstanceId },
  };
}

describe('message delivery through the engine adapter and the stub (PLAT-9 item F)', () => {
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let otp: OtpService;
  const phones: string[] = [];
  const settings = engineSettings();

  const fresh = () => {
    const phone = saudiMobile();
    phones.push(phone);
    return phone;
  };
  const adapter = (overrides: Partial<ConstructorParameters<typeof EngineMessageSender>[0]> = {}) =>
    new EngineMessageSender({
      provider: 'stub',
      appEnv: config.app.env,
      baseUrl: settings.stubUrl,
      key: settings.key,
      ...overrides,
    });
  const handlerWith = (whatsapp: MessageSender, resolver?: SenderResolver) => {
    const senders = new MessageSenders({ whatsapp, mail: null, platformRoute: settings.route });
    return new MessageKindHandler({
      senders,
      cipher,
      resolver: resolver ?? platformOnlyResolver(senders),
      logger: quiet,
    });
  };
  const rowOf = async (phone: string) => {
    const [row] = await owner<{ id: string; payload: { template_key: string } }[]>`
      SELECT id, payload FROM core_outbox WHERE kind = 'message' AND payload->>'to' = ${phone}
      ORDER BY id DESC LIMIT 1`;
    if (row === undefined) throw new Error('no message row');
    return row;
  };
  const stored = async (id: string) =>
    (
      await owner<
        Stored[]
      >`SELECT status, attempts, deferrals, last_error FROM core_outbox WHERE id = ${id}`
    )[0];
  const run = (handler: MessageKindHandler, outboxId: string) => {
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
      },
      'message',
      job,
      'token',
    ).catch((error: unknown) => (error instanceof Error ? error.name : 'error'));
  };
  const lastCode = async (phone: string) => {
    const response = await fetch(
      `${settings.stubUrl}/v1/last-code?to=${encodeURIComponent(phone)}`,
    );
    return response.status === 200
      ? ((await response.json()) as { code: string; eeasy_message_id: string; body: string })
      : undefined;
  };

  beforeAll(() => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'message-delivery-test');
    otp = new OtpService({
      store: otpStore(pool.db),
      cipher,
      hasher: new OtpHasher(hmacKey, [hmacKey]),
      outbox: new OutboxWriter(),
      limiter: undefined,
      availability: { whatsappAvailable: () => Promise.resolve(true) },
      logger: quiet,
    });
  });

  afterAll(async () => {
    if (phones.length > 0) {
      await owner`DELETE FROM core_outbox WHERE kind = 'message' AND payload->>'to' IN ${owner(phones)}`;
      await owner`DELETE FROM core_otp_challenges WHERE phone IN ${owner(phones)}`;
    }
    await Promise.all([owner.end(), pool.close()]);
  });

  it('sends a requested OTP through the stub; the code arrives, is in no row, and verifies once', async () => {
    const phone = fresh();
    await otp.request({ phone, purpose: 'driver_login', ip: '198.51.100.7', locale: 'en' });
    const row = await rowOf(phone);
    expect(row.payload.template_key).toBe('auth_otp');

    expect(await run(handlerWith(adapter()), row.id)).toBe('done');
    expect(await stored(row.id)).toMatchObject({ status: 'done', attempts: 0, last_error: null });

    const sent = await lastCode(phone);
    expect(sent?.eeasy_message_id).toBe(row.id);
    expect(sent?.code).toMatch(/^[0-9]{6}$/);
    expect(sent?.body).toContain('is your verification code');
    expect(JSON.stringify(row.payload)).not.toContain(sent?.code ?? 'none');

    await expect(
      otp.verify({ phone, purpose: 'driver_login', code: sent?.code ?? '' }),
    ).resolves.toEqual({ phone });
    await expect(
      otp.verify({ phone, purpose: 'driver_login', code: sent?.code ?? '' }),
    ).rejects.toMatchObject({ code: 'otp_invalid' });
  });

  it('parks a row the engine refuses for our signature, without an attempt', async () => {
    const phone = fresh();
    await otp.request({ phone, purpose: 'driver_login', ip: '198.51.100.8', locale: 'ar' });
    const row = await rowOf(phone);
    const wrongKey = adapter({
      key: { ...settings.key, secret: 'not-the-command-secret-0123456789abcdef' },
    });
    expect(await run(handlerWith(wrongKey), row.id)).toBe('DelayedError');
    expect(await stored(row.id)).toMatchObject({
      status: 'enqueued',
      attempts: 0,
      deferrals: 1,
      last_error: 'AUTH_BAD_SIGNATURE the engine refused our signature',
    });
    expect(await lastCode(phone)).toBeUndefined();
  });

  it('waits without an attempt while the engine answers 5xx, and the breaker opens after five', async () => {
    const breakers = memoryBreakerStateStore();
    const failing = new BreakerSender(adapter({ headers: { 'x-stub-fault': '500' } }), breakers, {
      logger: quiet,
    });
    const handler = handlerWith(failing);
    const statuses: string[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const phone = fresh();
      await otp.request({ phone, purpose: 'driver_login', ip: '198.51.100.9', locale: 'en' });
      const row = await rowOf(phone);
      expect(await run(handler, row.id)).toBe('DelayedError');
      const after = await stored(row.id);
      expect(after).toMatchObject({ status: 'enqueued', attempts: 0, deferrals: 1 });
      statuses.push(after?.last_error ?? '');
    }
    expect(statuses.slice(0, 5)).toEqual(
      Array(5).fill('ENGINE_UNAVAILABLE messaging unavailable; waiting'),
    );
    expect(statuses[5]).toBe('breaker_open messaging unavailable; waiting');
    expect(failing.state).toBe('open');
    expect(await breakers.isOpen('stub')).toBe(true);
  });

  it('skips an account message with no linked sender as done, sending nothing', async () => {
    const phone = fresh();
    await otp.request({ phone, purpose: 'driver_login', ip: '198.51.100.10', locale: 'en' });
    const row = await rowOf(phone);
    const handler = handlerWith(adapter(), { resolve: () => Promise.resolve('no_sender') });
    expect(await run(handler, row.id)).toBe('done');
    expect(await stored(row.id)).toMatchObject({
      status: 'done',
      last_error: 'skipped: no_sender',
    });
    expect(await lastCode(phone)).toBeUndefined();
  });
});
