import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, getPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import type { RowWrite } from '../outbox/outcome.js';
import type { OutboxMetadata, OutboxPageQuery, OutboxRecord } from '../outbox/outbox-list.js';
import { outboxPageCondition, outboxPageOrder } from '../outbox/outbox-list.js';
import type { BulkReplayFilter, ReplayCandidate, ReplayStore } from '../outbox/outbox-replay.js';
import {
  deadRowsCondition,
  liveDeadLetters,
  replayableCondition,
  replayedState,
} from '../outbox/outbox-replay.js';
import type { OutboxAppender, OutboxInsert } from '../outbox/outbox.repository.js';
import { coreConsumerDeadLetters, coreOutbox } from '../schema/outbox.js';

/** Every column but the payload: what is read without the door. */
function columnsWithoutPayload() {
  const { payload, ...columns } = getTableColumns(coreOutbox);
  void payload;
  return columns;
}
const metadataColumns = columnsWithoutPayload();

/** One internal consumer's lag and dead letters, as the database knows them. */
export interface ConsumerRowStats {
  /** Seconds since the oldest open event of its types without its receipt or dead letter. */
  readonly lagSeconds: number;
  /** Live (not replayed) dead letters. */
  readonly dead: number;
}

/** An open `internal_event` row whose last outcome parked it, with the consumers it named. */
export interface ParkedRow {
  readonly id: string;
  readonly consumers: readonly string[];
}

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
        set = { status: 'done', doneAt: now, parkedConsumers: null };
        break;
      case 'superseded':
        set = {
          status: 'superseded',
          doneAt: now,
          lastError: write.lastError,
          parkedConsumers: null,
        };
        break;
      case 'dead':
        set = {
          status: 'dead',
          attempts: write.attempts,
          lastError: write.lastError,
          parkedConsumers: null,
        };
        break;
      case 'enqueued':
        set = {
          status: 'enqueued',
          attempts: write.attempts,
          nextAttemptAt: write.nextAttemptAt,
          lastError: sql`coalesce(${write.lastError}, ${coreOutbox.lastError})`,
          enqueuedAt: sql`coalesce(${coreOutbox.enqueuedAt}, now())`,
          parkedConsumers: write.parkedConsumers === null ? null : [...write.parkedConsumers],
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

  /**
   * One page across every account without the payload (`platformListOutbox` without
   * `account_id`, PLAT-8 plan 2.7): the column is never read here.
   */
  metadataPage(query: OutboxPageQuery): Promise<OutboxMetadata[]> {
    return this.unscoped()
      .select(metadataColumns)
      .from(coreOutbox)
      .where(outboxPageCondition(query))
      .orderBy(...outboxPageOrder(query.sort))
      .limit(query.limit);
  }

  /** The account of a row (undefined: no such row; null: a platform-only row). */
  async accountOf(id: string): Promise<{ accountId: string | null } | undefined> {
    const [row] = await this.unscoped()
      .select({ accountId: coreOutbox.accountId })
      .from(coreOutbox)
      .where(eq(coreOutbox.id, id));
    return row;
  }

  /** A platform-only row (no account), payload included: only the replay reads it. */
  async findPlatformOnly(id: string): Promise<OutboxRecord | undefined> {
    const [row] = await this.unscoped()
      .select()
      .from(coreOutbox)
      .where(and(eq(coreOutbox.id, id), isNull(coreOutbox.accountId)));
    return row;
  }

  /** A row of any account without its payload. */
  async findMetadata(id: string): Promise<OutboxMetadata | undefined> {
    const [row] = await this.unscoped()
      .select(metadataColumns)
      .from(coreOutbox)
      .where(eq(coreOutbox.id, id));
    return row;
  }

  deadRows(
    filter: BulkReplayFilter,
    afterId: string | undefined,
    limit: number,
    scope: 'all' | 'platform-only',
  ): Promise<ReplayCandidate[]> {
    return this.unscoped()
      .select({
        id: coreOutbox.id,
        accountId: coreOutbox.accountId,
        kind: coreOutbox.kind,
        supersedeKey: coreOutbox.supersedeKey,
        createdAt: coreOutbox.createdAt,
      })
      .from(coreOutbox)
      .where(
        and(
          deadRowsCondition(filter, afterId),
          scope === 'platform-only' ? isNull(coreOutbox.accountId) : undefined,
        ),
      )
      .orderBy(desc(coreOutbox.id))
      .limit(limit);
  }

  async markPending(ids: readonly string[], scope: 'all' | 'platform-only'): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.unscoped()
      .update(coreOutbox)
      .set(replayedState())
      .where(
        and(
          inArray(coreOutbox.id, [...ids]),
          scope === 'platform-only' ? isNull(coreOutbox.accountId) : undefined,
          replayableCondition(),
        ),
      )
      .returning({ id: coreOutbox.id });
    return rows.map((row) => row.id);
  }

  async markDeadLettersReplayed(eventIds: readonly string[]): Promise<void> {
    if (eventIds.length === 0) return;
    await this.unscoped()
      .update(coreConsumerDeadLetters)
      .set({ replayedAt: new Date() })
      .where(liveDeadLetters(eventIds));
  }

  /** Lag and live dead letters of one consumer subscribed to `types` (`platformListConsumers`). */
  async consumerStats(consumer: string, types: readonly string[]): Promise<ConsumerRowStats> {
    const typeList = sql.join(
      types.map((type) => sql`${type}`),
      sql`, `,
    );
    const [row] = await this.unscoped().execute<{ lag: string | null; dead: string }>(sql`
      SELECT
        (SELECT extract(epoch FROM now() - min(o.created_at)) FROM core_outbox o
         WHERE o.kind = 'internal_event' AND o.status IN ('pending', 'enqueued')
           AND o.type IN (${typeList})
           AND NOT EXISTS (SELECT 1 FROM core_consumer_receipts r
                           WHERE r.consumer = ${consumer} AND r.event_id = o.id)
           AND NOT EXISTS (SELECT 1 FROM core_consumer_dead_letters d
                           WHERE d.consumer = ${consumer} AND d.event_id = o.id
                             AND d.replayed_at IS NULL))::text AS lag,
        (SELECT count(*) FROM core_consumer_dead_letters d
         WHERE d.consumer = ${consumer} AND d.replayed_at IS NULL)::text AS dead`);
    return {
      lagSeconds: row?.lag === null || row?.lag === undefined ? 0 : Math.max(0, Number(row.lag)),
      dead: Number(row?.dead ?? 0),
    };
  }

  /**
   * Open `internal_event` rows parked for some consumer (`parked_consumers`, written by the worker
   * with the dispatcher's outcome), oldest first, at most `limit`.
   */
  async parkedRows(limit: number): Promise<ParkedRow[]> {
    const rows = await this.unscoped()
      .select({ id: coreOutbox.id, consumers: coreOutbox.parkedConsumers })
      .from(coreOutbox)
      .where(
        and(
          eq(coreOutbox.kind, 'internal_event'),
          eq(coreOutbox.status, 'enqueued'),
          isNotNull(coreOutbox.parkedConsumers),
        ),
      )
      .orderBy(asc(coreOutbox.id))
      .limit(limit);
    return rows.map((row) => ({ id: row.id, consumers: row.consumers ?? [] }));
  }
}

/** The platform outbox of the current platform unit of work; throws outside one. */
export function currentPlatformOutbox(): PlatformOutbox {
  return new PlatformOutbox(getPlatformUnitOfWork());
}

/**
 * The replay store on the platform side: `platform-only` for a row of no account (no door can
 * open on it), `all` for a bulk replay across accounts (no payload is read).
 */
export function platformReplayStore(
  outbox: PlatformOutbox,
  scope: 'all' | 'platform-only',
): ReplayStore {
  return {
    find: (id) => outbox.findPlatformOnly(id),
    deadRows: (filter, afterId, limit) => outbox.deadRows(filter, afterId, limit, scope),
    markPending: (ids) => outbox.markPending(ids, scope),
    markDeadLettersReplayed: (ids) => outbox.markDeadLettersReplayed(ids),
  };
}
