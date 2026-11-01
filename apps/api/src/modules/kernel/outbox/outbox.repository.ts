import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { coreConsumerDeadLetters, coreConsumerReceipts, coreOutbox } from '../schema/outbox.js';
import type { OutboxPageQuery, OutboxRecord } from './outbox-list.js';
import { outboxPageCondition, outboxPageOrder } from './outbox-list.js';
import type { BulkReplayFilter, ReplayCandidate, ReplayStore } from './outbox-replay.js';
import {
  deadRowsCondition,
  liveDeadLetters,
  replayableCondition,
  replayedState,
} from './outbox-replay.js';

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

  /** One page of the context account's rows, payload included (the door's `platformListOutbox`). */
  page(query: OutboxPageQuery): Promise<OutboxRecord[]> {
    return this.findMany(outboxPageCondition(query), {
      orderBy: outboxPageOrder(query.sort),
      limit: query.limit,
    });
  }

  async find(id: string): Promise<OutboxRecord | undefined> {
    const [row] = await this.findMany(eq(coreOutbox.id, id), { limit: 1 });
    return row;
  }

  deadRows(
    filter: BulkReplayFilter,
    afterId: string | undefined,
    limit: number,
  ): Promise<ReplayCandidate[]> {
    return this.findMany(deadRowsCondition(filter, afterId), {
      orderBy: [desc(coreOutbox.id)],
      limit,
    });
  }

  async markPending(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.updateWhere(
      replayedState(),
      and(inArray(coreOutbox.id, [...ids]), replayableCondition()),
    );
    return rows.map((row) => row.id);
  }
}

/** The tenant side of `core_consumer_dead_letters` (the door's replay). */
export class ConsumerDeadLetterRepository extends ScopedRepository<typeof coreConsumerDeadLetters> {
  constructor(uow: UnitOfWork) {
    super(uow, coreConsumerDeadLetters);
  }

  async markReplayed(eventIds: readonly string[]): Promise<void> {
    if (eventIds.length === 0) return;
    await this.updateWhere({ replayedAt: new Date() }, liveDeadLetters(eventIds));
  }
}

/**
 * The tenant side of `core_consumer_receipts` (adversary M-3): an internal consumer of an account's
 * event claims its receipt in the tenant unit of work it then runs in, on `elx_app`.
 */
export class ConsumerReceiptRepository extends ScopedRepository<typeof coreConsumerReceipts> {
  constructor(uow: UnitOfWork) {
    super(uow, coreConsumerReceipts);
  }

  /** Inserts the receipt; false when it exists (the event was processed: skip). */
  async claim(consumer: string, eventId: string): Promise<boolean> {
    const inserted = await this.insertIgnoringConflicts([{ consumer, eventId }]);
    return inserted.length === 1;
  }
}

/** The replay store of the door: the context account's rows only. */
export function tenantReplayStore(uow: UnitOfWork): ReplayStore {
  const rows = new OutboxRepository(uow);
  const letters = new ConsumerDeadLetterRepository(uow);
  return {
    find: (id) => rows.find(id),
    deadRows: (filter, afterId, limit) => rows.deadRows(filter, afterId, limit),
    markPending: (ids) => rows.markPending(ids),
    markDeadLettersReplayed: (ids) => letters.markReplayed(ids),
  };
}
