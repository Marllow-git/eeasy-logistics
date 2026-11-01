import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { and, eq } from 'drizzle-orm';
import { coreOutbox } from '../schema/outbox.js';

/** An outbox row as the writer inserts it; the delivery state comes from the column defaults. */
export type OutboxInsert = Pick<
  typeof coreOutbox.$inferInsert,
  | 'id'
  | 'type'
  | 'eventVersion'
  | 'aggregateType'
  | 'aggregateId'
  | 'sequence'
  | 'causationId'
  | 'correlationId'
  | 'payload'
  | 'kind'
  | 'supersedeKey'
>;

/** What the writer needs from either side (tenant or platform) of `core_outbox`. */
export interface OutboxAppender {
  /** Marks the pending row holding `key` superseded; returns how many rows changed (0 or 1). */
  supersedePending(key: string): Promise<number>;
  /** Inserts the row; returns the transaction time the database stamped as `occurred_at`. */
  append(row: OutboxInsert): Promise<Date>;
}

/**
 * The tenant side of `core_outbox` (ADR-0025): every statement carries the context's account, so
 * a row is written for the context's account only and a supersede reaches that account's rows
 * only. Under the cross-tenant door the context's account is the door's target.
 */
export class OutboxRepository
  extends ScopedRepository<typeof coreOutbox>
  implements OutboxAppender
{
  constructor(uow: UnitOfWork) {
    super(uow, coreOutbox);
  }

  async supersedePending(key: string): Promise<number> {
    const rows = await this.updateWhere(
      { status: 'superseded' },
      and(eq(coreOutbox.supersedeKey, key), eq(coreOutbox.status, 'pending')),
    );
    return rows.length;
  }

  async append(row: OutboxInsert): Promise<Date> {
    const [inserted] = await this.insertMany([row]);
    if (inserted === undefined) throw new Error('The outbox insert returned no row');
    return inserted.occurredAt;
  }
}
