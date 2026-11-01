import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository } from '@eeasy-logistics/db/platform';
import { and, eq, isNull } from 'drizzle-orm';
import type { OutboxAppender, OutboxInsert } from '../outbox/outbox.repository.js';
import { coreOutbox } from '../schema/outbox.js';

export type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';

/**
 * The platform side of the outbox writer (elx_platform, no account): a platform-only effect
 * (data §2.4, PLAT-8 plan 2.1) is written with `account_id` NULL, never with an account the caller
 * names, and a supersede reaches only rows without an account. Tenant effects are written through
 * the tenant unit of work (`OutboxRepository`), the cross-tenant door included.
 */
export class PlatformOutbox
  extends PlatformRepository<typeof coreOutbox>
  implements OutboxAppender
{
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreOutbox);
  }

  async supersedePending(key: string): Promise<number> {
    const rows = await this.unscoped()
      .update(coreOutbox)
      .set({ status: 'superseded' })
      .where(
        and(
          isNull(coreOutbox.accountId),
          eq(coreOutbox.supersedeKey, key),
          eq(coreOutbox.status, 'pending'),
        ),
      )
      .returning({ id: coreOutbox.id });
    return rows.length;
  }

  async append(row: OutboxInsert): Promise<Date> {
    const [inserted] = await this.unscoped()
      .insert(coreOutbox)
      .values({ ...row, accountId: null })
      .returning({ occurredAt: coreOutbox.occurredAt });
    if (inserted === undefined) throw new Error('The outbox insert returned no row');
    return inserted.occurredAt;
  }
}
