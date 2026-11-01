import type { SQL } from 'drizzle-orm';
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { OutboxKind } from '../schema/outbox.js';
import { coreConsumerDeadLetters, coreOutbox } from '../schema/outbox.js';
import type { OutboxRecord } from './outbox-list.js';
import type { OutboxQueues } from './queues.js';

// Replay of dead outbox rows by platform staff (PLAT-8 plan 2.7; data §5.2, §5.3; integrations
// §4.5; K-10). Only the delivery state changes: `dead` → `pending` with the attempts reset and
// `next_attempt_at = now()`; the envelope trigger refuses anything else. A row older than the
// consumer-receipt window (35 days) is never replayed: its receipts may be purged, so a replay
// could repeat an effect. The row's retained BullMQ job is removed first (its `jobId` is the row
// id, so the relay's re-add would otherwise be a no-op), and its consumer dead letters are marked
// `replayed_at`, so the dispatcher runs those consumers again.

/** Consumer receipts are kept 35 days (data §5.3); replay refuses rows older than that (§5.2). */
export const replayWindowDays = 35;
/** Rows per bulk replay batch (plan 2.7). */
export const replayBatchSize = 500;
/** Replayed row ids a bulk replay's audit row lists at most (adversary M-1). */
export const replayAuditIdLimit = 500;

export type ReplayRefusal =
  'not_dead' | 'outside_receipt_window' | 'supersede_pending' | 'job_active';

/** A dead row a bulk replay considers. */
export type ReplayCandidate = Pick<
  OutboxRecord,
  'id' | 'accountId' | 'kind' | 'supersedeKey' | 'createdAt'
>;

export interface BulkReplayFilter {
  readonly kind: OutboxKind;
  readonly type?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

/**
 * The rows a replay reads and writes: the tenant side under the door (its statements carry the
 * door's account) or the platform side (platform-only rows, and a bulk replay across accounts).
 */
export interface ReplayStore {
  find(id: string): Promise<OutboxRecord | undefined>;
  /** Dead rows of the filter before `afterId`, newest first (id descending), at most `limit`. */
  deadRows(
    filter: BulkReplayFilter,
    afterId: string | undefined,
    limit: number,
  ): Promise<ReplayCandidate[]>;
  /** Sets the rows `pending` where the replay rules hold; returns the ids changed. */
  markPending(ids: readonly string[]): Promise<string[]>;
  /** Marks the live dead letters of these events replayed. */
  markDeadLettersReplayed(eventIds: readonly string[]): Promise<void>;
}

/**
 * The delivery state a replay writes (never an envelope column): due now, by the API's clock (the
 * tenant repository takes values, not SQL; a clock a little ahead only delays one relay tick).
 */
export function replayedState() {
  return {
    status: 'pending',
    attempts: 0,
    deferrals: 0,
    nextAttemptAt: new Date(),
    enqueuedAt: null,
    doneAt: null,
    parkedConsumers: null,
  } as const;
}

/**
 * The replay rules as one predicate on `core_outbox` (the statement's own row): still `dead`,
 * created inside the window, and no pending row holding the same supersede key in the same
 * account (the partial unique index allows one).
 */
export function replayableCondition(): SQL {
  const t = coreOutbox;
  return sql`${t.status} = 'dead'
    AND ${t.createdAt} >= now() - make_interval(days => ${replayWindowDays})
    AND (${t.supersedeKey} IS NULL OR NOT EXISTS (
      SELECT 1 FROM core_outbox p
      WHERE p.status = 'pending' AND p.supersede_key = ${t.supersedeKey}
        AND p.account_id IS NOT DISTINCT FROM ${t.accountId}))`;
}

/** The dead-row filter of a bulk replay (without any account predicate). */
export function deadRowsCondition(
  filter: BulkReplayFilter,
  afterId: string | undefined,
): SQL | undefined {
  const t = coreOutbox;
  return and(
    eq(t.status, 'dead'),
    eq(t.kind, filter.kind),
    filter.type === undefined ? undefined : eq(t.type, filter.type),
    filter.from === undefined ? undefined : gte(t.createdAt, new Date(filter.from)),
    filter.to === undefined ? undefined : lt(t.createdAt, new Date(filter.to)),
    afterId === undefined ? undefined : sql`${t.id} < ${afterId}`,
  );
}

/** Live (not yet replayed) dead letters of the events. */
export function liveDeadLetters(eventIds: readonly string[]): SQL | undefined {
  const d = coreConsumerDeadLetters;
  return and(
    sql`${d.eventId} IN (${sql.join(
      eventIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`,
    isNull(d.replayedAt),
  );
}

export type SingleReplay =
  | { readonly replayed: true; readonly before: OutboxRecord }
  | { readonly replayed: false; readonly refusal: ReplayRefusal; readonly current: OutboxRecord }
  | undefined;

function olderThanWindow(row: OutboxRecord, now: Date): boolean {
  return now.getTime() - row.createdAt.getTime() > replayWindowDays * 24 * 60 * 60 * 1000;
}

/**
 * Replays one row: undefined when the store does not see it. The checks run in order: `dead`, the
 * window, a running job (it cannot be removed), then the guarded update, whose miss means a
 * pending row holds the key (or the row changed meanwhile). Only once the update returned the row
 * is its retained job removed (lead review round 3), so a refused replay keeps the job; a job that
 * started running in between is refused `job_active`, and the caller's transaction (rolled back by
 * the refusal) undoes the update.
 */
export async function replayOne(
  store: ReplayStore,
  queues: OutboxQueues,
  id: string,
  now: Date = new Date(),
): Promise<SingleReplay> {
  const row = await store.find(id);
  if (row === undefined) return undefined;
  const refuse = (refusal: ReplayRefusal): SingleReplay => ({
    replayed: false,
    refusal,
    current: row,
  });
  if (row.status !== 'dead') return refuse('not_dead');
  if (olderThanWindow(row, now)) return refuse('outside_receipt_window');
  if ((await queues.lockedJobs(row.kind, [row.id])).has(row.id)) return refuse('job_active');
  const changed = await store.markPending([row.id]);
  if (changed.length === 0) {
    const again = await store.find(id);
    if (again !== undefined && again.status !== 'dead') return refuse('not_dead');
    return refuse(row.supersedeKey === null ? 'outside_receipt_window' : 'supersede_pending');
  }
  if ((await queues.removeJobs(row.kind, changed)).has(row.id)) return refuse('job_active');
  await store.markDeadLettersReplayed(changed);
  return { replayed: true, before: row };
}

export interface BulkReplayCounts {
  /** Dead rows of the filter. */
  readonly matched: number;
  /** Rows set `pending`. */
  readonly replayed: number;
  /** Their ids, at most `replayAuditIdLimit`. */
  readonly ids: readonly string[];
}

/**
 * Replays the dead rows of the filter in batches of 500 (newest first). Rows the rules refuse (the
 * window, a pending supersede key, a running job) stay `dead` and count as matched only; of two
 * dead rows of one supersede key only the newest is replayed (the relay orders by sequence anyway).
 */
export async function replayBulk(
  store: ReplayStore,
  queues: OutboxQueues,
  filter: BulkReplayFilter,
  batchSize: number = replayBatchSize,
): Promise<BulkReplayCounts> {
  let matched = 0;
  let replayed = 0;
  const replayedIds: string[] = [];
  let afterId: string | undefined;
  for (;;) {
    const batch = await store.deadRows(filter, afterId, batchSize);
    matched += batch.length;
    const last = batch.at(-1);
    if (last === undefined) break;
    afterId = last.id;
    const running = await queues.lockedJobs(
      filter.kind,
      batch.map((row) => row.id),
    );
    // Newest first: the first row of a key in the batch is its newest (an older one of an earlier
    // batch is refused by the pending row of this key once it is replayed).
    const newestPerKey = new Map<string, string>();
    for (const row of batch) {
      const key = `${row.accountId ?? ''}/${row.supersedeKey ?? ''}`;
      if (row.supersedeKey !== null && !newestPerKey.has(key)) newestPerKey.set(key, row.id);
    }
    const ids = batch
      .filter((row) => !running.has(row.id))
      .filter(
        (row) =>
          row.supersedeKey === null ||
          newestPerKey.get(`${row.accountId ?? ''}/${row.supersedeKey}`) === row.id,
      )
      .map((row) => row.id);
    const changed = ids.length === 0 ? [] : await store.markPending(ids);
    if (changed.length > 0) {
      // Jobs go only for rows the guarded update set `pending` (lead review round 3). A job that
      // started running since the lock check fails the whole request, rolling the batch back.
      const left = await queues.removeJobs(filter.kind, changed);
      if (left.size > 0) throw new Error('An outbox job started running during a bulk replay');
      await store.markDeadLettersReplayed(changed);
    }
    replayed += changed.length;
    replayedIds.push(...changed.slice(0, Math.max(0, replayAuditIdLimit - replayedIds.length)));
    if (batch.length < batchSize) break;
  }
  return { matched, replayed, ids: replayedIds };
}
