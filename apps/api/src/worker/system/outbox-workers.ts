import { isUuid } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import type { Job } from 'bullmq';
import { DelayedError, UnrecoverableError, Worker } from 'bullmq';
import { eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type {
  KindHandler,
  KindHandlerRegistry,
  KindOutcome,
  OutboxRow,
} from '../../modules/kernel/outbox/kind-handlers.js';
import type { QueuePolicy } from '../../modules/kernel/outbox/queue-options.js';
import {
  bullLimiter,
  outboxBackoffType,
  outboxQueuePolicies,
  retryDelayMs,
} from '../../modules/kernel/outbox/queue-options.js';
import type { OutboxJobData } from '../../modules/kernel/outbox/queues.js';
import { outboxQueueName, outboxQueuePrefix } from '../../modules/kernel/outbox/queues.js';
import type { OutboxKind } from '../../modules/kernel/schema/outbox.js';
import { coreOutbox } from '../../modules/kernel/schema/outbox.js';

// The consumer side of the outbox queues (PLAT-8 plan 2.4, 2.5, 2.9; ADR-0024, ADR-0036;
// integrations §4.2, §4.4): one BullMQ Worker per kind with a handler, with that kind's options. A
// job is `{ outboxId }` only, so the processor re-reads the row (Redis is not a source of truth),
// has the kind's handler execute it and writes the outcome to the row before the job ends: a
// completed job always means the row has left `enqueued` (lead review round 1, ruling 3).

/** Workers drain in-flight jobs this long on SIGTERM (platform §5). */
export const shutdownGraceMs = 30_000;

/** Rows a job may execute: `pending` too, as the relay adds jobs before its batch commits. */
const runnable: ReadonlySet<string> = new Set(['pending', 'enqueued']);

export interface OutboxWorkerLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface OutboxWorkerDependencies {
  readonly db: PlatformDatabase;
  /** Shared by the workers (BullMQ duplicates it for its blocking reads); never closed here. */
  readonly connection: Redis;
  readonly registry: KindHandlerRegistry;
  readonly logger: OutboxWorkerLogger;
  /** BullMQ key prefix; tests use one per run. */
  readonly prefix?: string;
  /** Per-kind overrides of the §4.2 table (tests only: concurrency, timings). */
  readonly policies?: Partial<Record<OutboxKind, QueuePolicy>>;
  /** For full jitter; tests pin it. */
  readonly random?: () => number;
}

/** What happened to one job, for logs and tests. */
export type JobResult = 'skipped' | KindOutcome['outcome'];

/** The row of `outboxId`, or undefined when it is gone (pruned) or never existed. */
async function readRow(db: PlatformDatabase, outboxId: string): Promise<OutboxRow | undefined> {
  const [row] = await db.select().from(coreOutbox).where(eq(coreOutbox.id, outboxId));
  return row;
}

/**
 * Writes `outcome` to the row in one statement on the platform pool, only while the row is still
 * `pending` or `enqueued` (a replay or a second delivery that finished first wins). Returns whether
 * the row changed.
 */
export async function writeOutcome(
  db: PlatformDatabase,
  row: OutboxRow,
  outcome: KindOutcome,
): Promise<boolean> {
  let set;
  switch (outcome.outcome) {
    case 'done':
      set = sql`status = 'done', done_at = now()`;
      break;
    case 'superseded':
      set = sql`status = 'superseded', done_at = now(), last_error = ${outcome.reason}`;
      break;
    default:
      throw new Error(`Outcome ${outcome.outcome} is not written yet`);
  }
  const changed = await db.execute<{ id: string }>(sql`
    UPDATE core_outbox SET ${set}
    WHERE id = ${row.id} AND status IN ('pending', 'enqueued')
    RETURNING id`);
  return changed.length === 1;
}

/** Runs the handler; E turns thrown failures into outcomes. */
async function execute(handler: KindHandler, row: OutboxRow): Promise<KindOutcome> {
  return handler.execute(row);
}

/**
 * One job of the queue of `kind`: re-reads the row, skips it unless it is `pending` or `enqueued`
 * (already finished, superseded, replayed elsewhere, or pruned), executes it and writes the outcome
 * before returning. A retry moves the job to delayed (`DelayedError`), so the job stays in Redis
 * and the row stays `enqueued` until it runs again. A thrown error here means the outcome could
 * not be written; BullMQ retries the job (`outboxJobRetries`).
 */
export async function processOutboxJob(
  deps: Pick<OutboxWorkerDependencies, 'db' | 'registry' | 'logger'>,
  kind: OutboxKind,
  job: Pick<Job<OutboxJobData>, 'data'>,
): Promise<JobResult> {
  const outboxId: unknown = (job.data as { outboxId?: unknown } | undefined)?.outboxId;
  if (typeof outboxId !== 'string' || !isUuid(outboxId)) {
    throw new UnrecoverableError('An outbox job carries only { outboxId }');
  }
  const handler = deps.registry.get(kind);
  if (handler === undefined) throw new Error(`No outbox handler for kind ${kind}`);
  const row = await readRow(deps.db, outboxId);
  if (row === undefined || row.kind !== kind || !runnable.has(row.status)) return 'skipped';
  const outcome = await execute(handler, row);
  await writeOutcome(deps.db, row, outcome);
  return outcome.outcome;
}

/** The BullMQ worker options of a kind (integrations §4.2), for `new Worker()`. */
export function workerOptions(
  policy: QueuePolicy,
  connection: Redis,
  prefix: string,
  random: () => number,
) {
  const limiter = bullLimiter(policy);
  return {
    connection,
    prefix,
    concurrency: policy.concurrency,
    ...(limiter === undefined ? {} : { limiter }),
    settings: {
      // Only for a processor that could not finish (see `outboxJobRetries`), with full jitter.
      backoffStrategy: (attemptsMade: number, type?: string) =>
        type === outboxBackoffType ? retryDelayMs(policy.backoff, attemptsMade, random) : 0,
    },
  };
}

/** The queue workers of this process, one per kind with a handler. */
export class OutboxWorkers {
  readonly #deps: OutboxWorkerDependencies;
  readonly #workers: Worker<OutboxJobData>[] = [];

  constructor(deps: OutboxWorkerDependencies) {
    this.#deps = deps;
  }

  /** The kinds this process consumes. */
  get kinds(): readonly OutboxKind[] {
    return this.#deps.registry.kinds;
  }

  start(): void {
    const { connection, logger } = this.#deps;
    const prefix = this.#deps.prefix ?? outboxQueuePrefix;
    const random = this.#deps.random ?? Math.random;
    for (const kind of this.kinds) {
      const policy = this.#deps.policies?.[kind] ?? outboxQueuePolicies[kind];
      const worker = new Worker<OutboxJobData>(
        outboxQueueName(kind),
        (job) => processOutboxJob(this.#deps, kind, job),
        workerOptions(policy, connection, prefix, random),
      );
      worker.on('error', (error) => {
        logger.warn(`Outbox worker ${kind} error: ${error.name}`);
      });
      worker.on('failed', (job, error) => {
        if (error instanceof DelayedError) return;
        logger.warn(`Outbox job ${job?.id ?? '?'} (${kind}) failed: ${error.name}`);
      });
      this.#workers.push(worker);
    }
  }

  /**
   * Stops taking jobs and waits for the jobs in flight, at most `graceMs` (platform §5: 30 s).
   * Returns false when the grace ran out: those jobs' rows stay `enqueued`, their locks lapse and
   * BullMQ hands them to another worker as stalled; the sweeper is the fallback.
   */
  async close(graceMs: number = shutdownGraceMs): Promise<boolean> {
    const closing = Promise.all(this.#workers.map((worker) => worker.close()));
    let timer: NodeJS.Timeout | undefined;
    const graceOver = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), graceMs);
    });
    const drained = await Promise.race([closing.then(() => true as const), graceOver]);
    clearTimeout(timer);
    if (!drained) {
      this.#deps.logger.warn(`Outbox workers: jobs still running after ${graceMs} ms, left`);
    }
    return drained;
  }
}
