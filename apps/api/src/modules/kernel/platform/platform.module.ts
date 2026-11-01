import type { Config } from '@eeasy-logistics/config';
import type { PlatformContext, RequestContext } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import type { Pool } from '@eeasy-logistics/db';
import {
  createPlatformPool,
  withCrossTenantUnitOfWork,
  withPlatformUnitOfWork,
} from '@eeasy-logistics/db/platform';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { Global, Inject, Module } from '@nestjs/common';
import { ApiException } from '../errors/api-exception.js';
import type { PlatformFrames } from '../tenancy/frame.js';
import { PLATFORM_FRAMES } from '../tenancy/frame.js';
import { AccountsDirectory } from './accounts.repository.js';
import { BootChecks } from './boot-checks.js';
import { PLATFORM_POOL } from './tokens.js';

export { PLATFORM_POOL } from './tokens.js';

/**
 * The platform frames on one pool: plain platform work, and the cross-tenant door, whose one
 * transaction first checks that the target account exists (an unknown id is `404 not_found`, like a
 * malformed one), then sets the account and runs the work.
 */
export function platformFrames(db: PlatformDatabase): PlatformFrames {
  return {
    runPlatform: <T>(context: PlatformContext, fn: () => Promise<T>) =>
      withPlatformUnitOfWork(db, () => fn(), context),
    runCrossTenant: <T>(context: RequestContext, fn: () => Promise<T>) =>
      withCrossTenantUnitOfWork(
        db,
        context,
        () => fn(),
        async (uow) => {
          if (!(await new AccountsDirectory(uow).exists(context.accountId))) {
            throw new ApiException('not_found');
          }
        },
      ),
  };
}

/**
 * The platform pool for platform-surface requests (PLAT-6 plan 2.6, 2.7). Without
 * DATABASE_URL_PLATFORM (allowed outside production) there are no frames and every platform
 * request answers 500; production refuses to start without the URL (packages/config).
 */
@Global()
@Module({})
export class PlatformModule implements OnApplicationShutdown {
  constructor(@Inject(PLATFORM_POOL) private readonly pool: Pool<PlatformDatabase> | null) {}

  static forRoot(config: Config): DynamicModule {
    return {
      module: PlatformModule,
      providers: [
        {
          provide: PLATFORM_POOL,
          useFactory: () =>
            config.db.urls.platform === undefined
              ? null
              : createPlatformPool(config.db, 'elx-api-platform'),
        },
        {
          provide: PLATFORM_FRAMES,
          inject: [PLATFORM_POOL],
          useFactory: (pool: Pool<PlatformDatabase> | null) =>
            pool === null ? undefined : platformFrames(pool.db),
        },
        BootChecks,
      ],
      exports: [PLATFORM_POOL, PLATFORM_FRAMES, BootChecks],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.close();
  }
}
