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

  it('keeps the current month and the next three audit partitions on every run (PLAT-7 2.2)', async () => {
    const owner = connectAs('owner', config);
    try {
      const months = await owner<{ name: string }[]>`
        SELECT 'core_audit_log_' || to_char(date_trunc('month', now() AT TIME ZONE 'UTC')
                 + make_interval(months => step), 'YYYYMM') AS name
        FROM generate_series(0, 3) step`;
      const furthest = months.at(-1)?.name ?? '';
      // The furthest month is empty: drop it as the owner, and the next run puts it back.
      await owner`DROP TABLE ${owner(furthest)}`;
      const result = await runMigrations({
        url: config.db.urls.owner,
        folder: migrationsFolder,
        rls: config.db.rls,
      });
      expect(result).toMatchObject({ applied: 0, auditPartitionsCreated: 1 });
      const present = await owner<{ name: string }[]>`
        SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'core_audit_log'::regclass`;
      expect(present.map((row) => row.name)).toEqual(
        expect.arrayContaining(months.map((row) => row.name)),
      );
    } finally {
      await owner.end();
    }
  });

  it('refuses to run without the owner URL', async () => {
    await expect(
      runMigrations({ url: undefined, folder: migrationsFolder, rls: false }),
    ).rejects.toThrow('DATABASE_URL_OWNER is not configured');
  });
});
