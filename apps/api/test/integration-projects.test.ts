import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migratorFiles } from './integration/migrator-files.js';

// CHORE-2 (issue #71): integration files run in parallel on one database, so a file that takes the
// shared database's DDL locks (the migrator, its SQL functions, DDL on a table outside a throwaway
// schema) must sit in the `migrator` project of vitest.integration.config.ts, which runs after the
// parallel files. This guard keeps `migratorFiles` complete in every mode, CI included.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The migrator and the SQL functions it runs: each takes locks on shared tables. */
const migratorSymbols = [
  /\brunMigrations\s*\(/,
  /\bcore_enable_tenant_rls\b/,
  /\bcore_ensure_audit_partitions\b/,
  /\bensureAuditPartitions\b/,
  /\bcore_drop_audit_partitions_before\b/,
  /\bmaintainAuditPartitions\s*\(/,
  /\bmaintainAuditLog\s*\(/,
];

/**
 * DDL at the start of a statement (after a backtick or at the start of a line, so an SQL string a
 * test sends as data, such as an injection payload, is not read as one) and the object it targets.
 */
const ddl =
  /(?:^|`)\s*(?:(?:CREATE|ALTER|DROP)\s+TABLE(?:\s+IF\s+(?:NOT\s+)?EXISTS)?|TRUNCATE(?:\s+TABLE)?|LOCK(?:\s+TABLE)?|CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+\w+)?\s+ON|CREATE\s+(?:POLICY|TRIGGER)\b[^`]*?\bON|ALTER\s+(?:POLICY|TRIGGER)\s+\w+\s+ON|DROP\s+(?:POLICY|TRIGGER)(?:\s+IF\s+EXISTS)?\s+\w+\s+ON)\s+(\S+)/gim;

/**
 * A target in a throwaway schema: schema-qualified (`${owner(schema)}.rows`, `"${schema}".rows`)
 * with a schema other than `public`, or a variable this file sets to such a name.
 */
function isThrowaway(target: string, source: string): boolean {
  const qualified = /^(\$\{[^}]+\}|"[^"]+"|\w+)\.\w+/.exec(target);
  if (qualified !== null) return !/^"?public"?$/i.test(qualified[1] ?? '');
  const variable = /^\$\{(\w+)\}/.exec(target)?.[1];
  if (variable === undefined) return false;
  const assigned = new RegExp(
    `\\b(?:const|let)\\s+${variable}\\s*=\\s*(?:sql\\.raw\\()?\`"\\$\\{\\w+\\}"\\.\\w+\``,
  );
  return assigned.test(source);
}

/** Comment lines removed, so a comment that names a function is not a use of it. */
function code(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join('\n');
}

/** What in `source` takes the shared database's DDL locks; empty when nothing does. */
function sharedLockUses(source: string): string[] {
  const text = code(source);
  const uses = migratorSymbols.filter((symbol) => symbol.test(text)).map((symbol) => symbol.source);
  for (const match of text.matchAll(ddl)) {
    const target = match[1] ?? '';
    if (!isThrowaway(target, text)) uses.push(match[0].trim());
  }
  return uses;
}

function integrationFiles(): string[] {
  return ['test/integration', 'test/schema']
    .flatMap((folder) =>
      readdirSync(join(root, folder), { recursive: true, encoding: 'utf8' }).map((file) =>
        join(folder, file),
      ),
    )
    .filter((file) => file.endsWith('.test.ts'))
    .sort();
}

describe('the migrator project of the integration suite (CHORE-2)', () => {
  const files = integrationFiles();
  const uses = new Map(
    files.map((file) => [file, sharedLockUses(readFileSync(join(root, file), 'utf8'))]),
  );

  it('lists every file that takes the shared DDL locks, and only existing files that do', () => {
    const taking = files.filter((file) => (uses.get(file) ?? []).length > 0);
    expect([...migratorFiles].sort()).toEqual(taking);
  });

  it('leaves no such use in a file of the parallel project', () => {
    const parallel = files.filter((file) => !migratorFiles.includes(file));
    expect(parallel.length).toBeGreaterThan(0);
    expect(
      parallel.flatMap((file) => (uses.get(file) ?? []).map((use) => `${file}: ${use}`)),
    ).toEqual([]);
  });

  it('flags the migrator, its functions and DDL on shared tables', () => {
    const planted = [
      'await runMigrations({ url, folder: migrationsFolder, rls: true });',
      'await owner`SELECT core_enable_tenant_rls()`;',
      'await owner`SELECT core_ensure_audit_partitions(3)`;',
      'await maintainAuditLog(config, log, log);',
      'await owner`ALTER TABLE core_outbox ENABLE ROW LEVEL SECURITY`;',
      'await owner`DROP TABLE ${owner(furthest)}`;',
      'await owner.unsafe(`CREATE TABLE "${name}" PARTITION OF core_audit_log`);',
      'await owner`CREATE POLICY p ON core_outbox TO elx_app USING (true)`;',
      'await owner`TRUNCATE core_outbox`;',
      'await owner`LOCK TABLE public.core_outbox`;',
      'await owner`CREATE INDEX ON public.core_audit_log (action)`;',
    ];
    for (const source of planted) expect(sharedLockUses(source), source).not.toEqual([]);
  });

  it('accepts DDL in a throwaway schema, comments and SQL sent as data', () => {
    const accepted = [
      'await owner`CREATE SCHEMA ${owner(schema)}`;',
      'await owner`CREATE TABLE ${owner(schema)}.ledger (id uuid)`;',
      'await owner`ALTER TABLE ${table}.rows ENABLE ROW LEVEL SECURITY`;',
      'const table = `"${schema}".site_rows`;\nawait owner.unsafe(`CREATE TABLE ${table} (id uuid)`);',
      'await owner`DROP SCHEMA IF EXISTS ${owner(schema)} CASCADE`;',
      'context("x\', true); DROP TABLE uow_rows; --")',
      '// runMigrations() and core_enable_tenant_rls() take locks',
    ];
    for (const source of accepted) expect(sharedLockUses(source), source).toEqual([]);
  });
});
