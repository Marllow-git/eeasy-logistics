import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import type { DynamicModule } from '@nestjs/common';
import { Logger, Module } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import { KernelModule } from '../kernel.module.js';
import { identityStoreOnPool } from '../platform/identity.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { RATE_LIMITER } from '../rate-limit/rate-limiter.js';
import { AccessTokenIssuer } from './access-token.js';
import { BreachedPasswords, PasswordHasher } from './passwords.js';
import { PlatformAuthController } from './platform-auth.controller.js';
import { SessionService } from './sessions.js';
import { StaffAuthController } from './staff-auth.controller.js';

/**
 * Staff and platform authentication (PLAT-11): the sign-in doors, sessions and `Me`. The identity
 * tables are reached only through the platform pool; without it, or without a signing key, the
 * doors answer 500 (production requires both). Without credentials keys the refresh reuse grace is
 * off (no successor can be kept encrypted).
 */
@Module({})
export class AuthModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AuthModule,
      imports: [KernelModule],
      controllers: [StaffAuthController, PlatformAuthController],
      providers: [
        { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
        // Read once at boot; a missing or malformed list stops the boot (plan 2.2).
        { provide: BreachedPasswords, useFactory: () => BreachedPasswords.bundled() },
        {
          provide: AccessTokenIssuer,
          useFactory: () => new AccessTokenIssuer(config.auth),
        },
        {
          provide: SessionService,
          inject: [
            AccessTokenIssuer,
            PLATFORM_POOL,
            AUDIT_SINK,
            { token: RATE_LIMITER, optional: true },
          ],
          useFactory: (
            issuer: AccessTokenIssuer,
            pool: Parameters<typeof identityStoreOnPool>[0],
            audit: AuditSink,
            limiter: RateLimiter | undefined,
          ) => {
            if (pool === null || !issuer.configured) {
              new Logger('Auth').warn(
                'DATABASE_URL_PLATFORM or the signing key is not set: the sign-in doors answer 500',
              );
            }
            return new SessionService({
              issuer,
              cipher:
                config.credentials === null ? null : createCredentialsCipher(config.credentials),
              store: identityStoreOnPool(pool),
              audit,
              limiter,
              settings: {
                staffRefreshTtlSeconds: config.auth.staffRefreshTtlSeconds,
                platformIdleTtlSeconds: config.auth.platformIdleTtlSeconds,
                refreshReuseGraceSeconds: config.auth.refreshReuseGraceSeconds,
              },
            });
          },
        },
      ],
      exports: [SessionService, PasswordHasher, BreachedPasswords, AccessTokenIssuer],
    };
  }
}
