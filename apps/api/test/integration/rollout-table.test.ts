import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { featureKeys } from '../../src/modules/kernel/features/feature-keys.js';
import { insertAccount, insertUser } from './identity-fixtures.js';
import { connectAs, integrationConfig, sqlState } from './support.js';

// Migration 0016 on the real database (PLAT-13 item A, plan 2.1, 2.5; data §2.1, §2.4; ADR-0006,
// K-6): the seeded rollout modes equal the feature-key registry, the mode CHECK, the flag CHECK
// `NOT enabled OR provisioned_by IS NOT NULL`, the flag key bound to a registered feature, one
// flag per account and key, the grants (elx_app reads both, elx_platform writes both) and the
// tenant policy on the flags.

const config = integrationConfig();

describe('core_rollout_modes, core_feature_flags (migration 0016)', () => {
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

  const asTenant = <T>(accountId: string, statement: (tx: postgres.TransactionSql) => Promise<T>) =>
    app.begin(async (tx) => {
      await tx`SELECT set_config('elx.account_id', ${accountId}, true)`;
      return statement(tx);
    });

  it('seeds one allowlist row per registered feature key, by the system', async () => {
    const rows = await owner<{ feature_key: string; mode: string; updated_by: string | null }[]>`
      SELECT feature_key, mode, updated_by FROM core_rollout_modes
      WHERE feature_key = ANY(${[...featureKeys]}) ORDER BY feature_key`;
    expect(rows.map((row) => ({ ...row }))).toEqual(
      [...featureKeys]
        .sort()
        .map((key) => ({ feature_key: key, mode: 'allowlist', updated_by: null })),
    );
    expect(
      await sqlState(
        platform`UPDATE core_rollout_modes SET mode = 'beta' WHERE feature_key = 'wms'`,
      ),
    ).toBe('23514');
  });

  it('refuses an enabled flag without provisioned_by, an unknown key and a second row', async () => {
    const accountId = await insertAccount(owner);
    const admin = await insertUser(owner);
    const flag = (key: string, enabled: boolean, provisionedBy: string | null) =>
      sqlState(
        platform`INSERT INTO core_feature_flags (account_id, feature_key, enabled, provisioned_by,
                                                 enabled_at)
                 VALUES (${accountId}, ${key}, ${enabled}, ${provisionedBy},
                         ${enabled ? new Date().toISOString() : null}::timestamptz)`,
      );
    expect(await flag('delivery', true, null)).toBe('23514');
    expect(await flag('teleport', false, null)).toBe('23503');
    expect(await flag('delivery', true, admin.id)).toBe('none');
    expect(await flag('delivery', false, null)).toBe('23505');
    expect(await flag('wms', false, null)).toBe('none');
    expect(
      await sqlState(
        platform`UPDATE core_feature_flags SET provisioned_by = NULL
                 WHERE account_id = ${accountId} AND feature_key = 'delivery'`,
      ),
    ).toBe('23514');
    expect(
      await sqlState(
        platform`UPDATE core_feature_flags SET version = 0
                 WHERE account_id = ${accountId} AND feature_key = 'wms'`,
      ),
    ).toBe('23514');
  });

  it('lets elx_app only read both tables and elx_platform write them', async () => {
    const grants = await owner<{ table_name: string; grantee: string; privileges: string }[]>`
      SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE table_name IN ('core_rollout_modes', 'core_feature_flags')
        AND grantee IN ('elx_app', 'elx_platform')
      GROUP BY table_name, grantee ORDER BY table_name, grantee`;
    const writes = 'DELETE,INSERT,SELECT,UPDATE';
    expect(grants.map((row) => ({ ...row }))).toEqual([
      { table_name: 'core_feature_flags', grantee: 'elx_app', privileges: 'SELECT' },
      { table_name: 'core_feature_flags', grantee: 'elx_platform', privileges: writes },
      { table_name: 'core_rollout_modes', grantee: 'elx_app', privileges: 'SELECT' },
      { table_name: 'core_rollout_modes', grantee: 'elx_platform', privileges: writes },
    ]);
    const accountId = await insertAccount(owner);
    expect(
      await sqlState(
        asTenant(
          accountId,
          (tx) => tx`INSERT INTO core_feature_flags (account_id, feature_key)
                     VALUES (${accountId}, 'wms')`,
        ),
      ),
    ).toBe('42501');
    expect(
      await sqlState(app`UPDATE core_rollout_modes SET mode = 'all' WHERE feature_key = 'wms'`),
    ).toBe('42501');
    expect(await sqlState(app`SELECT mode FROM core_rollout_modes`)).toBe('none');
  });

  it(`shows elx_app ${config.db.rls ? 'only its own' : 'every'} account's flags`, async () => {
    const [mine, theirs] = [await insertAccount(owner), await insertAccount(owner)];
    await platform`
      INSERT INTO core_feature_flags (account_id, feature_key)
      VALUES (${mine}, 'wms'), (${theirs}, 'wms')`;
    const seen = await asTenant(
      mine,
      (tx) => tx<{ account_id: string }[]>`
        SELECT account_id FROM core_feature_flags WHERE account_id IN (${mine}, ${theirs})
        ORDER BY account_id`,
    );
    expect(seen.map((row) => row.account_id)).toEqual(
      config.db.rls ? [mine] : [mine, theirs].sort(),
    );
  });
});
