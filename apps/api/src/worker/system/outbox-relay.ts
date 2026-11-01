import { randomUUID } from 'node:crypto';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { KindHandlerRegistry, RelayRow } from '../../modules/kernel/outbox/kind-handlers.js';
import type { OutboxQueues } from '../../modules/kernel/outbox/queues.js';
import type { OutboxKind } from '../../modules/kernel/schema/outbox.js';

// The outbox relay (PLAT-8 plan 2.3; ADR-0024, ADR-0036; integrations §4.4; data §5.2): a system
// job of `--role worker` on the elx_platform pool. One leader at a time by the Redis lock; the
// leader moves due rows into the BullMQ queue of their kind in per-scope order and marks them
// `enqueued`, in one transaction per batch; a sweeper returns rows whose job Redis lost. The relay
// makes no external call: it only reads and writes core_outbox and adds job ids to Redis.

export const relayLockKey = 'elx:lock:outbox-relay';
export interface RelayTimings {
  readonly lockTtlMs: number;
  readonly renewEveryMs: number;
  readonly safetyMs: number;
  readonly pollEveryMs: number;
  readonly sweepEveryMs: number;
  readonly stuckAfterMs: number;
}

export const relayTimings: RelayTimings = {
  /** Lock TTL (`SET NX PX 10000`, integrations §4.4). */
  lockTtlMs: 10_000,
  /** Renewal period; a failed renewal stops relaying at once. */
  renewEveryMs: 3_000,
  /** Relaying stops this long before the lock could expire without a renewal. */
  safetyMs: 1_000,
  /** Fallback poll when no NOTIFY arrives. */
  pollEveryMs: 1_000,
  sweepEveryMs: 60_000,
  /** An `enqueued` row older than this whose job is gone returns to `pending`. */
  stuckAfterMs: 5 * 60_000,
};
export const sweepBatchSize = 500;

/** The metric the sweeper reports: due rows of a kind with no handler in this build. */
export const rowsWithoutHandlerMetric = 'outbox_rows_without_handler';

export type RelayQueues = Pick<OutboxQueues, 'add' | 'hasJob'>;

interface RowRecord extends Record<string, unknown> {
  id: string;
  kind: OutboxKind;
  account_id: string | null;
  type: string;
  aggregate_type: string;
  aggregate_id: string;
  sequence: number;
}

const columns = sql.raw(
  'o.id, o.kind, o.account_id, o.type, o.aggregate_type, o.aggregate_id, o.sequence',
);

const toRelayRow = (row: RowRecord): RelayRow => ({
  id: row.id,
  kind: row.kind,
  accountId: row.account_id,
  type: row.type,
  aggregateType: row.aggregate_type,
  aggregateId: row.aggregate_id,
  sequence: row.sequence,
});

const list = (values: readonly string[]): SQL =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

/** (sequence, id) order within one scope: one change's events share a sequence (ADR-0027). */
const before = (a: RelayRow, b: RelayRow): boolean =>
  a.sequence < b.sequence || (a.sequence === b.sequence && a.id < b.id);

/**
 * The rows of `candidates` that may leave now: those whose ordering scope (kind, aggregate and the
 * handler's key) has no earlier row among `open` (rows still `pending` or `enqueued`, the
 * candidates included). A row without a key is never held. Pure, so it is unit-tested.
 */
export function releasable(
  candidates: readonly RelayRow[],
  open: readonly RelayRow[],
  registry: KindHandlerRegistry,
): RelayRow[] {
  const keyOf = (row: RelayRow) => registry.get(row.kind)?.orderingKey(row) ?? null;
  const scopes = new Map<string, RelayRow[]>();
  for (const row of open) {
    const key = keyOf(row);
    if (key === null) continue;
    const scope = `${row.kind}\u0000${row.aggregateId}\u0000${key}`;
    const rows = scopes.get(scope) ?? [];
    rows.push(row);
    scopes.set(scope, rows);
  }
  return candidates.filter((row) => {
    const key = keyOf(row);
    if (key === null) return true;
    const scope = scopes.get(`${row.kind}\u0000${row.aggregateId}\u0000${key}`) ?? [];
    return !scope.some((other) => other.id !== row.id && before(other, row));
  });
}

export interface RelayBatch {
  /** Rows enqueued and marked `enqueued`. */
  readonly relayed: number;
  /** Due rows held back by the ordering rule. */
  readonly held: number;
  /** Due rows selected (at most the batch size). */
  readonly selected: number;
}

/**
 * One relay batch, in one transaction on the platform pool: selects up to `batchSize` due rows of
 * kinds with a handler, of accounts that are not suspended (K-2; platform-only rows always),
 * `ORDER BY id … FOR UPDATE OF o SKIP LOCKED` (a second leader after a lost lock skips them),
 * drops the rows the ordering rule holds, adds one job per row (`jobId` = row id) and marks them
 * `enqueued`. A Redis failure throws and rolls the marks back; the rows stay `pending`.
 */
export async function relayBatch(
  db: PlatformDatabase,
  queues: RelayQueues,
  registry: KindHandlerRegistry,
  batchSize: number,
): Promise<RelayBatch> {
  const kinds = registry.kinds;
  if (kinds.length === 0) return { relayed: 0, held: 0, selected: 0 };
  return db.transaction(async (tx) => {
    const due = (
      await tx.execute<RowRecord>(sql`
        SELECT ${columns}
        FROM core_outbox o
        LEFT JOIN core_accounts a ON a.id = o.account_id
        WHERE o.status = 'pending' AND o.next_attempt_at <= now()
          AND o.kind IN (${list(kinds)})
          AND (o.account_id IS NULL OR a.status <> 'suspended')
        ORDER BY o.id
        LIMIT ${batchSize}
        FOR UPDATE OF o SKIP LOCKED`)
    ).map(toRelayRow);
    if (due.length === 0) return { relayed: 0, held: 0, selected: 0 };

    const aggregates = [...new Set(due.map((row) => row.aggregateId))];
    const open = (
      await tx.execute<RowRecord>(sql`
        SELECT ${columns}
        FROM core_outbox o
        WHERE o.aggregate_id IN (${list(aggregates)})
          AND o.status IN ('pending', 'enqueued')
          AND o.kind IN (${list(kinds)})`)
    ).map(toRelayRow);
    const ready = releasable(due, open, registry);
    if (ready.length === 0) return { relayed: 0, held: due.length, selected: due.length };

    const byKind = new Map<OutboxKind, string[]>();
    for (const row of ready) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row.id]);
    for (const [kind, ids] of byKind) await queues.add(kind, ids);
    await tx.execute(sql`
      UPDATE core_outbox SET status = 'enqueued', enqueued_at = now()
      WHERE id IN (${list(ready.map((row) => row.id))}) AND status = 'pending'`);
    return { relayed: ready.length, held: due.length - ready.length, selected: due.length };
  });
}

/**
 * The sweeper (integrations §4.4): rows `enqueued` for longer than `stuckAfterMs` whose job is no
 * longer in their queue (Redis lost it) return to `pending`, so the relay enqueues them again.
 * Returns how many rows it returned.
 */
export async function sweepStuckRows(
  db: PlatformDatabase,
  queues: RelayQueues,
  stuckAfterMs: number = relayTimings.stuckAfterMs,
): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string; kind: OutboxKind }>(sql`
      SELECT id, kind FROM core_outbox
      WHERE status = 'enqueued'
        AND enqueued_at < now() - make_interval(secs => ${stuckAfterMs / 1000})
      ORDER BY enqueued_at
      LIMIT ${sweepBatchSize}
      FOR UPDATE SKIP LOCKED`);
    const lost: string[] = [];
    for (const row of rows) {
      if (!(await queues.hasJob(row.kind, row.id))) lost.push(row.id);
    }
    if (lost.length === 0) return 0;
    await tx.execute(sql`
      UPDATE core_outbox SET status = 'pending', enqueued_at = NULL
      WHERE id IN (${list(lost)}) AND status = 'enqueued'`);
    return lost.length;
  });
}

/** Due rows whose kind has no handler in this build (the `outbox_rows_without_handler` gauge). */
export async function countRowsWithoutHandler(
  db: PlatformDatabase,
  registry: KindHandlerRegistry,
): Promise<number> {
  const kinds = registry.kinds;
  const handled = kinds.length === 0 ? sql`` : sql`AND kind NOT IN (${list(kinds)})`;
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM core_outbox
    WHERE status = 'pending' AND next_attempt_at <= now() ${handled}`);
  return row?.n ?? 0;
}

type LeaseRedis = Pick<Redis, 'set' | 'eval'>;

const renewScript = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;
const releaseScript = `if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1]) else return 0 end`;

/** A Redis lock held by one token (`SET NX PX`), renewed and released only by its holder. */
export class RedisLease {
  readonly token = randomUUID();

  constructor(
    private readonly redis: LeaseRedis,
    private readonly key: string,
    private readonly ttlMs: number,
  ) {}

  async acquire(): Promise<boolean> {
    return (await this.redis.set(this.key, this.token, 'PX', this.ttlMs, 'NX')) === 'OK';
  }

  async renew(): Promise<boolean> {
    return (await this.redis.eval(renewScript, 1, this.key, this.token, this.ttlMs)) === 1;
  }

  async release(): Promise<void> {
    await this.redis.eval(releaseScript, 1, this.key, this.token);
  }
}

export interface RelayStats {
  ticks: number;
  relayed: number;
  held: number;
  swept: number;
  /** Last value of the `outbox_rows_without_handler` gauge. */
  rowsWithoutHandler: number;
  failures: number;
}

export interface RelayDependencies {
  readonly db: PlatformDatabase;
  readonly queues: RelayQueues;
  readonly registry: KindHandlerRegistry;
  readonly redis: LeaseRedis;
  /** LISTEN elx_outbox on a dedicated connection; resolves with the function that stops it. */
  readonly listen: (onNotify: () => void) => Promise<() => Promise<void>>;
  readonly batchSize: number;
  readonly logger: { log(message: string): void; warn(message: string): void };
  readonly lockKey?: string;
  readonly timings?: Partial<RelayTimings>;
}

/**
 * The relay loop of one worker process (plan 2.3, 2.9). Every `renewEveryMs` it renews the lock it
 * holds, or tries to take it; a renewal that fails (or an error) ends its leadership at once, and
 * it relays only while the lock is surely its own (`lockTtlMs - safetyMs` after the last good
 * renewal). The leader listens on elx_outbox, polls every second as a fallback, drains batches
 * while they come back full, and sweeps every minute. `stop()` ends the loop, waits for the batch
 * in flight and releases the lock.
 */
export class OutboxRelay {
  readonly stats: RelayStats = {
    ticks: 0,
    relayed: 0,
    held: 0,
    swept: 0,
    rowsWithoutHandler: 0,
    failures: 0,
  };
  readonly #deps: RelayDependencies;
  readonly #timings: RelayTimings;
  readonly #lease: RedisLease;
  #leader = false;
  #validUntil = 0;
  #stopped = false;
  #unlisten: (() => Promise<void>) | undefined;
  #running: Promise<void> | undefined;
  #again = false;
  #timers: NodeJS.Timeout[] = [];
  #leaseCheck: Promise<void> | undefined;

  constructor(deps: RelayDependencies) {
    this.#deps = deps;
    this.#timings = { ...relayTimings, ...deps.timings };
    this.#lease = new RedisLease(deps.redis, deps.lockKey ?? relayLockKey, this.#timings.lockTtlMs);
  }

  /** Whether this process may relay now. */
  get leading(): boolean {
    return this.#leader && !this.#stopped && Date.now() < this.#validUntil - this.#timings.safetyMs;
  }

  async start(): Promise<void> {
    await this.#checkLease();
    this.#timers = [
      setInterval(() => void this.#checkLease(), this.#timings.renewEveryMs),
      setInterval(() => this.requestTick(), this.#timings.pollEveryMs),
      setInterval(() => void this.#sweep(), this.#timings.sweepEveryMs),
    ];
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    for (const timer of this.#timers) clearInterval(timer);
    this.#timers = [];
    await this.#leaseCheck;
    await this.#running;
    await this.#resign(true);
  }

  /** Runs a batch now, or right after the one in flight; a no-op unless leading. */
  requestTick(): void {
    if (!this.leading) return;
    if (this.#running !== undefined) {
      this.#again = true;
      return;
    }
    this.#running = this.#drain().finally(() => {
      this.#running = undefined;
    });
  }

  async #drain(): Promise<void> {
    do {
      this.#again = false;
      if (!this.leading) return;
      try {
        const batch = await relayBatch(
          this.#deps.db,
          this.#deps.queues,
          this.#deps.registry,
          this.#deps.batchSize,
        );
        this.stats.ticks += 1;
        this.stats.relayed += batch.relayed;
        this.stats.held += batch.held;
        // A full batch means more rows may be due: go again at once.
        if (batch.selected === this.#deps.batchSize && batch.relayed > 0) this.#again = true;
      } catch (error) {
        this.stats.failures += 1;
        this.#deps.logger.warn(`Outbox relay batch failed: ${errorName(error)}`);
        return;
      }
    } while (this.#again);
  }

  #checkLease(): Promise<void> {
    if (this.#leaseCheck !== undefined || this.#stopped)
      return this.#leaseCheck ?? Promise.resolve();
    this.#leaseCheck = this.#renewOrAcquire().finally(() => {
      this.#leaseCheck = undefined;
    });
    return this.#leaseCheck;
  }

  async #renewOrAcquire(): Promise<void> {
    const started = Date.now();
    try {
      if (this.#leader) {
        if (await this.#lease.renew()) {
          this.#validUntil = started + this.#timings.lockTtlMs;
          return;
        }
        this.#deps.logger.warn('Outbox relay lock lost: relaying stopped');
        await this.#resign(false);
        return;
      }
      if (!(await this.#lease.acquire())) return;
      if (this.#stopped) {
        await this.#lease.release();
        return;
      }
      this.#leader = true;
      this.#validUntil = started + this.#timings.lockTtlMs;
      this.#deps.logger.log('Outbox relay lock taken: relaying');
      this.#unlisten = await this.#deps.listen(() => this.requestTick());
      this.requestTick();
      void this.#sweep();
    } catch (error) {
      this.stats.failures += 1;
      if (this.#leader) {
        this.#deps.logger.warn(
          `Outbox relay lock check failed (${errorName(error)}): relaying stopped`,
        );
        await this.#resign(false);
      }
    }
  }

  /** Ends leadership: stops listening and, when asked, releases the lock (only if still ours). */
  async #resign(release: boolean): Promise<void> {
    const wasLeader = this.#leader;
    this.#leader = false;
    this.#validUntil = 0;
    const unlisten = this.#unlisten;
    this.#unlisten = undefined;
    await unlisten?.().catch(() => undefined);
    if (release && wasLeader) await this.#lease.release().catch(() => undefined);
  }

  async #sweep(): Promise<void> {
    if (!this.leading) return;
    try {
      const swept = await sweepStuckRows(
        this.#deps.db,
        this.#deps.queues,
        this.#timings.stuckAfterMs,
      );
      this.stats.swept += swept;
      if (swept > 0) this.#deps.logger.warn(`Outbox sweeper returned ${swept} rows without a job`);
      const waiting = await countRowsWithoutHandler(this.#deps.db, this.#deps.registry);
      this.stats.rowsWithoutHandler = waiting;
      if (waiting > 0) {
        this.#deps.logger.warn(
          `${rowsWithoutHandlerMetric}=${waiting}: due rows of kinds with no handler`,
        );
      }
      if (swept > 0) this.requestTick();
    } catch (error) {
      this.stats.failures += 1;
      this.#deps.logger.warn(`Outbox sweep failed: ${errorName(error)}`);
    }
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
