import type { Config } from '@eeasy-logistics/config';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import { createAppPool } from '@eeasy-logistics/db';
import type { DynamicModule, OnApplicationShutdown } from '@nestjs/common';
import { Global, Inject, Module } from '@nestjs/common';

/** The `elx_app` pool (ADR-0031): the only pool tenant code and `/ready` receive. */
export const APP_POOL = Symbol('APP_POOL');

/**
 * Database pools for the API process (data §4.4). Only the `elx_app` pool exists here; the
 * `elx_platform` pool is constructed by the platform module when it arrives (architecture test).
 */
@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(APP_POOL) private readonly pool: Pool<AppDatabase> | null) {}

  static forRoot(config: Config): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: APP_POOL,
          // Without DATABASE_URL_APP (allowed outside production, which refuses to start without
          // it) the API still serves /health and /ready answers 503; nothing else uses the pool yet.
          useFactory: () =>
            config.db.urls.app === undefined ? null : createAppPool(config.db, 'elx-api'),
        },
      ],
      exports: [APP_POOL],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool?.close();
  }
}
