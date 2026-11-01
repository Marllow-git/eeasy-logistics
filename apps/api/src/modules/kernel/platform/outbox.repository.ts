import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository } from '@eeasy-logistics/db/platform';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { RowWrite } from '../outbox/outcome.js';
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

  /**
   * The queue worker's outcome write (PLAT-8 plan 2.5): one statement, only while the row is still
   * `pending` or `enqueued` (a replay or another delivery that finished first wins). Returns
   * whether the row changed.
   */
  async writeOutcome(id: string, write: RowWrite): Promise<boolean> {
    const now = sql`now()`;
    let set: PgUpdateSetSource<typeof coreOutbox>;
    switch (write.status) {
      case 'done':
        set = { status: 'done', doneAt: now };
        break;
      case 'superseded':
        set = { status: 'superseded', doneAt: now, lastError: write.lastError };
        break;
      case 'dead':
        set = { status: 'dead', attempts: write.attempts, lastError: write.lastError };
        break;
      case 'enqueued':
        set = {
          status: 'enqueued',
          attempts: write.attempts,
          nextAttemptAt: write.nextAttemptAt,
          lastError: sql`coalesce(${write.lastError}, ${coreOutbox.lastError})`,
          enqueuedAt: sql`coalesce(${coreOutbox.enqueuedAt}, now())`,
        };
        break;
    }
    const changed = await this.unscoped()
      .update(coreOutbox)
      .set(set)
      .where(and(eq(coreOutbox.id, id), inArray(coreOutbox.status, ['pending', 'enqueued'])))
      .returning({ id: coreOutbox.id });
    return changed.length === 1;
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
