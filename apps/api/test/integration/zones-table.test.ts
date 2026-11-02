import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertAccount } from './identity-fixtures.js';
import { connectAs, integrationConfig, sqlState } from './support.js';

const rls = integrationConfig().db.rls;

// Migration 20261102125922_del_zones on the real database (DEL-1 item A, plan 2.1; data §2.2, §8):
// del_zones with a valid MultiPolygon in SRID 4326 (CHECK ST_IsValid), its checks and GiST index;
// del_coverage unique per site and zone; the tenant policy (another account's rows are invisible
// to elx_app); the grants: elx_app works both tables, elx_platform inserts zones, inserts and
// deletes coverage and may insert a site (the provisioning doors), nothing more.

const square = 'MULTIPOLYGON(((46.6 24.6, 46.7 24.6, 46.7 24.7, 46.6 24.7, 46.6 24.6)))';
const bowtie = 'MULTIPOLYGON(((46.6 24.6, 46.7 24.7, 46.7 24.6, 46.6 24.7, 46.6 24.6)))';

describe('del_zones, del_coverage (migration 20261102125922_del_zones)', () => {
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

  const asTenant = <T>(accountId: string, statement: (tx: postgres.TransactionSql) => T) =>
    app.begin(async (tx) => {
      await tx`SELECT set_config('elx.account_id', ${accountId}, true)`;
      return statement(tx);
    });

  /** An account with a branch; ids only. */
  async function world() {
    const accountId = await insertAccount(owner);
    const siteId = uuidv7();
    await owner`
      INSERT INTO core_sites (id, account_id, kind, name_ar, name_en)
      VALUES (${siteId}, ${accountId}, 'branch', 'فرع', 'Branch')`;
    return { accountId, siteId };
  }

  const insertZone = (
    accountId: string,
    values: { id?: string; wkt?: string; srid?: number; source?: string; nameEn?: string } = {},
  ) =>
    sqlState(
      asTenant(
        accountId,
        (tx) => tx`
          INSERT INTO del_zones (id, account_id, name_ar, name_en, boundary, source)
          VALUES (${values.id ?? uuidv7()}, ${accountId}, 'منطقة', ${values.nameEn ?? 'Zone'},
                  ST_GeomFromText(${values.wkt ?? square}, ${values.srid ?? 4326}),
                  ${values.source ?? 'drawn'})`,
      ),
    );

  it('keeps a valid MultiPolygon in 4326 with its checks and the GiST index', async () => {
    const { accountId } = await world();
    const id = uuidv7();
    expect(await insertZone(accountId, { id })).toBe('none');
    const [row] = await owner<
      { active: boolean; version: number; type: string; srid: number; valid: boolean }[]
    >`SELECT active, version, GeometryType(boundary) AS type, ST_SRID(boundary) AS srid,
             ST_IsValid(boundary) AS valid
      FROM del_zones WHERE id = ${id}`;
    expect(row).toEqual({
      active: true,
      version: 1,
      type: 'MULTIPOLYGON',
      srid: 4326,
      valid: true,
    });
    expect(await insertZone(accountId, { wkt: bowtie })).toBe('23514');
    expect(await insertZone(accountId, { srid: 3857 })).toBe('22023');
    expect(await insertZone(accountId, { wkt: 'POINT(46.6 24.6)' })).toBe('22023');
    expect(await insertZone(accountId, { source: 'imported' })).toBe('23514');
    expect(await insertZone(accountId, { nameEn: '' })).toBe('23514');
    expect(await insertZone(accountId, { nameEn: 'x'.repeat(121) })).toBe('23514');
    const [index] = await owner<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'del_zones_boundary_idx'`;
    expect(index?.indexdef).toMatch(/USING gist \(boundary\)$/);
  });

  it('keys coverage by account, site and zone', async () => {
    const w = await world();
    const zoneId = uuidv7();
    expect(await insertZone(w.accountId, { id: zoneId })).toBe('none');
    const cover = () =>
      sqlState(
        asTenant(
          w.accountId,
          (tx) => tx`
            INSERT INTO del_coverage (id, account_id, site_id, zone_id)
            VALUES (${uuidv7()}, ${w.accountId}, ${w.siteId}, ${zoneId})`,
        ),
      );
    expect(await cover()).toBe('none');
    expect(await cover()).toBe('23505');
  });

  it('shows elx_app only its own account and grants elx_platform the provisioning writes only', async () => {
    const mine = await world();
    const theirs = await world();
    expect(await insertZone(mine.accountId)).toBe('none');
    expect(await insertZone(theirs.accountId)).toBe('none');
    const seen = await asTenant(
      mine.accountId,
      (tx) => tx<{ account_id: string }[]>`SELECT account_id FROM del_zones`,
    );
    // RLS is enabled only in the `ELX_RLS=on` lane; the policies exist in both (schema test).
    if (rls) {
      expect([...new Set(seen.map((row) => row.account_id))]).toEqual([mine.accountId]);
    } else {
      expect(seen.map((row) => row.account_id)).toContain(theirs.accountId);
    }
    expect(
      await sqlState(
        asTenant(
          mine.accountId,
          (tx) => tx`
            INSERT INTO del_zones (id, account_id, name_ar, name_en, boundary, source)
            VALUES (${uuidv7()}, ${theirs.accountId}, 'م', 'Z',
                    ST_GeomFromText(${square}, 4326), 'drawn')`,
        ),
      ),
    ).toBe(rls ? '42501' : 'none');

    const grants = await owner<{ table_name: string; grantee: string; privileges: string }[]>`
      SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE table_name IN ('del_zones', 'del_coverage', 'core_sites')
        AND grantee IN ('elx_app', 'elx_platform', 'elx_maintenance')
      GROUP BY table_name, grantee ORDER BY table_name, grantee`;
    const writes = 'DELETE,INSERT,SELECT,UPDATE';
    expect(grants.map((row) => ({ ...row }))).toEqual([
      { table_name: 'core_sites', grantee: 'elx_app', privileges: writes },
      { table_name: 'core_sites', grantee: 'elx_platform', privileges: 'INSERT,SELECT' },
      { table_name: 'del_coverage', grantee: 'elx_app', privileges: writes },
      { table_name: 'del_coverage', grantee: 'elx_platform', privileges: 'DELETE,INSERT,SELECT' },
      { table_name: 'del_zones', grantee: 'elx_app', privileges: writes },
      { table_name: 'del_zones', grantee: 'elx_platform', privileges: 'INSERT,SELECT' },
    ]);
    expect(
      await sqlState(platform`UPDATE del_zones SET active = false WHERE id = ${uuidv7()}`),
    ).toBe('42501');
    expect(await sqlState(platform`DELETE FROM del_zones WHERE id = ${uuidv7()}`)).toBe('42501');
    expect(
      await sqlState(platform`UPDATE core_sites SET name_en = 'x' WHERE id = ${uuidv7()}`),
    ).toBe('42501');
  });
});
