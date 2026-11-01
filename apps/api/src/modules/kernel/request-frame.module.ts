import type { Config } from '@eeasy-logistics/config';
import type { DynamicModule } from '@nestjs/common';
import { Global, Logger, Module } from '@nestjs/common';
import { AccessTokenVerifier } from './auth/access-token.js';
import { PrincipalResolver } from './auth/principal.js';
import { IDEMPOTENCY_HMAC_KEY } from './idempotency/idempotency.interceptor.js';
import { idempotencyHmacKey } from './idempotency/request-hash.js';
import { PlatformModule } from './platform/platform.module.js';
import { PRINCIPAL_RESOLVER } from './tenancy/frame.js';

/**
 * What the request frame needs from the configuration (PLAT-6): the principal resolver with the
 * signing key, and the platform pool. The guard and the interceptors themselves are registered by
 * `KernelModule`, so a module graph without this one still refuses every non-public request.
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
          // The idempotency HMAC key for removed secrets (plan 2.8): HKDF of the signing key.
          provide: IDEMPOTENCY_HMAC_KEY,
          useFactory: () => {
            const key = config.auth.signingKey;
            return key === undefined ? undefined : idempotencyHmacKey(key.reveal());
          },
        },
      ],
      exports: [PRINCIPAL_RESOLVER, IDEMPOTENCY_HMAC_KEY],
    };
  }
}
