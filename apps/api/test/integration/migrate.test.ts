import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '@eeasy-logistics/config';
import { uuidv7 } from '@eeasy-logistics/db';
import { databaseOf, dropDatabase, recreateDatabase } from '@eeasy-logistics/db/admin';
import {
  expectedSchemaVersion,
  maintainAuditPartitions,
  runMigrations,
} from '@eeasy-logistics/db/migrate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maintainAuditLog, migrationsFolder, retentionCutoff } from '../../src/migrate/run.js';
import { connectAs, harnessDatabase, integrationConfig } from './support.js';

// The migration runner (PLAT-5 item B). Its runs take the advisory lock, switch RLS on under
// ELX_RLS=on (`ALTER TABLE … ENABLE ROW LEVEL SECURITY` on every tenant table) and drop and create
// audit partitions: locks the other files' writes deadlock with on a shared database (issue #71,
// CHORE-2). So with DATABASE_URL_ADMIN this file migrates a scratch database of its own and runs
// there; without it (ci today: elx_owner may not create databases) it uses this run's database,
// and the `migrator` project of vitest.integration.config.ts starts it only after every other
// file has finished.
let config: Config = integrationConfig();
let dropOwnDatabase: () => Promise<void> = () => Promise.resolve();

beforeAll(async () => {
  const admin = config.db.urls.admin;
  if (admin === undefined) return;
  const database = `elx_test_${randomBytes(6).toString('hex')}`;
  await recreateDatabase(admin, database);
  dropOwnDatabase = () => dropDatabase(admin, database);
  config = integrationConfig({}, database);
  await runMigrations({ url: config.db.urls.owner, folder: migrationsFolder, rls: config.db.rls });
});

afterAll(() => dropOwnDatabase());

describe('runMigrations', () => {
  it.skipIf(integrationConfig().db.urls.admin === undefined)(
    'runs on a database of its own, never on the one the other files share (CHORE-2)',
    () => {
      const { owner, app, platform } = config.db.urls;
      if (owner === undefined || app === undefined || platform === undefined) {
        throw new Error('The suite needs the owner, app and platform URLs');
      }
      for (const url of [owner, app, platform]) {
        expect(databaseOf(url)).not.toBe(harnessDatabase());
      }
    },
  );

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

// The migration job's audit partition maintenance on the real database (PLAT-7, adversary M-1 and
// M-3), in this file so it never races the partition re-creation case above (vitest runs one
// file's tests in order).
describe('audit partition maintenance in the migration job', () => {
  it('keeps partitions ahead, drops a planted 25-month-old one and audits the drop in its transaction', async () => {
    const owner = connectAs('owner', config);
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

      const logs: string[] = [];
      const run = await maintainAuditLog(
        config,
        (line) => logs.push(line),
        (line) => logs.push(line),
      );
      expect(run).toMatchObject({ ran: true, dropped: [{ partition: name }] });
      expect(logs[0]).toContain(`1 dropped past ${config.audit.retentionMonths} months (${name})`);

      const [gone] = await owner<{ exists: boolean }[]>`
        SELECT to_regclass(${name}) IS NOT NULL AS exists`;
      expect(gone?.exists).toBe(false);
      const rows = await owner<
        { actorType: string; actorId: string | null; accountId: string | null; after: unknown }[]
      >`
        SELECT actor_type AS "actorType", actor_id AS "actorId", account_id AS "accountId", after
        FROM core_audit_log
        WHERE action = 'platform.audit_partition.dropped' AND target_id = ${name}`;
      expect(rows).toEqual([
        {
          actorType: 'system',
          actorId: null,
          accountId: null,
          after: { partition: name, upper_bound: `${(old?.upper ?? '').slice(0, 10)}T00:00:00Z` },
        },
      ]);
      // Three months ahead still exist afterwards.
      const [ahead] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM generate_series(0, 3) step
        WHERE to_regclass('core_audit_log_' || to_char(date_trunc('month', now() AT TIME ZONE 'UTC')
                + make_interval(months => step), 'YYYYMM')) IS NOT NULL`;
      expect(ahead?.n).toBe(4);
    } finally {
      await owner.end();
    }
  });

  it('keeps the partition of the month the retention reaches back to', () => {
    // The cutoff is that month's first day: its partition (upper bound one month later) stays.
    expect(retentionCutoff(new Date('2026-11-01T00:30:00Z'), 24)).toBe('2024-11-01');
    expect(retentionCutoff(new Date('2026-01-31T23:59:59Z'), 24)).toBe('2024-01-01');
    expect(retentionCutoff(new Date('2026-03-10T12:00:00Z'), 36)).toBe('2023-03-01');
  });

  it('refuses a cutoff inside 24 months even if the configuration were wrong', async () => {
    await expect(
      maintainAuditPartitions({ url: config.db.urls.owner, cutoff: '2025-06-01', runId: uuidv7() }),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('refuses to run on any login but the plain elx_owner (adversary L-1)', async () => {
    await expect(
      maintainAuditPartitions({
        url: config.db.urls.platform,
        cutoff: '2020-01-01',
        runId: uuidv7(),
      }),
    ).rejects.toThrow('Audit partition maintenance runs only as the plain elx_owner login');
  });
});

// Timestamp-named migrations and parallel orders (CHORE-3 plan 2.2, 2.5). The planted files go in a
// copy of the folder and create only throwaway schemas; the database is put back afterwards (the
// planted rows deleted, the version rewritten), so this file can run on the shared ci database.
describe('timestamp-named and parallel-order migrations (CHORE-3)', () => {
  interface Entry {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }
  const suffix = randomBytes(4).toString('hex');
  const folder = mkdtempSync(join(tmpdir(), 'elx-chore3-'));
  const journalPath = join(folder, 'meta', '_journal.json');
  let mainEntries: Entry[] = [];
  const planted: { entry: Entry; sql: string; schema: string }[] = [];

  /** drizzle-kit's `timestamp` prefix (`YYYYMMDDHHmmss`, UTC) for a journal `when`. */
  const stamp = (when: number) => new Date(when).toISOString().replace(/\D/g, '').slice(0, 14);
  const plant = (when: number, slug: string): Entry => {
    const schema = `chore3_${slug}_${suffix}`;
    const entry = { idx: 0, version: '7', when, tag: `${stamp(when)}_${slug}`, breakpoints: true };
    const sql =
      `-- reviewed (CHORE-3 test)\nCREATE SCHEMA "${schema}";\n--> statement-breakpoint\n` +
      `CREATE TABLE "${schema}"."probe" (id integer PRIMARY KEY);\n`;
    writeFileSync(join(folder, `${entry.tag}.sql`), sql);
    planted.push({ entry, sql, schema });
    return entry;
  };
  const writeJournal = (entries: Entry[]) => {
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Entry[] };
    journal.entries = entries.map((entry, idx) => ({ ...entry, idx }));
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  };
  const run = (log?: (line: string) => void) =>
    runMigrations({ url: config.db.urls.owner, folder, rls: config.db.rls, log });
  const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
  const recorded = async (when: number) => {
    const owner = connectAs('owner', config);
    try {
      return await owner<{ hash: string }[]>`
        SELECT hash FROM drizzle.__drizzle_migrations WHERE created_at = ${when}`;
    } finally {
      await owner.end();
    }
  };

  beforeAll(() => {
    cpSync(migrationsFolder, folder, { recursive: true });
    mainEntries = (JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Entry[] }).entries;
  });

  afterAll(async () => {
    const owner = connectAs('owner', config);
    try {
      for (const { entry, schema } of planted) {
        await owner`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = ${entry.when}`;
        await owner`DROP SCHEMA IF EXISTS ${owner(schema)} CASCADE`;
      }
    } finally {
      await owner.end();
    }
    await runMigrations({
      url: config.db.urls.owner,
      folder: migrationsFolder,
      rls: config.db.rls,
    });
    rmSync(folder, { recursive: true, force: true });
  });

  it("keeps Drizzle's bookkeeping: one row per file, its SHA-256 and the journal when", async () => {
    const owner = connectAs('owner', config);
    try {
      const rows = await owner<{ hash: string; when: string }[]>`
        SELECT hash, created_at::text AS when FROM drizzle.__drizzle_migrations ORDER BY id`;
      const expected = mainEntries.map((entry) => ({
        hash: sha256(readFileSync(join(migrationsFolder, `${entry.tag}.sql`)).toString()),
        when: String(entry.when),
      }));
      expect(rows).toEqual(expected);
    } finally {
      await owner.end();
    }
  });

  it('applies a timestamp-named migration after the index-named ones once, then nothing', async () => {
    const last = mainEntries.at(-1)?.when ?? 0;
    const late = plant(last + 120_000, 'late');
    writeJournal([...mainEntries, late]);
    expect(late.tag).toMatch(/^\d{14}_late$/);

    expect(await run()).toMatchObject({ applied: 1, version: late.tag });
    expect(await recorded(late.when)).toEqual([{ hash: sha256(planted[0]?.sql ?? '') }]);
    expect(await run()).toMatchObject({ applied: 0, version: late.tag });
  });

  it('applies an unapplied migration older than the last applied one in journal order, once', async () => {
    const late = planted[0]?.entry;
    if (late === undefined) throw new Error('The previous case plants the late migration');
    // A parallel order generated it before `late` but merged after it: the journal holds both,
    // ordered by `when` (plan 2.4), and the database has already applied `late`.
    const early = plant(late.when - 60_000, 'early');
    writeJournal([...mainEntries, early, late]);

    const logs: string[] = [];
    expect(await run((line) => logs.push(line))).toMatchObject({ applied: 1, version: late.tag });
    expect(logs).toContain(
      `migration ${early.tag} is older than the last applied one; applying in journal order`,
    );
    expect(await recorded(early.when)).toEqual([{ hash: sha256(planted[1]?.sql ?? '') }]);
    const owner = connectAs('owner', config);
    try {
      const [table] = await owner<{ name: string | null }[]>`
        SELECT to_regclass(${`"${planted[1]?.schema ?? ''}".probe`})::text AS name`;
      expect(table?.name).toBe(`${planted[1]?.schema ?? ''}.probe`);
    } finally {
      await owner.end();
    }

    const again: string[] = [];
    expect(await run((line) => again.push(line))).toMatchObject({ applied: 0 });
    expect(again.filter((line) => line.includes('older than the last applied'))).toEqual([]);
  });
});
