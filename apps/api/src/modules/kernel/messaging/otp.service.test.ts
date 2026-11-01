import { defineConfig } from '@eeasy-logistics/config';
import type { EnvRecord } from '@eeasy-logistics/config';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '../errors/api-exception.js';
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
