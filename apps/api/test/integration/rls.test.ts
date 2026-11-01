import type { AppDatabase, Pool, RequestContext } from '@eeasy-logistics/db';
import { createAppPool, uuidv7, withUnitOfWork } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import {
  PlatformRepository,
  createPlatformPool,
  withPlatformUnitOfWork,
} from '@eeasy-logistics/db/platform';
import { inArray, sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { coreAccounts } from '../../src/modules/kernel/schema/accounts.js';
import { connectAs, integrationConfig, sqlState } from './support.js';

// Row-level security under both flag states (PLAT-5 item D, data §4.3 to §4.5). The suite runs with
// ELX_RLS=off in api-test and ELX_RLS=on in api-test-rls; every expectation follows the flag the
// database was migrated with. core_accounts carries the template policies.

const config = integrationConfig();
const rlsOn = config.db.rls;

const context = (accountId: string): RequestContext => ({
  accountId,
  membershipId: null,
  userId: null,
  deviceId: null,
  actingCrossTenant: false,
});

class AllAccounts extends PlatformRepository<typeof coreAccounts> {
  ids(ids: string[]) {
    return this.unscoped()
      .select({ id: coreAccounts.id })
      .from(coreAccounts)
      .where(inArray(coreAccounts.id, ids));
  }
}

describe(`row-level security with ELX_RLS=${rlsOn ? 'on' : 'off'}`, () => {
  const accountA = uuidv7();
  const accountB = uuidv7();
  const ours = [accountA, accountB];
  let owner: postgres.Sql;
  let app: postgres.Sql;
  let platform: postgres.Sql;
  let appPool: Pool<AppDatabase>;
  let platformPool: Pool<PlatformDatabase>;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    app = connectAs('app', config);
    platform = connectAs('platform', config);
    appPool = createAppPool(config.db, 'elx-rls-test');
    platformPool = createPlatformPool(config.db, 'elx-rls-test');
    await platform`
      INSERT INTO core_accounts (id, name) VALUES (${accountA}, 'RLS test A'), (${accountB}, 'RLS test B')`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core_accounts WHERE name LIKE 'RLS test %'`;
    await Promise.all([
      owner.end(),
      app.end(),
      platform.end(),
      appPool.close(),
      platformPool.close(),
    ]);
  });

  const countAs = async (client: postgres.Sql) => {
    const [row] = await client<{ n: number }[]>`
      SELECT count(*)::int AS n FROM core_accounts WHERE id IN ${client(ours)}`;
    return row?.n;
  };

  it('has RLS enabled on core_accounts exactly when the flag was on at migration time', async () => {
    const [row] = await owner<{ enabled: boolean; forced: boolean }[]>`
      SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced
      FROM pg_class WHERE oid = 'core_accounts'::regclass`;
    expect(row).toEqual({ enabled: rlsOn, forced: false });
  });

  it('elx_app without a context reads no rows when on, every row when off', async () => {
    expect(await countAs(app)).toBe(rlsOn ? 0 : 2);
  });

  it('elx_app inside a unit of work reads its own account only when on', async () => {
    const visible = await withUnitOfWork(appPool.db, context(accountA), ({ tx }) =>
      tx.select({ id: coreAccounts.id }).from(coreAccounts).where(inArray(coreAccounts.id, ours)),
    );
    expect(visible.map((row) => row.id).sort()).toEqual(rlsOn ? [accountA] : [...ours].sort());
  });

  it('a setting from a finished transaction grants nothing afterwards', async () => {
    await withUnitOfWork(appPool.db, context(accountA), () => Promise.resolve());
    const after = await appPool.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM core_accounts WHERE id IN (${accountA}, ${accountB})`,
    );
    expect(after[0]?.n).toBe(rlsOn ? 0 : 2);
  });

  it('elx_app cannot write another account through its context when on', async () => {
    const intruder = uuidv7();
    const insert = await sqlState(
      withUnitOfWork(appPool.db, context(accountA), ({ tx }) =>
        tx.insert(coreAccounts).values({ id: intruder, name: 'RLS test intruder' }),
      ),
    );
    // 42501: new row violates row-level security policy (WITH CHECK).
    expect(insert).toBe(rlsOn ? '42501' : 'none');

    const renamed = await withUnitOfWork(appPool.db, context(accountA), ({ tx }) =>
      tx.execute(sql`UPDATE core_accounts SET name = 'RLS test B' WHERE id = ${accountB}`),
    );
    expect(renamed.count).toBe(rlsOn ? 0 : 1);
  });

  it('elx_platform reads every account, through the platform_access policy', async () => {
    expect(await countAs(platform)).toBe(2);
    const rows = await withPlatformUnitOfWork(platformPool.db, (uow) =>
      new AllAccounts(uow, coreAccounts).ids(ours),
    );
    expect(rows).toHaveLength(2);
  });

  it('the runtime roles are neither superuser nor BYPASSRLS nor owners', async () => {
    const roles = await owner<{ rolname: string; bypass: boolean; superuser: boolean }[]>`
      SELECT rolname, rolbypassrls AS bypass, rolsuper AS superuser
      FROM pg_roles WHERE rolname IN ('elx_app', 'elx_platform') ORDER BY rolname`;
    expect(roles).toEqual([
      { rolname: 'elx_app', bypass: false, superuser: false },
      { rolname: 'elx_platform', bypass: false, superuser: false },
    ]);
    const [table] = await owner<{ owner: string }[]>`
      SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'core_accounts'::regclass`;
    expect(table?.owner).toBe('elx_owner');
  });
});
