import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertAccount } from './identity-fixtures.js';
import { connectAs, sqlState } from './support.js';

// Migration 0014 on the real database (PLAT-12 item A, plan 2.1; data §2.1, §8): the rest of the
// core_accounts row with its one-value CHECKs, core_sites with the PostGIS point in SRID 4326 and
// the short-code CHECK, core_usage_counters keyed by (account, metric, period), and the grants:
// elx_app works the two tenant tables, elx_platform only reads them and still writes accounts.

describe('core_accounts, core_sites, core_usage_counters (migration 0014)', () => {
  let owner: postgres.Sql;
  let app: postgres.Sql;
  let platform: postgres.Sql;

  beforeAll(() => {
    owner = connectAs('owner');
    app = connectAs('app');
    platform = connectAs('platform');
  });

  afterAll(async () => {
    await Promise.all([owner.end(), app.end(), platform.end()]);
  });

  /** One statement as elx_app for `accountId`, in a transaction with the tenant setting. */
  const asTenant = (accountId: string, statement: (tx: postgres.TransactionSql) => unknown) =>
    app.begin(async (tx) => {
      await tx`SELECT set_config('elx.account_id', ${accountId}, true)`;
      return statement(tx);
    });

  it('gives an account the wave 0 defaults and refuses another country, locale or timezone', async () => {
    const accountId = await insertAccount(owner);
    const [row] = await owner<
      {
        country: string;
        default_locale: string;
        timezone: string;
        limits: unknown;
        provisioned_by: string | null;
        closed_at: Date | null;
        version: number;
      }[]
    >`SELECT country, default_locale, timezone, limits, provisioned_by, closed_at, version
      FROM core_accounts WHERE id = ${accountId}`;
    expect(row).toEqual({
      country: 'SA',
      default_locale: 'ar',
      timezone: 'Asia/Riyadh',
      limits: {},
      provisioned_by: null,
      closed_at: null,
      version: 1,
    });
    for (const change of [
      platform`UPDATE core_accounts SET country = 'AE' WHERE id = ${accountId}`,
      platform`UPDATE core_accounts SET default_locale = 'fr' WHERE id = ${accountId}`,
      platform`UPDATE core_accounts SET timezone = 'Asia/Dubai' WHERE id = ${accountId}`,
      platform`UPDATE core_accounts SET version = 0 WHERE id = ${accountId}`,
      platform`UPDATE core_accounts SET provisioned_by = ${uuidv7()} WHERE id = ${accountId}`,
    ]) {
      expect(['23514', '23503']).toContain(await sqlState(change));
    }
    expect(
      await sqlState(
        platform`UPDATE core_accounts SET limits = '{"sites": 2}'::jsonb, version = version + 1
                 WHERE id = ${accountId}`,
      ),
    ).toBe('none');
    expect(
      await sqlState(app`UPDATE core_accounts SET limits = '{}'::jsonb WHERE id = ${accountId}`),
    ).toBe('42501');
  });

  it('stores a site point in SRID 4326 and checks kind, status and the short code', async () => {
    const accountId = await insertAccount(owner);
    const id = uuidv7();
    await asTenant(
      accountId,
      (tx) => tx`
        INSERT INTO core_sites (id, account_id, kind, name_ar, name_en, national_address_short_code,
                                point)
        VALUES (${id}, ${accountId}, 'branch', 'الفرع', 'Branch', 'RRRD2929',
                ST_SetSRID(ST_MakePoint(46.6753, 24.7136), 4326))`,
    );
    const [site] = await owner<
      { srid: number; lng: number; lat: number; status: string; version: number; hours: unknown }[]
    >`SELECT ST_SRID(point) AS srid, ST_X(point) AS lng, ST_Y(point) AS lat, status, version,
             opening_hours AS hours
      FROM core_sites WHERE id = ${id}`;
    expect(site).toEqual({
      srid: 4326,
      lng: 46.6753,
      lat: 24.7136,
      status: 'active',
      version: 1,
      hours: [],
    });
    const [column] = await owner<{ type: string }[]>`
      SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
      WHERE attrelid = 'core_sites'::regclass AND attname = 'point'`;
    expect(column?.type).toBe('geometry(Point,4326)');
    const insert = (values: { kind?: string; code?: string | null; srid?: number }) =>
      sqlState(
        asTenant(
          accountId,
          (tx) => tx`
            INSERT INTO core_sites (id, account_id, kind, name_ar, name_en,
                                    national_address_short_code, point)
            VALUES (${uuidv7()}, ${accountId}, ${values.kind ?? 'warehouse'}, 'م', 'W',
                    ${values.code ?? null}, ST_SetSRID(ST_MakePoint(46.7, 24.7), ${values.srid ?? 4326}))`,
        ),
      );
    expect(await insert({})).toBe('none');
    expect(await insert({ kind: 'depot' })).toBe('23514');
    expect(await insert({ code: 'rrrd2929' })).toBe('23514');
    expect(await insert({ code: 'RRRD292' })).toBe('23514');
    expect(await insert({ srid: 3857 })).toBe('22023');
    expect(
      await sqlState(
        asTenant(accountId, (tx) => tx`UPDATE core_sites SET status = 'closed' WHERE id = ${id}`),
      ),
    ).toBe('23514');
  });

  it('keys usage counters by account, metric and month, never below zero', async () => {
    const accountId = await insertAccount(owner);
    const count = (metric: string, value: number, period = '2026-11-01') =>
      sqlState(
        asTenant(
          accountId,
          (tx) => tx`
            INSERT INTO core_usage_counters (account_id, metric, period, value)
            VALUES (${accountId}, ${metric}, ${period}::date, ${value})`,
        ),
      );
    expect(await count('orders', 3)).toBe('none');
    expect(await count('orders', 4)).toBe('23505');
    expect(await count('orders', 1, '2026-12-01')).toBe('none');
    expect(await count('parcels', 1)).toBe('23514');
    expect(await count('sites', -1)).toBe('23514');
  });

  it('lets elx_app work its own rows of the two tenant tables and elx_platform only read them', async () => {
    const grants = await owner<{ table_name: string; grantee: string; privileges: string }[]>`
      SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE table_name IN ('core_sites', 'core_usage_counters', 'core_accounts')
        AND grantee IN ('elx_app', 'elx_platform', 'elx_maintenance')
      GROUP BY table_name, grantee ORDER BY table_name, grantee`;
    const writes = 'DELETE,INSERT,SELECT,UPDATE';
    expect(grants.map((row) => ({ ...row }))).toEqual([
      { table_name: 'core_accounts', grantee: 'elx_app', privileges: 'SELECT' },
      { table_name: 'core_accounts', grantee: 'elx_platform', privileges: writes },
      { table_name: 'core_sites', grantee: 'elx_app', privileges: writes },
      { table_name: 'core_sites', grantee: 'elx_platform', privileges: 'SELECT' },
      { table_name: 'core_usage_counters', grantee: 'elx_app', privileges: writes },
      { table_name: 'core_usage_counters', grantee: 'elx_platform', privileges: 'SELECT' },
    ]);
    const accountId = await insertAccount(owner);
    expect(
      await sqlState(
        platform`INSERT INTO core_sites (id, account_id, kind, name_ar, name_en)
                 VALUES (${uuidv7()}, ${accountId}, 'branch', 'ف', 'B')`,
      ),
    ).toBe('42501');
    expect(
      await sqlState(
        platform`INSERT INTO core_usage_counters (account_id, metric, period)
                 VALUES (${accountId}, 'orders', '2026-11-01')`,
      ),
    ).toBe('42501');
    expect(await sqlState(platform`SELECT id FROM core_sites LIMIT 1`)).toBe('none');
  });
});
