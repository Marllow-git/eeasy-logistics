import { roleBundles } from '@eeasy-logistics/contracts/unions';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectAs, sqlState } from './support.js';

// Migration 0008 on the real database (PLAT-10 item B, plan 2.3): core_roles holds the eleven
// bundles of roles.yaml, and the runtime roles may read it but never write it.

describe('core_roles (migration 0008)', () => {
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

  it('holds the eleven system bundles of roles.yaml', async () => {
    const rows = await platform<
      {
        key: string;
        scope: string;
        surface: string;
        site_scoped: boolean;
        permissions: string[];
        custom: boolean;
      }[]
    >`SELECT key, scope, surface, site_scoped, permissions, custom FROM core_roles ORDER BY key`;
    const expected = Object.entries(roleBundles)
      .map(([key, bundle]) => ({
        key,
        scope: bundle.scope,
        surface: bundle.surface,
        site_scoped: bundle.siteScoped,
        permissions: [...bundle.permissions],
        custom: false,
      }))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
    expect(rows.map((row) => ({ ...row }))).toEqual(expected);
  });

  it('grants the runtime roles SELECT only', async () => {
    const grants = await owner<{ grantee: string; privilege_type: string }[]>`
      SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_name = 'core_roles' AND grantee IN ('elx_app', 'elx_platform', 'elx_maintenance')
      ORDER BY grantee, privilege_type`;
    expect(grants).toEqual([
      { grantee: 'elx_app', privilege_type: 'SELECT' },
      { grantee: 'elx_platform', privilege_type: 'SELECT' },
    ]);
    expect(await sqlState(app`SELECT key FROM core_roles LIMIT 1`)).toBe('none');
    expect(
      await sqlState(platform`UPDATE core_roles SET permissions = '{}' WHERE key = 'viewer'`),
    ).toBe('42501');
    expect(await sqlState(app`DELETE FROM core_roles WHERE key = 'viewer'`)).toBe('42501');
    expect(
      await sqlState(
        platform`INSERT INTO core_roles (key, scope, surface, site_scoped, permissions)
                 VALUES ('rogue', 'account', 'staff', false, '{}')`,
      ),
    ).toBe('42501');
  });
});
