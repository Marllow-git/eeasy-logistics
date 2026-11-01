import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, integrationConfig } from '../integration/support.js';
import { appendOnlyTables, globalUniqueIndexes, tenancyExemptions } from './exemptions.js';

// The tenancy schema test (PLAT-5 plan 2.4; data §4.1; ADR-0025). It reads pg_catalog after the
// migrations ran from zero (test/integration/global-setup.ts) and fails on any mismatch, printing
// `<table>: <problem>` for each. Every `core_`, `del_`, `wms_` and `rpt_` table in public that is
// not exempt must carry `account_id uuid NOT NULL` with a foreign key to core_accounts and an index
// led by it; its unique indexes include account_id unless listed as global; it has the
// tenant_isolation and platform_access policies from wave 0. Append-only tables have both triggers
// and no UPDATE, DELETE or TRUNCATE for the runtime roles. With ELX_RLS=on, RLS must be enabled.

interface TableRow {
  oid: number;
  name: string;
  rls: boolean;
}

const config = integrationConfig();

describe('tenancy schema (data §4.1)', () => {
  let owner: postgres.Sql;
  let tables: TableRow[];

  beforeAll(async () => {
    owner = connectAs('owner', config);
    tables = await owner<TableRow[]>`
      SELECT c.oid::int AS oid, c.relname AS name, c.relrowsecurity AS rls
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND c.relname ~ '^(core|del|wms|rpt)_'
      ORDER BY c.relname`;
  });

  afterAll(async () => {
    await owner.end();
  });

  const tenantTables = () => tables.filter((table) => !(table.name in tenancyExemptions));

  it('finds the tables the migrations create', () => {
    expect(tables.map((table) => table.name)).toEqual(
      expect.arrayContaining(['core_accounts', 'core_schema_meta']),
    );
  });

  it('lists only exemptions that exist', () => {
    const names = new Set(tables.map((table) => table.name));
    const stale = Object.keys(tenancyExemptions).filter((name) => !names.has(name));
    expect(stale.map((name) => `${name}: exempted but not in the schema`)).toEqual([]);
  });

  it('gives every tenant table account_id uuid NOT NULL, a foreign key and a leading index', async () => {
    const problems: string[] = [];
    for (const table of tenantTables()) {
      const [column] = await owner<{ attnum: number; type: string; notnull: boolean }[]>`
        SELECT attnum, format_type(atttypid, atttypmod) AS type, attnotnull AS notnull
        FROM pg_attribute
        WHERE attrelid = ${table.oid} AND attname = 'account_id' AND NOT attisdropped`;
      if (column === undefined) {
        problems.push(`${table.name}: no account_id column`);
        continue;
      }
      if (column.type !== 'uuid') problems.push(`${table.name}: account_id is ${column.type}`);
      if (!column.notnull) problems.push(`${table.name}: account_id is nullable`);

      const [fk] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_constraint
        WHERE conrelid = ${table.oid} AND contype = 'f'
          AND conkey = ARRAY[${column.attnum}]::int2[]
          AND confrelid = 'core_accounts'::regclass`;
      if (fk?.n === 0) problems.push(`${table.name}: no foreign key account_id → core_accounts`);

      const [leading] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM pg_index
        WHERE indrelid = ${table.oid} AND indkey[0] = ${column.attnum}`;
      if (leading?.n === 0) problems.push(`${table.name}: no index led by account_id`);
    }
    expect(problems).toEqual([]);
  });

  it('keeps account_id in every unique index of a tenant table, unless globally unique', async () => {
    const problems: string[] = [];
    for (const table of tenantTables()) {
      const indexes = await owner<{ name: string; columns: string[] }[]>`
        SELECT i.relname AS name,
               array_agg(a.attname ORDER BY k.ordinality) AS columns
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ordinality)
        LEFT JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
        WHERE x.indrelid = ${table.oid} AND x.indisunique
        GROUP BY i.relname`;
      const allowed = globalUniqueIndexes[table.name] ?? [];
      for (const index of indexes) {
        const columns = index.columns.map((column) => column ?? '<expression>');
        if (columns.includes('account_id')) continue;
        if (columns.length === 1 && columns[0] === 'id') continue;
        if (allowed.some((global) => global.join(',') === columns.join(','))) continue;
        problems.push(
          `${table.name}: unique index ${index.name} (${columns.join(', ')}) omits account_id`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('has the tenant_isolation and platform_access policies on every tenant table', async () => {
    const policies = await owner<{ table: string; name: string; roles: string[] }[]>`
      SELECT tablename AS table, policyname AS name, roles::text[] AS roles
      FROM pg_policies WHERE schemaname = 'public'`;
    const problems: string[] = [];
    const expected = [
      ['tenant_isolation', 'elx_app'],
      ['platform_access', 'elx_platform'],
    ] as const;
    for (const table of [...tenantTables().map((t) => t.name), 'core_accounts']) {
      for (const [name, role] of expected) {
        const policy = policies.find((p) => p.table === table && p.name === name);
        if (policy === undefined) problems.push(`${table}: no ${name} policy`);
        else if (policy.roles.join(',') !== role) {
          problems.push(`${table}: ${name} applies to ${policy.roles.join(',')}, not ${role}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it(`has RLS ${config.db.rls ? 'enabled' : 'as migrated'} on every table with a tenant_isolation policy`, async () => {
    if (!config.db.rls) return; // Off until the wave 1 exit migration (data §4.5).
    const rows = await owner<{ table: string; rls: boolean }[]>`
      SELECT DISTINCT p.tablename AS table, c.relrowsecurity AS rls
      FROM pg_policies p JOIN pg_class c ON c.oid = format('%I.%I', p.schemaname, p.tablename)::regclass
      WHERE p.schemaname = 'public' AND p.policyname = 'tenant_isolation'`;
    expect(rows.filter((row) => !row.rls).map((row) => `${row.table}: RLS not enabled`)).toEqual(
      [],
    );
  });

  it('gives elx_app no INSERT, UPDATE or DELETE on a platform table (review M-3)', async () => {
    const problems: string[] = [];
    for (const [table, exemption] of Object.entries(tenancyExemptions)) {
      if (exemption.class !== 'platform table') continue;
      const [grants] = await owner<{ writes: string | null }[]>`
        SELECT string_agg(p, ', ') AS writes
        FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE']) p
        WHERE has_table_privilege('elx_app', ${table}, p)`;
      if (grants?.writes) problems.push(`${table}: elx_app may ${grants.writes}`);
    }
    expect(problems).toEqual([]);
  });

  it('denies the runtime roles TEMP on the database and CREATE on public (review L-3, N-3)', async () => {
    const rows = await owner<{ role: string; temp: boolean; create: boolean }[]>`
      SELECT r AS role,
             has_database_privilege(r, current_database(), 'TEMP') AS temp,
             has_schema_privilege(r, 'public', 'CREATE') AS create
      FROM unnest(ARRAY['elx_app', 'elx_platform']) r ORDER BY r`;
    expect(rows).toEqual([
      { role: 'elx_app', temp: false, create: false },
      { role: 'elx_platform', temp: false, create: false },
    ]);
  });

  it('protects every append-only table with both triggers and no mutating grants', async () => {
    const problems: string[] = [];
    const triggered = await owner<{ table: string; timing: string }[]>`
      SELECT c.relname AS table,
             CASE WHEN t.tgtype & 32 <> 0 THEN 'truncate' ELSE 'row' END AS timing
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal
        AND t.tgfoid = 'core_reject_mutation()'::regprocedure`;
    for (const table of appendOnlyTables) {
      const timings = triggered.filter((row) => row.table === table).map((row) => row.timing);
      if (!timings.includes('row')) problems.push(`${table}: no BEFORE UPDATE OR DELETE trigger`);
      if (!timings.includes('truncate')) problems.push(`${table}: no BEFORE TRUNCATE trigger`);
      const [grants] = await owner<{ mutating: string | null }[]>`
        SELECT string_agg(r || ' ' || p, ', ') AS mutating
        FROM unnest(ARRAY['elx_app', 'elx_platform']) r,
             unnest(ARRAY['UPDATE', 'DELETE', 'TRUNCATE']) p
        WHERE has_table_privilege(r, ${table}, p)`;
      if (grants?.mutating) problems.push(`${table}: granted ${grants.mutating}`);
    }
    for (const row of triggered) {
      if (!appendOnlyTables.includes(row.table)) {
        problems.push(`${row.table}: has the append-only trigger but is not in appendOnlyTables`);
      }
    }
    expect(problems).toEqual([]);
  });
});
