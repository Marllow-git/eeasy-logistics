import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository } from '@eeasy-logistics/db/platform';
import { coreAccounts } from '../modules/kernel/schema/accounts.js';
import type { AccountFixture } from './fixtures.js';

/** Writes fixture accounts across tenants (seed tool only; local and ci). */
export class FixtureAccountsRepository extends PlatformRepository<typeof coreAccounts> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreAccounts);
  }

  /** Inserts the accounts that do not exist yet; returns how many were inserted. */
  async insertMissing(accounts: readonly AccountFixture[]): Promise<number> {
    const inserted = await this.unscoped()
      .insert(coreAccounts)
      .values([...accounts])
      .onConflictDoNothing({ target: coreAccounts.id })
      .returning({ id: coreAccounts.id });
    return inserted.length;
  }
}
