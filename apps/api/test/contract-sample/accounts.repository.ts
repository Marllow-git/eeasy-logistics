import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository } from '@eeasy-logistics/db/platform';
import { desc, inArray } from 'drizzle-orm';
import type { AccountStatus } from '../../src/modules/kernel/schema/accounts.js';
import { coreAccounts } from '../../src/modules/kernel/schema/accounts.js';

// The sample's repository (PLAT-6 item I): its own Drizzle types, never a contract type (doc 3 §9
// "Contract code stops at the edge"). Test-only: listing accounts ships with its own order.

export type AccountRow = typeof coreAccounts.$inferSelect;

export class SampleAccounts extends PlatformRepository<typeof coreAccounts> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreAccounts);
  }

  async list(filter: {
    readonly statuses: readonly AccountStatus[];
    readonly limit: number;
  }): Promise<AccountRow[]> {
    const query = this.unscoped().select().from(coreAccounts);
    const filtered =
      filter.statuses.length === 0
        ? query
        : query.where(inArray(coreAccounts.status, [...filter.statuses]));
    return filtered
      .orderBy(desc(coreAccounts.createdAt), desc(coreAccounts.id))
      .limit(filter.limit);
  }
}
