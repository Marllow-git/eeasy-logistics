import type { Config } from '@eeasy-logistics/config';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { Global, Logger, Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { OUTBOX_QUEUES, OutboxQueues } from './outbox/queues.js';
import { CURSOR_CODEC, CursorCodec, cursorHmacKey } from './contract/list-page.js';
import { AccessTokenVerifier } from './auth/access-token.js';
import { PrincipalResolver } from './auth/principal.js';
import { IDEMPOTENCY_HMAC_KEY } from './idempotency/idempotency.interceptor.js';
import { idempotencyHmacKey } from './idempotency/request-hash.js';
import { PERMISSION_RESOLVER } from './authz/permission-resolver.js';
import { GEOCODER_SETUP, GeocoderSetup } from './geocoding/geocoders.js';
import { geocodeCacheStore } from './platform/geocode-cache.repository.js';
import { PLATFORM_POOL, PlatformModule } from './platform/platform.module.js';
import { loadPermissionResolver } from './platform/roles.repository.js';
import { defaultBudgets, namedBudgetsWith } from './rate-limit/budgets.js';
import { RATE_LIMITER, RateLimiter, redisRateLimitStore } from './rate-limit/rate-limiter.js';
import type { WebOrigins } from './request/web-client.guard.js';
import { WEB_ORIGINS, originOf } from './request/web-client.guard.js';
import { PRINCIPAL_RESOLVER } from './tenancy/frame.js';

/** The API's outbox queues, owning their connection: closed with the application. */
class ApiOutboxQueues extends OutboxQueues implements OnApplicationShutdown {
  constructor(private readonly ownConnection: Redis) {
    super(ownConnection);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
    this.ownConnection.disconnect();
  }
}

/**
 * What the request frame needs from the configuration (PLAT-6): the principal resolver with the
 * signing key, the platform pool, the rate limiter on Redis and the web origins. The guards and the
 * interceptors themselves are registered by `KernelModule`, so a module graph without this one
 * still refuses every non-public request.
 */
@Global()
@Module({})
export class RequestFrameModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: RequestFrameModule,
      imports: [PlatformModule.forRoot(config)],
      providers: [
        {
          provide: PRINCIPAL_RESOLVER,
          useFactory: () => {
            const verifier = new AccessTokenVerifier(config.auth);
            if (!verifier.configured) {
              new Logger('Auth').warn(
                'AUTH_SIGNING_KEY_ID or AUTH_SIGNING_KEY is not set: every authenticated route answers 401',
              );
            }
            return new PrincipalResolver(verifier);
          },
        },
        {
          // The role bundles of core_roles, read once at boot on the platform pool (PLAT-10 plan
          // 2.4). Without the pool there is no resolver: role-checked operations answer 500.
          provide: PERMISSION_RESOLVER,
          inject: [PLATFORM_POOL],
          useFactory: async (pool: Parameters<typeof loadPermissionResolver>[0]) => {
            const resolver = await loadPermissionResolver(pool);
            if (resolver === undefined) {
              new Logger('Permissions').warn(
                'DATABASE_URL_PLATFORM is not set: every role-checked operation answers 500',
              );
            }
            return resolver;
          },
        },
        {
          // The idempotency HMAC key for removed secrets (plan 2.8): HKDF of the signing key.
          provide: IDEMPOTENCY_HMAC_KEY,
          useFactory: () => {
            const key = config.auth.signingKey;
            return key === undefined ? undefined : idempotencyHmacKey(key.reveal());
          },
        },
        {
          // List cursors (ADR-0029, PLAT-7 plan 2.6): signed under HKDF of the signing key.
          provide: CURSOR_CODEC,
          useFactory: () => {
            const key = config.auth.signingKey;
            return new CursorCodec(key === undefined ? undefined : cursorHmacKey(key.reveal()));
          },
        },
        {
          // The origins of the web client marker (plan 2.11, ADR-0038): staff writes come from the
          // merchant web, platform writes from the console. Production requires both URLs.
          provide: WEB_ORIGINS,
          useFactory: (): WebOrigins => {
            const origins = {
              staff: originOf(config.app.publicWebUrl),
              platform: originOf(config.app.publicAdminUrl),
            };
            if (origins.staff === undefined || origins.platform === undefined) {
              new Logger('WebClient').warn(
                'PUBLIC_WEB_URL or PUBLIC_ADMIN_URL is not set: staff or platform writes answer 403',
              );
            }
            return origins;
          },
        },
        {
          // Rate limits (plan 2.10). Without REDIS_URL (allowed outside production, which refuses
          // to start without it) no budget is enforced; with it, a Redis outage fails open.
          provide: RATE_LIMITER,
          useFactory: () => {
            const url = config.redis.url;
            if (url === undefined) {
              new Logger('RateLimit').warn('REDIS_URL is not set: rate limits are not enforced');
              return undefined;
            }
            return new RateLimiter(redisRateLimitStore(url.reveal()), {
              budgets: {
                ...defaultBudgets,
                named: namedBudgetsWith(config.messaging.otpGlobalHourlyBudget),
              },
            });
          },
        },
        {
          // The outbox queues for the platform replays and consumer counts (PLAT-8 plan 2.7):
          // its own connection, closed on shutdown. Without REDIS_URL those operations answer 500.
          provide: OUTBOX_QUEUES,
          useFactory: () => {
            const url = config.redis.url;
            if (url === undefined) return null;
            const connection = new Redis(url.reveal(), {
              maxRetriesPerRequest: 1,
              enableOfflineQueue: false,
            });
            connection.on('error', () => undefined);
            return new ApiOutboxQueues(connection);
          },
        },
        {
          // The geocoder's sources, cache and breakers (INT-2 plan 2.6, 2.11); `KernelModule`
          // provides the `GEOCODER` service on them. The cache table needs the platform pool.
          provide: GEOCODER_SETUP,
          inject: [PLATFORM_POOL],
          useFactory: (pool: Parameters<typeof loadPermissionResolver>[0]) =>
            new GeocoderSetup(config, pool ? geocodeCacheStore(pool.db) : undefined),
        },
      ],
      exports: [
        GEOCODER_SETUP,
        PRINCIPAL_RESOLVER,
        PERMISSION_RESOLVER,
        IDEMPOTENCY_HMAC_KEY,
        CURSOR_CODEC,
        RATE_LIMITER,
        WEB_ORIGINS,
        OUTBOX_QUEUES,
      ],
    };
  }
}
