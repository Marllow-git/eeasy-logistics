import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository } from '@eeasy-logistics/db/platform';
import { eq } from 'drizzle-orm';
import { coreAccounts } from '../schema/accounts.js';

/** Platform reads of `core_accounts` (elx_platform, every account). */
export class AccountsDirectory extends PlatformRepository<typeof coreAccounts> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreAccounts);
  }

  /** Whether `accountId` names an account, whatever its status (support reaches suspended ones). */
  async exists(accountId: string): Promise<boolean> {
    const rows = await this.unscoped()
      .select({ id: coreAccounts.id })
      .from(coreAccounts)
      .where(eq(coreAccounts.id, accountId))
      .limit(1);
    return rows.length === 1;
  }
}
