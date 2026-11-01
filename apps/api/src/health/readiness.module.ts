import type { Config } from '@eeasy-logistics/config';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import { expectedSchemaVersion } from '@eeasy-logistics/db/migrate';
import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_POOL, DatabaseModule } from '../database/database.module.js';
import { migrationsFolder } from '../migrate/run.js';
import { READINESS_CHECKS, ReadyController } from './ready.controller.js';
import type { ReadinessCheck } from './readiness.js';
import { databaseCheck, migrationsCheck, redisCheck, storageCheck } from './readiness.js';

/** `GET /ready` with the four checks of PLAT-5 plan 2.7, built from the validated config. */
@Module({})
export class ReadinessModule {
  static forRoot(config: Config): DynamicModule {
    // The version this build ships: the last migration in apps/api/drizzle (read once at boot).
    const expectedVersion = expectedSchemaVersion(migrationsFolder);
    return {
      module: ReadinessModule,
      imports: [DatabaseModule.forRoot(config)],
      controllers: [ReadyController],
      providers: [
        {
          provide: READINESS_CHECKS,
          inject: [APP_POOL],
          useFactory: (pool: Pool<AppDatabase> | null): ReadinessCheck[] => [
            databaseCheck(pool?.db),
            migrationsCheck(pool?.db, expectedVersion),
            redisCheck(config.redis.url),
            storageCheck(config.storage),
          ],
        },
      ],
    };
  }
}
