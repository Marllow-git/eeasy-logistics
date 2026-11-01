// Integration harness (PLAT-5 plan 2.9; handbook 03: never a mock database). Once per run:
//   - with DATABASE_URL_ADMIN (local, or ci when set): a scratch database elx_test_<random> is
//     created from template1, migrated from zero with ELX_RLS respected, and dropped afterwards;
//   - without it, in ci only: the configured database itself (the `migrate` step has run; this
//     run is then a no-op apart from the RLS switch).
// The development database is never migrated by the suite (data §11.7).
import { randomBytes } from 'node:crypto';
import { defineConfig } from '@eeasy-logistics/config';
import { readEnvironment } from '@eeasy-logistics/config/node';
import {
  databaseOf,
  dropDatabase,
  recreateDatabase,
  withDatabase,
} from '@eeasy-logistics/db/admin';
import { runMigrations } from '@eeasy-logistics/db/migrate';
import type { TestProject } from 'vitest/node';
import { migrationsFolder } from '../../src/migrate/run.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The migrated database this run's integration tests use. */
    elxDatabase: string;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const config = defineConfig(readEnvironment(), { role: 'migrate' });
  const { admin, owner } = config.db.urls;
  if (config.app.env !== 'local' && config.app.env !== 'ci') {
    throw new Error('The integration suite runs only with APP_ENV=local or APP_ENV=ci');
  }
  if (owner === undefined) throw new Error('DATABASE_URL_OWNER is not configured');

  let database: string;
  let cleanup: () => Promise<void> = () => Promise.resolve();
  if (admin !== undefined) {
    database = `elx_test_${randomBytes(6).toString('hex')}`;
    await recreateDatabase(admin, database);
    cleanup = () => dropDatabase(admin, database);
  } else if (config.app.env === 'ci') {
    database = databaseOf(owner);
  } else {
    throw new Error(
      'Set DATABASE_URL_ADMIN (a local superuser) so the suite can use a scratch database',
    );
  }

  try {
    await runMigrations({
      url: withDatabase(owner, database),
      folder: migrationsFolder,
      rls: config.db.rls,
    });
  } catch (error) {
    await cleanup();
    throw error;
  }
  project.provide('elxDatabase', database);
  return cleanup;
}
