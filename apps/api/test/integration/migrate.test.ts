import { expectedSchemaVersion, runMigrations } from '@eeasy-logistics/db/migrate';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from '../../src/migrate/run.js';
import { connectAs, integrationConfig } from './support.js';

// The migration runner on this run's database, already migrated by global-setup.ts (PLAT-5 item B).

describe('runMigrations', () => {
  const config = integrationConfig();

  it('is idempotent and serialises concurrent runs: both finish, neither applies anything', async () => {
    const run = () =>
      runMigrations({ url: config.db.urls.owner, folder: migrationsFolder, rls: config.db.rls });
    const [first, second] = await Promise.all([run(), run()]);
    const version = expectedSchemaVersion(migrationsFolder);
    expect(first).toMatchObject({ applied: 0, version });
    expect(second).toMatchObject({ applied: 0, version });
  });

  it('records the version every applied migration reaches, readable by elx_app', async () => {
    const app = connectAs('app', config);
    try {
      const [meta] = await app<{ version: string }[]>`SELECT version FROM core_schema_meta`;
      expect(meta?.version).toBe(expectedSchemaVersion(migrationsFolder));
    } finally {
      await app.end();
    }
  });

  it('refuses to run without the owner URL', async () => {
    await expect(
      runMigrations({ url: undefined, folder: migrationsFolder, rls: false }),
    ).rejects.toThrow('DATABASE_URL_OWNER is not configured');
  });
});
