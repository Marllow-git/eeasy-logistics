import { expectedSchemaVersion, runMigrations } from '@eeasy-logistics/db/migrate';
import { describe, expect, it } from 'vitest';
import { migrationsFolder } from '../../src/migrate/run.js';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { AuditWriter } from '../../src/modules/kernel/audit/audit-writer.js';
import {
  ownerPartitionMaintenance,
  retentionCutoff,
  runAuditPartitionJob,
} from '../../src/worker/system/audit-partitions.js';
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

// The worker's audit partition job on the real database (PLAT-7 item D), in this file so it never
// races the partition re-creation case above (vitest runs one file's tests in order).
describe('the audit partition job', () => {
  const config = integrationConfig();

  it('keeps partitions ahead, drops a planted 25-month-old one and audits the drop', async () => {
    const owner = connectAs('owner', config);
    const platform = createPlatformPool(config.db, 'elx-test-partitions');
    try {
      const [old] = await owner<{ name: string; lower: string; upper: string }[]>`
        SELECT 'core_audit_log_' || to_char(m, 'YYYYMM') AS name,
               to_char(m, 'YYYY-MM-DD') || ' 00:00:00+00' AS lower,
               to_char(m + interval '1 month', 'YYYY-MM-DD') || ' 00:00:00+00' AS upper
        FROM (SELECT date_trunc('month', now() AT TIME ZONE 'UTC') - interval '25 months' AS m) s`;
      const name = old?.name ?? '';
      // Planted like the function would: no runtime grant (the schema test may run meanwhile).
      await owner.begin(async (tx) => {
        // DDL takes no parameters; the name and bounds come from the query above.
        await tx.unsafe(
          `CREATE TABLE "${name}" PARTITION OF core_audit_log ` +
            `FOR VALUES FROM ('${old?.lower ?? ''}') TO ('${old?.upper ?? ''}')`,
        );
        await tx`REVOKE ALL ON ${tx(name)} FROM elx_app, elx_platform`;
      });
      await owner`
        INSERT INTO core_audit_log (occurred_at, actor_type, target_type, target_id, action,
                                    request_id)
        VALUES (${old?.lower ?? ''}::timestamptz + interval '1 day', 'system', 'test', 'old',
                'platform.test.planted', 'planted')`;

      const set = () => Promise.resolve('OK' as const);
      const run = await runAuditPartitionJob(
        ownerPartitionMaintenance(config),
        new AuditWriter(platform),
        { set },
        config.audit.retentionMonths,
      );
      expect(run).toMatchObject({ ran: true, dropped: 1 });

      const [gone] = await owner<{ exists: boolean }[]>`
        SELECT to_regclass(${name}) IS NOT NULL AS exists`;
      expect(gone?.exists).toBe(false);
      const rows = await owner<{ actorType: string; accountId: string | null; after: unknown }[]>`
        SELECT actor_type AS "actorType", account_id AS "accountId", after FROM core_audit_log
        WHERE action = 'platform.audit_partition.dropped' AND target_id = ${name}`;
      expect(rows).toEqual([
        {
          actorType: 'system',
          accountId: null,
          after: {
            partition: name,
            upper_bound: `${(old?.upper ?? '').slice(0, 10)}T00:00:00Z`,
          },
        },
      ]);
      // Three months ahead still exist after the job.
      const [ahead] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM generate_series(0, 3) step
        WHERE to_regclass('core_audit_log_' || to_char(date_trunc('month', now() AT TIME ZONE 'UTC')
                + make_interval(months => step), 'YYYYMM')) IS NOT NULL`;
      expect(ahead?.n).toBe(4);
    } finally {
      await Promise.all([owner.end(), platform.close()]);
    }
  });

  it('keeps a partition still inside the retention', () => {
    // The cutoff is the first day of the month 24 months back: that month's partition (upper
    // bound one month later) stays.
    expect(retentionCutoff(new Date('2026-11-01T00:00:00Z'), 24)).toBe('2024-11-01');
  });

  it('refuses a cutoff inside 24 months even if the job were misconfigured', async () => {
    await expect(ownerPartitionMaintenance(config)('2025-06-01')).rejects.toMatchObject({
      code: '22023',
    });
  });
});
