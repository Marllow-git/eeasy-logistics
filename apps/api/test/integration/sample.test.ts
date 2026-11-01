import type { RequestContext } from '@eeasy-logistics/db';
import { createAppPool, uuidv7, withUnitOfWork } from '@eeasy-logistics/db';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { coreAccounts } from '../../src/modules/kernel/schema/accounts.js';
import { accountFixtures } from '../../src/seed/fixtures.js';
import { seedFixtures } from '../../src/seed/seed.js';
import { connectAs, harnessDatabase, integrationConfig } from './support.js';

// The pattern every later integration test follows (PLAT-5 item G, handbook 03): the configuration
// from integrationConfig() points at this run's migrated database; work runs through the same unit
// of work as production code; whatever a test writes it removes, and the run's scratch database
// is dropped by the harness at the end.

const config = integrationConfig();

describe('sample integration test', () => {
  const accountId = uuidv7();
  const owner = connectAs('owner', config);

  afterAll(async () => {
    await owner`DELETE FROM core_accounts WHERE id = ${accountId}`;
    await owner.end();
  });

  it('runs on the database the harness migrated, never the development database', async () => {
    const [row] = await owner<{ database: string }[]>`SELECT current_database() AS database`;
    expect(row?.database).toBe(harnessDatabase());
    if (config.db.urls.admin !== undefined) {
      // Scratch mode: a database of this run, dropped at the end.
      expect(row?.database).toMatch(/^elx_test_[0-9a-f]{12}$/);
    } else {
      // ci mode (global-setup.ts refuses it anywhere else): the throwaway ci database.
      expect(config.app.env).toBe('ci');
    }
  });

  it('seeds the two fixture accounts deterministically and idempotently', async () => {
    await seedFixtures(config.db);
    expect(await seedFixtures(config.db)).toBe(0);
    const rows = await owner<{ id: string; name: string; status: string }[]>`
      SELECT id, name, status FROM core_accounts
      WHERE id IN ${owner(accountFixtures.map((fixture) => fixture.id))} ORDER BY id`;
    expect(rows).toEqual(accountFixtures.map(({ id, name, status }) => ({ id, name, status })));
  });

  it('reads through a unit of work for one account', async () => {
    await owner`INSERT INTO core_accounts (id, name) VALUES (${accountId}, 'Sample account')`;
    const context: RequestContext = {
      accountId,
      membershipId: null,
      userId: null,
      deviceId: null,
      actingCrossTenant: false,
    };
    const pool = createAppPool(config.db, 'elx-sample-test');
    try {
      const own = await withUnitOfWork(pool.db, context, ({ tx, context: ctx }) =>
        tx
          .select({ name: coreAccounts.name })
          .from(coreAccounts)
          .where(eq(coreAccounts.id, ctx.accountId)),
      );
      expect(own).toEqual([{ name: 'Sample account' }]);
      const seen = await withUnitOfWork(pool.db, context, ({ tx }) =>
        tx
          .select({ id: coreAccounts.id })
          .from(coreAccounts)
          .where(inArray(coreAccounts.id, [accountId, ...accountFixtures.map((f) => f.id)])),
      );
      // With ELX_RLS=on only the context's own account is visible; with it off, all three.
      expect(seen.length).toBe(config.db.rls ? 1 : 3);
    } finally {
      await pool.close();
    }
  });
});
