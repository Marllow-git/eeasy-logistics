import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { roleBundles } from '@eeasy-logistics/contracts/unions';
import { describe, expect, it } from 'vitest';

// PLAT-10 plan 2.3: the seed of migration 0008 equals docs/contracts/roles.yaml (through the
// generated `roleBundles`), row for row: key, scope, surface, site scoping and the permission list
// in order. A bundle change needs roles.yaml, README §11 and a re-seed migration together.

const migration = readFileSync(join(import.meta.dirname, '../drizzle/0008_core_roles.sql'), 'utf8');

interface SeedRow {
  readonly key: string;
  readonly scope: string;
  readonly surface: string;
  readonly siteScoped: boolean;
  readonly permissions: readonly string[];
}

/** The VALUES rows of the `INSERT INTO "core_roles"` statement of `sql`. */
function seedRows(sql: string): SeedRow[] {
  const start = sql.indexOf('INSERT INTO "core_roles"');
  if (start < 0) throw new Error('no core_roles seed');
  const statement = sql.slice(start, sql.indexOf('ON CONFLICT', start));
  const row =
    /\(\s*'([a-z_]+)',\s*'([a-z]+)',\s*'([a-z]+)',\s*(true|false),\s*ARRAY\[([^\]]*)\]\s*\)/g;
  return [...statement.matchAll(row)].map((match) => ({
    key: match[1] ?? '',
    scope: match[2] ?? '',
    surface: match[3] ?? '',
    siteScoped: match[4] === 'true',
    permissions: [...(match[5] ?? '').matchAll(/'([a-z_.]+)'/g)].map((p) => p[1] ?? ''),
  }));
}

function expectedRows(): SeedRow[] {
  return Object.entries(roleBundles).map(([key, bundle]) => ({
    key,
    scope: bundle.scope,
    surface: bundle.surface,
    siteScoped: bundle.siteScoped,
    permissions: [...bundle.permissions],
  }));
}

describe('migration 0008 seed (PLAT-10 plan 2.3)', () => {
  it('seeds exactly the eleven bundles of roles.yaml', () => {
    const rows = seedRows(migration);
    expect(rows).toHaveLength(11);
    expect(rows).toEqual(expectedRows());
  });

  it('re-seeds system roles on conflict and never overwrites a custom one', () => {
    expect(migration).toMatch(/ON CONFLICT \("key"\) DO UPDATE SET[^;]*"permissions" = EXCLUDED/);
    expect(migration).toMatch(/WHERE NOT "core_roles"\."custom";/);
  });

  it('notices a planted difference (a permission dropped, a role re-scoped)', () => {
    const dropped = migration.replace("    'delivery.cash.deposit',\n", '');
    expect(seedRows(dropped)).not.toEqual(expectedRows());
    const rescoped = migration.replace(
      "('cashier', 'account', 'staff', true",
      "('cashier', 'account', 'staff', false",
    );
    expect(seedRows(rescoped)).not.toEqual(expectedRows());
  });
});
