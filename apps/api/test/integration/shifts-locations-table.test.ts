import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertAccount, insertMembership, insertUser } from './identity-fixtures.js';
import { connectAs, integrationConfig, sqlState } from './support.js';

const rls = integrationConfig().db.rls;

// Migration 20261102140500_del_shifts_locations on the real database (DEL-5 item A, plan 2.1; data
// §2.2, §6, §10): one live shift per driver (partial unique index) and the status and window
// checks; the ring's slot check, its key and its storage parameters; the head's seq checks; the
// trail's LineStringM path with its GiST index and the unique day per driver; the tenant policy
// (another account's rows are invisible to elx_app); the grants: elx_app works the four tables,
// elx_platform only reads them.

const tables = [
  'del_driver_shifts',
  'del_driver_locations',
  'del_driver_location_heads',
  'del_driver_trails',
] as const;

describe('del_driver_shifts, del_driver_locations, del_driver_location_heads, del_driver_trails (migration 20261102140500_del_shifts_locations)', () => {
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

  /** An account with a branch and one driver; ids only. */
  async function world() {
    const accountId = await insertAccount(owner);
    const siteId = uuidv7();
    await owner`
      INSERT INTO core_sites (id, account_id, kind, name_ar, name_en)
      VALUES (${siteId}, ${accountId}, 'branch', 'فرع', 'Branch')`;
    const user = await insertUser(owner);
    const membershipId = await insertMembership(owner, accountId, user.id, { roles: ['driver'] });
    const driverId = uuidv7();
    await owner`
      INSERT INTO del_drivers (id, account_id, user_id, membership_id, home_site_id, name)
      VALUES (${driverId}, ${accountId}, ${user.id}, ${membershipId}, ${siteId}, 'Driver')`;
    return { accountId, siteId, driverId };
  }

  type World = Awaited<ReturnType<typeof world>>;

  const insertShift = (
    w: World,
    values: { id?: string; status?: string; start?: string; end?: string; started?: boolean } = {},
  ) =>
    sqlState(
      asTenant(
        w.accountId,
        (tx) => tx`
          INSERT INTO del_driver_shifts (id, account_id, driver_id, site_id, planned_start,
                                         planned_end, status, started_at, ended_at)
          VALUES (${values.id ?? uuidv7()}, ${w.accountId}, ${w.driverId}, ${w.siteId},
                  ${values.start ?? '2026-11-02T06:00:00Z'}, ${values.end ?? '2026-11-02T14:00:00Z'},
                  ${values.status ?? 'planned'},
                  ${values.started === false ? null : values.status === 'planned' || values.status === undefined ? null : new Date()},
                  ${values.status === 'ended' ? new Date() : null})`,
      ),
    );

  const insertPoint = (w: World, shiftId: string, slot: number, seq: number) =>
    sqlState(
      asTenant(
        w.accountId,
        (tx) => tx`
          INSERT INTO del_driver_locations (account_id, driver_id, slot, seq, shift_id, point,
                                            client_ts, server_ts)
          VALUES (${w.accountId}, ${w.driverId}, ${slot}, ${seq}, ${shiftId},
                  ST_SetSRID(ST_MakePoint(46.67, 24.71), 4326), now(), now())`,
      ),
    );

  it('holds one live shift per driver and checks status, window and times', async () => {
    const w = await world();
    expect(await insertShift(w)).toBe('none');
    expect(await insertShift(w)).toBe('none'); // two planned shifts are fine
    expect(await insertShift(w, { status: 'active' })).toBe('none');
    expect(await insertShift(w, { status: 'paused' })).toBe('23505');
    expect(await insertShift(w, { status: 'ended' })).toBe('none');
    expect(await insertShift(w, { status: 'on_break' })).toBe('23514');
    expect(await insertShift(w, { status: 'active', started: false })).toBe('23514');
    expect(
      await insertShift(w, { start: '2026-11-02T14:00:00Z', end: '2026-11-02T14:00:00Z' }),
    ).toBe('23514');
    // Another driver may hold a live shift of their own.
    const other = await world();
    expect(await insertShift(other, { status: 'active' })).toBe('none');
  });

  it('keys the ring by driver and slot, checks the slot and keeps the storage parameters', async () => {
    const w = await world();
    const shiftId = uuidv7();
    expect(await insertShift(w, { id: shiftId, status: 'active' })).toBe('none');
    expect(await insertPoint(w, shiftId, 0, 1)).toBe('none');
    expect(await insertPoint(w, shiftId, 239, 240)).toBe('none');
    expect(await insertPoint(w, shiftId, 0, 241)).toBe('23505');
    expect(await insertPoint(w, shiftId, 240, 241)).toBe('23514');
    expect(await insertPoint(w, shiftId, -1, 241)).toBe('23514');
    const [ring] = await owner<{ reloptions: string[] }[]>`
      SELECT reloptions FROM pg_class WHERE oid = 'del_driver_locations'::regclass`;
    expect(ring?.reloptions).toEqual(['fillfactor=70', 'autovacuum_vacuum_scale_factor=0.02']);
    const [key] = await owner<{ def: string }[]>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'del_driver_locations'::regclass AND contype = 'p'`;
    expect(key?.def).toBe('PRIMARY KEY (driver_id, slot)');
  });

  it('keeps the head seq checks and a trail LineStringM per driver and day with a GiST index', async () => {
    const w = await world();
    const head = (lastSeq: number, trailSeq: number) =>
      sqlState(
        asTenant(
          w.accountId,
          (tx) => tx`
            INSERT INTO del_driver_location_heads (driver_id, account_id, last_seq, trail_seq)
            VALUES (${w.driverId}, ${w.accountId}, ${lastSeq}, ${trailSeq})`,
        ),
      );
    expect(await head(5, 6)).toBe('23514');
    expect(await head(5, 5)).toBe('none');
    expect(await head(5, 5)).toBe('23505');

    const trail = (wkt: string, date = '2026-11-02') =>
      sqlState(
        asTenant(
          w.accountId,
          (tx) => tx`
            INSERT INTO del_driver_trails (id, account_id, driver_id, business_date, path,
                                           point_count, first_ts, last_ts)
            VALUES (${uuidv7()}, ${w.accountId}, ${w.driverId}, ${date},
                    ST_GeomFromText(${wkt}, 4326), 2, now(), now())`,
        ),
      );
    const line = 'LINESTRING M (46.67 24.71 1762063200, 46.68 24.72 1762063215)';
    expect(await trail(line)).toBe('none');
    expect(await trail(line)).toBe('23505');
    expect(await trail(line, '2026-11-03')).toBe('none');
    expect(await trail('LINESTRING (46.67 24.71, 46.68 24.72)', '2026-11-04')).toBe('22023');
    const [index] = await owner<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'del_driver_trails_path_idx'`;
    expect(index?.indexdef).toMatch(/USING gist \(path\)$/);
  });

  it('hides another account’s rows from elx_app and lets elx_platform only read', async () => {
    const w = await world();
    const shiftId = uuidv7();
    expect(await insertShift(w, { id: shiftId, status: 'active' })).toBe('none');
    expect(await insertPoint(w, shiftId, 1, 2)).toBe('none');
    const stranger = await world();
    const seen = await asTenant(
      stranger.accountId,
      (tx) => tx<{ n: number }[]>`
        SELECT (SELECT count(*) FROM del_driver_shifts WHERE driver_id = ${w.driverId})::int
             + (SELECT count(*) FROM del_driver_locations WHERE driver_id = ${w.driverId})::int AS n`,
    );
    expect(seen[0]?.n).toBe(rls ? 0 : 2);
    // Writing a row of another account is refused under RLS.
    expect(
      await sqlState(
        asTenant(
          stranger.accountId,
          (tx) => tx`
            INSERT INTO del_driver_location_heads (driver_id, account_id)
            VALUES (${w.driverId}, ${w.accountId})`,
        ),
      ),
    ).toBe(rls ? '42501' : 'none');

    const grants = await owner<{ table_name: string; grantee: string; privileges: string }[]>`
      SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE table_name IN ${owner(tables)}
        AND grantee IN ('elx_app', 'elx_platform', 'elx_maintenance')
      GROUP BY table_name, grantee ORDER BY table_name, grantee`;
    const writes = 'DELETE,INSERT,SELECT,UPDATE';
    expect(grants.map((row) => ({ ...row }))).toEqual(
      [...tables].sort().flatMap((table) => [
        { table_name: table, grantee: 'elx_app', privileges: writes },
        { table_name: table, grantee: 'elx_platform', privileges: 'SELECT' },
      ]),
    );
    expect(
      await sqlState(platform`UPDATE del_driver_shifts SET status = 'ended' WHERE id = ${shiftId}`),
    ).toBe('42501');
    expect(
      await sqlState(platform`DELETE FROM del_driver_locations WHERE driver_id = ${w.driverId}`),
    ).toBe('42501');
  });
});
