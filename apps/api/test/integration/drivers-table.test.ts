import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertAccount, insertMembership, insertUser } from './identity-fixtures.js';
import { connectAs, integrationConfig, sqlState } from './support.js';

const rls = integrationConfig().db.rls;

// Migration 0016 on the real database (DEL-4 item A, plan 2.1; data §2.2, §10): del_drivers,
// del_vehicles and del_driver_devices with their checks, uniques and defaults, the tenant policy
// (another account's rows are invisible to elx_app), and the grants: elx_app works the three
// tables, elx_platform only reads them.

describe('del_drivers, del_vehicles, del_driver_devices (migration 0016)', () => {
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

  /** An account with a branch and a driver user and membership; ids only. */
  async function world() {
    const accountId = await insertAccount(owner);
    const siteId = uuidv7();
    await owner`
      INSERT INTO core_sites (id, account_id, kind, name_ar, name_en)
      VALUES (${siteId}, ${accountId}, 'branch', 'فرع', 'Branch')`;
    const user = await insertUser(owner);
    const membershipId = await insertMembership(owner, accountId, user.id, { roles: ['driver'] });
    return { accountId, siteId, userId: user.id, membershipId };
  }

  const insertDriver = (
    w: Awaited<ReturnType<typeof world>>,
    values: { id?: string; status?: string; capacity?: number; failures?: number } = {},
  ) =>
    sqlState(
      asTenant(
        w.accountId,
        (tx) => tx`
          INSERT INTO del_drivers (id, account_id, user_id, membership_id, home_site_id, status,
                                   capacity_limit, cash_pin_failures)
          VALUES (${values.id ?? uuidv7()}, ${w.accountId}, ${w.userId}, ${w.membershipId},
                  ${w.siteId}, ${values.status ?? 'active'}, ${values.capacity ?? 30},
                  ${values.failures ?? 0})`,
      ),
    );

  it('keys a driver by account and user and checks status, capacity and PIN failures', async () => {
    const w = await world();
    const id = uuidv7();
    expect(await insertDriver(w, { id })).toBe('none');
    const [row] = await owner<
      {
        status: string;
        capacity_limit: number;
        cash_pin_failures: number;
        cash_pin_hash: string | null;
        cash_blocked_at: Date | null;
        version: number;
      }[]
    >`SELECT status, capacity_limit, cash_pin_failures, cash_pin_hash, cash_blocked_at, version
      FROM del_drivers WHERE id = ${id}`;
    expect(row).toEqual({
      status: 'active',
      capacity_limit: 30,
      cash_pin_failures: 0,
      cash_pin_hash: null,
      cash_blocked_at: null,
      version: 1,
    });
    expect(await insertDriver(w)).toBe('23505');
    const other = await world();
    expect(await insertDriver(other, { status: 'retired' })).toBe('23514');
    expect(await insertDriver(other, { capacity: -1 })).toBe('23514');
    expect(await insertDriver(other, { failures: 6 })).toBe('23514');
    expect(await insertDriver(other, { capacity: 0, status: 'suspended' })).toBe('none');
  });

  it('keys a vehicle plate per account and checks kind, capacity and plate length', async () => {
    const accountId = await insertAccount(owner);
    const vehicle = (plate: string, kind = 'van', capacity = 40) =>
      sqlState(
        asTenant(
          accountId,
          (tx) => tx`
            INSERT INTO del_vehicles (id, account_id, plate, kind, capacity_parcels)
            VALUES (${uuidv7()}, ${accountId}, ${plate}, ${kind}, ${capacity})`,
        ),
      );
    expect(await vehicle('ABC 1234')).toBe('none');
    expect(await vehicle('ABC 1234', 'car')).toBe('23505');
    expect(await vehicle('XYZ 1', 'truck')).toBe('23514');
    expect(await vehicle('XYZ 2', 'car', -1)).toBe('23514');
    expect(await vehicle('')).toBe('23514');
    expect(await vehicle('A'.repeat(21))).toBe('23514');
    const other = await insertAccount(owner);
    expect(
      await sqlState(
        asTenant(
          other,
          (tx) => tx`
            INSERT INTO del_vehicles (id, account_id, plate, kind, capacity_parcels)
            VALUES (${uuidv7()}, ${other}, 'ABC 1234', 'motorbike', 2)`,
        ),
      ),
    ).toBe('none');
    const [row] = await owner<{ active: boolean; version: number }[]>`
      SELECT active, version FROM del_vehicles WHERE account_id = ${accountId}`;
    expect(row).toEqual({ active: true, version: 1 });
  });

  it('keys a device by driver and device id and checks platform and lengths', async () => {
    const w = await world();
    const driverId = uuidv7();
    expect(await insertDriver(w, { id: driverId })).toBe('none');
    const device = (deviceId: string, platform = 'android', appVersion = '1.0.0') =>
      sqlState(
        asTenant(
          w.accountId,
          (tx) => tx`
            INSERT INTO del_driver_devices (id, account_id, driver_id, device_id, platform,
                                            app_version)
            VALUES (${uuidv7()}, ${w.accountId}, ${driverId}, ${deviceId}, ${platform},
                    ${appVersion})`,
        ),
      );
    expect(await device('device-a')).toBe('none');
    expect(await device('device-a', 'ios')).toBe('23505');
    expect(await device('device-b', 'windows')).toBe('23514');
    expect(await device('')).toBe('23514');
    expect(await device('d'.repeat(201))).toBe('23514');
    expect(await device('d'.repeat(200))).toBe('none');
    expect(await device('device-c', 'ios', '')).toBe('23514');
    // Two active devices may coexist and a third is not refused by the schema: the cap is counted
    // under the driver row lock (data §2.2), so the partial index on active devices is not unique.
    expect(await device('device-d', 'ios')).toBe('none');
    const [index] = await owner<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'del_driver_devices_active_idx'`;
    expect(index?.indexdef).toMatch(/^CREATE INDEX .*WHERE \(revoked_at IS NULL\)$/);
  });

  it('shows elx_app only its own account and lets elx_platform only read', async () => {
    const mine = await world();
    const theirs = await world();
    expect(await insertDriver(mine)).toBe('none');
    expect(await insertDriver(theirs)).toBe('none');
    const seen = await asTenant(
      mine.accountId,
      (tx) => tx<{ account_id: string }[]>`SELECT account_id FROM del_drivers`,
    );
    // RLS is enabled only in the `ELX_RLS=on` lane; the policies exist in both (schema test).
    if (rls) {
      expect(seen.map((row) => row.account_id)).toEqual([mine.accountId]);
    } else {
      expect(seen.map((row) => row.account_id)).toContain(theirs.accountId);
    }
    expect(
      await sqlState(
        asTenant(
          mine.accountId,
          (tx) => tx`
            INSERT INTO del_vehicles (id, account_id, plate, kind, capacity_parcels)
            VALUES (${uuidv7()}, ${theirs.accountId}, 'CROSS 1', 'car', 1)`,
        ),
      ),
    ).toBe(rls ? '42501' : 'none');

    const grants = await owner<{ table_name: string; grantee: string; privileges: string }[]>`
      SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE table_name IN ('del_drivers', 'del_vehicles', 'del_driver_devices')
        AND grantee IN ('elx_app', 'elx_platform', 'elx_maintenance')
      GROUP BY table_name, grantee ORDER BY table_name, grantee`;
    const writes = 'DELETE,INSERT,SELECT,UPDATE';
    expect(grants.map((row) => ({ ...row }))).toEqual([
      { table_name: 'del_driver_devices', grantee: 'elx_app', privileges: writes },
      { table_name: 'del_driver_devices', grantee: 'elx_platform', privileges: 'SELECT' },
      { table_name: 'del_drivers', grantee: 'elx_app', privileges: writes },
      { table_name: 'del_drivers', grantee: 'elx_platform', privileges: 'SELECT' },
      { table_name: 'del_vehicles', grantee: 'elx_app', privileges: writes },
      { table_name: 'del_vehicles', grantee: 'elx_platform', privileges: 'SELECT' },
    ]);
    expect(
      await sqlState(platform`UPDATE del_drivers SET capacity_limit = 1 WHERE id = ${uuidv7()}`),
    ).toBe('42501');
    expect(await sqlState(platform`SELECT id FROM del_driver_devices LIMIT 1`)).toBe('none');
  });
});
