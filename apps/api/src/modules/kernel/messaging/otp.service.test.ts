import { defineConfig } from '@eeasy-logistics/config';
import type { EnvRecord } from '@eeasy-logistics/config';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '../errors/api-exception.js';
import { namedBudgets, namedBudgetsWith } from '../rate-limit/budgets.js';
import { getMetrics } from '../telemetry/metrics.js';
import type { OtpStore } from '../platform/otp-challenges.repository.js';
import { memoryBreakerStateStore } from './breaker.js';
import { OtpHasher, otpHmacKey } from './otp-code.js';
import { MessagingAvailability, OtpService } from './otp.service.js';
import { createMessageSenders } from './senders.js';

// PLAT-9 review round 1: availability comes from the senders this build has (finding 2), and a
// malformed phone on verification is refused before any transaction (finding 3).

const quiet = { warn: () => undefined, log: () => undefined };

function availability(env: EnvRecord, open = false) {
  const breakers = memoryBreakerStateStore();
  const config = defineConfig({ APP_ENV: 'local', ...env });
  const senders = createMessageSenders(config, { breakerStore: breakers, logger: quiet });
  return {
    breakers,
    check: async () => {
      if (open) await breakers.markOpen('stub', 30_000);
      return new MessagingAvailability(
        config.messaging.disabled,
        senders,
        breakers,
      ).whatsappAvailable();
    },
  };
}

describe('MessagingAvailability (review round 1, finding 2)', () => {
  const signing = {
    WHATSAPP_ENGINE_SERVICE_ID: 'eeasy-laravel-control-plane',
    WHATSAPP_ENGINE_KEY_ID: 'test-command',
    WHATSAPP_ENGINE_COMMAND_SECRET: 'fake-command-secret-0123456789abcdef0123',
    WHATSAPP_ENGINE_PLATFORM_INSTANCE_ID: '00000000-0000-4000-8000-000000000001',
  };
  const stub = {
    MESSAGING_PROVIDER: 'stub',
    MESSAGING_STUB_URL: 'http://127.0.0.1:8080',
    ...signing,
  };

  it('is available with a built WhatsApp sender and its breaker closed', async () => {
    expect(await availability(stub).check()).toBe(true);
  });

  it('is unavailable while that sender’s breaker is open', async () => {
    expect(await availability(stub, true).check()).toBe(false);
  });

  it('is unavailable while messaging is paused', async () => {
    expect(await availability({ ...stub, MESSAGING_DISABLED: 'true' }).check()).toBe(false);
  });

  it.each([
    ['the stub without its URL', { MESSAGING_PROVIDER: 'stub', ...signing }],
    [
      'the stub without its signing secret',
      { MESSAGING_PROVIDER: 'stub', MESSAGING_STUB_URL: 'http://127.0.0.1:8080' },
    ],
  ])(
    'is unavailable with a provider configured but no sender in this build: %s',
    async (_name, env) => {
      expect(await availability(env).check()).toBe(false);
    },
  );
});

describe('OtpService.request budgets (review round 2, finding 2)', () => {
  it('charges the phone budget first, so a phone out of budget never charges the address', async () => {
    const charged: string[] = [];
    const charge = vi.fn((name: string) => {
      charged.push(name);
      return name === 'otp_request_phone'
        ? Promise.reject(new ApiException('rate_limited'))
        : Promise.resolve();
    });
    const challenges = {
      lockPhone: vi.fn(() => Promise.resolve()),
      cooldownLeft: vi.fn(() => Promise.resolve(0)),
      insert: vi.fn(() => Promise.resolve()),
    };
    const key = otpHmacKey(Buffer.alloc(32, 7).toString('base64'));
    const service = new OtpService({
      store: {
        run: ((fn: (tx: unknown) => Promise<unknown>) =>
          fn({ challenges, uow: {} })) as OtpStore['run'],
      },
      cipher: { activeKeyId: 'k', encrypt: vi.fn(), decrypt: vi.fn(), rotate: vi.fn() },
      hasher: new OtpHasher(key, [key]),
      outbox: { enqueue: vi.fn() },
      limiter: { charge },
      availability: { whatsappAvailable: () => Promise.resolve(true) },
      logger: quiet,
    });
    const failure = await service
      .request({
        phone: '+966500000123',
        purpose: 'driver_login',
        ip: '198.51.100.1',
        locale: 'ar',
      })
      .catch((error: unknown) => error);
    expect((failure as ApiException).code).toBe('rate_limited');
    expect(charged).toEqual(['otp_request_phone']);
    expect(challenges.insert).not.toHaveBeenCalled();
  });
});

describe('OtpService.request budgets (adversary M-1)', () => {
  it.each([
    ['otp_request_phone_day', ['otp_request_phone', 'otp_request_phone_day']],
    ['otp_request_ip', ['otp_request_phone', 'otp_request_phone_day', 'otp_request_ip']],
    [
      'otp_request_global',
      ['otp_request_phone', 'otp_request_phone_day', 'otp_request_ip', 'otp_request_global'],
    ],
  ])('refused by %s after the narrower ones, counted by reason', async (refusing, expected) => {
    const add = vi.spyOn(getMetrics(), 'add');
    const charged: string[] = [];
    const charge = vi.fn((name: string) => {
      charged.push(name);
      return name === refusing
        ? Promise.reject(new ApiException('rate_limited'))
        : Promise.resolve();
    });
    const challenges = {
      lockPhone: vi.fn(() => Promise.resolve()),
      cooldownLeft: vi.fn(() => Promise.resolve(0)),
      insert: vi.fn(() => Promise.resolve()),
    };
    const key = otpHmacKey(Buffer.alloc(32, 7).toString('base64'));
    const service = new OtpService({
      store: {
        run: ((fn: (tx: unknown) => Promise<unknown>) =>
          fn({ challenges, uow: {} })) as OtpStore['run'],
      },
      cipher: { activeKeyId: 'k', encrypt: vi.fn(), decrypt: vi.fn(), rotate: vi.fn() },
      hasher: new OtpHasher(key, [key]),
      outbox: { enqueue: vi.fn() },
      limiter: { charge },
      availability: { whatsappAvailable: () => Promise.resolve(true) },
      logger: quiet,
    });
    const failure = await service
      .request({
        phone: '+966500000123',
        purpose: 'driver_login',
        ip: '198.51.100.1',
        locale: 'ar',
      })
      .catch((error: unknown) => error);
    expect((failure as ApiException).code).toBe('rate_limited');
    expect(charged).toEqual(expected);
    expect(challenges.insert).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledWith('otp_requests_refused_total', 1, { reason: refusing });
    add.mockRestore();
  });

  it('takes 20 per phone a day and 500 an hour across the platform by default', () => {
    expect(namedBudgets.otp_request_phone_day).toEqual({ limit: 20, windowMs: 86_400_000 });
    expect(namedBudgets.otp_request_global).toEqual({ limit: 500, windowMs: 3_600_000 });
    expect(namedBudgetsWith(50).otp_request_global.limit).toBe(50);
  });
});

describe('OtpService.verify (review round 1, finding 3)', () => {
  it('refuses a malformed phone with otp_invalid without opening a transaction', async () => {
    const run = vi.fn();
    const key = otpHmacKey(Buffer.alloc(32, 7).toString('base64'));
    const service = new OtpService({
      store: { run: run as unknown as OtpStore['run'] },
      cipher: { activeKeyId: 'k', encrypt: vi.fn(), decrypt: vi.fn(), rotate: vi.fn() },
      hasher: new OtpHasher(key, [key]),
      outbox: { enqueue: vi.fn() },
      limiter: undefined,
      availability: { whatsappAvailable: () => Promise.resolve(true) },
      logger: quiet,
    });
    for (const phone of ['not a phone', '12', '']) {
      const failure = await service
        .verify({ phone, purpose: 'driver_login', code: '123456' })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(ApiException);
      expect((failure as ApiException).code).toBe('otp_invalid');
    }
    expect(run).not.toHaveBeenCalled();
  });
});
