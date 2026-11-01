import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { Global, Logger, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { OutboxWriter } from '../outbox/outbox-writer.js';
import { otpStoreOnPool } from '../platform/otp-challenges.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { RATE_LIMITER } from '../rate-limit/rate-limiter.js';
import type { BreakerStateStore } from './breaker.js';
import { redisBreakerStateStore } from './breaker.js';
import { OtpHasher, otpHmacKey } from './otp-code.js';
import { MessagingAvailability, OtpService } from './otp.service.js';

/** The breaker state reader of the API process (null without `REDIS_URL`). */
export const MESSAGING_BREAKERS = Symbol('MESSAGING_BREAKERS');

/** Owns the Redis connection the breaker state is read through; closed with the application. */
class BreakerConnection implements OnApplicationShutdown {
  readonly redis: Redis | null;

  constructor(url: string | undefined) {
    if (url === undefined) {
      this.redis = null;
      return;
    }
    this.redis = new Redis(url, {
      connectTimeout: 2000,
      commandTimeout: 500,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    });
    this.redis.on('error', () => undefined);
  }

  onApplicationShutdown(): void {
    this.redis?.disconnect();
  }
}

/**
 * Messaging in the API process (PLAT-9): the OTP service the sign-in doors call, and whether a code
 * can be sent now. Sending itself happens in the worker (the `message` handler, leg 2). The
 * credentials key encrypts the code on the outbox row and derives the OTP HMAC keys.
 */
@Global()
@Module({})
export class MessagingModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: MessagingModule,
      providers: [
        {
          provide: BreakerConnection,
          useFactory: () => new BreakerConnection(config.redis.url?.reveal()),
        },
        {
          provide: MESSAGING_BREAKERS,
          inject: [BreakerConnection],
          useFactory: (connection: BreakerConnection): BreakerStateStore | null =>
            connection.redis === null ? null : redisBreakerStateStore(connection.redis),
        },
        {
          provide: MessagingAvailability,
          inject: [MESSAGING_BREAKERS],
          useFactory: (breakers: BreakerStateStore | null) =>
            new MessagingAvailability(
              { disabled: config.messaging.disabled, provider: config.messaging.provider },
              breakers,
            ),
        },
        {
          provide: OtpService,
          inject: [MessagingAvailability, PLATFORM_POOL, { token: RATE_LIMITER, optional: true }],
          useFactory: (
            availability: MessagingAvailability,
            pool: Parameters<typeof otpStoreOnPool>[0],
            limiter: RateLimiter | undefined,
          ) => {
            const credentials = config.credentials;
            if (credentials === null || pool === null) {
              new Logger('Otp').warn(
                'CREDENTIALS_KEYS or DATABASE_URL_PLATFORM is not set: the OTP doors answer 500',
              );
            }
            const keys =
              credentials === null
                ? null
                : Object.entries(credentials.keys).map(
                    ([id, key]) => [id, otpHmacKey(key.reveal())] as const,
                  );
            const active = keys?.find(([id]) => id === credentials?.activeKeyId)?.[1];
            return new OtpService({
              store: otpStoreOnPool(pool),
              cipher: credentials === null ? null : createCredentialsCipher(credentials),
              hasher:
                keys === null || active === undefined
                  ? null
                  : new OtpHasher(
                      active,
                      keys.map(([, key]) => key),
                    ),
              outbox: new OutboxWriter(),
              limiter,
              availability,
            });
          },
        },
      ],
      exports: [OtpService, MessagingAvailability, MESSAGING_BREAKERS],
    };
  }
}
