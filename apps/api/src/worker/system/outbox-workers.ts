import { isUuid } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type { Job } from 'bullmq';
import { DelayedError, UnrecoverableError, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { AuditEvent, AuditSink } from '../../modules/kernel/audit/audit-sink.js';
import type { ConnectionParker } from '../../modules/kernel/outbox/connection-parker.js';
import { LoggingConnectionParker } from '../../modules/kernel/outbox/connection-parker.js';
import type {
  KindHandlerRegistry,
  KindOutcome,
  OutboxRow,
} from '../../modules/kernel/outbox/kind-handlers.js';
import type { RowWrite } from '../../modules/kernel/outbox/outcome.js';
import { failureOutcome, resolveOutcome } from '../../modules/kernel/outbox/outcome.js';
import { ProviderFailure } from '../../modules/kernel/outbox/provider-failure.js';
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
import { PlatformOutbox } from '../../modules/kernel/platform/outbox.repository.js';
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
  /** The clock for retry times and age budgets; tests advance it. */
  readonly now?: () => Date;
  /** Where `unauthorised` failures go (plan 2.5); the logging stub by default. */
  readonly parker?: ConnectionParker;
  /** Writes a handler's audit event with the outcome (`AuditWriter.record`). */
  readonly audit?: Pick<AuditSink, 'record'>;
}

/** What happened to one job, for logs and tests. */
export type JobResult = 'skipped' | RowWrite['status'];

/** The row of `outboxId`, or undefined when it is gone (pruned) or never existed. */
async function readRow(db: PlatformDatabase, outboxId: string): Promise<OutboxRow | undefined> {
  const [row] = await db.select().from(coreOutbox).where(eq(coreOutbox.id, outboxId));
  return row;
}

/**
 * Writes the outcome to the row in one platform unit of work, only while the row is still
 * `pending` or `enqueued` (a replay or a second delivery that finished first wins), and the
 * handler's audit event, if any, in that same transaction. Returns whether the row changed.
 */
export async function writeOutcome(
  db: PlatformDatabase,
  id: string,
  write: RowWrite,
  audit?: { readonly event: AuditEvent; readonly sink: Pick<AuditSink, 'record'> },
): Promise<boolean> {
  return withPlatformUnitOfWork(db, async (uow) => {
    const changed = await new PlatformOutbox(uow).writeOutcome(id, write);
    // In the same transaction: a failed outcome write leaves no audit row (lead review round 2).
    if (changed && audit !== undefined) await audit.sink.record(audit.event);
    return changed;
  });
}

/** The job operations the processor uses (a retry moves the job itself to delayed). */
export type OutboxJob = Pick<Job<OutboxJobData>, 'data' | 'moveToDelayed'>;

export type ProcessDependencies = Pick<
  OutboxWorkerDependencies,
  'db' | 'registry' | 'logger' | 'policies' | 'random' | 'now' | 'parker' | 'audit'
>;

/**
 * One job of the queue of `kind`: re-reads the row, skips it unless it is `pending` or `enqueued`
 * (already finished, superseded, replayed elsewhere, or pruned), executes it and writes the outcome
 * before returning (plan 2.5). A thrown handler error is a failure (`failureOutcome`): an
 * `unauthorised` one is handed to the `ConnectionParker` first. A retry moves the job to delayed
 * (`DelayedError`), so the job stays in Redis and the row stays `enqueued` until it runs again.
 * A thrown error here means the outcome could not be written; BullMQ retries the job.
 */
export async function processOutboxJob(
  deps: ProcessDependencies,
  kind: OutboxKind,
  job: OutboxJob,
  token?: string,
): Promise<JobResult> {
  const outboxId: unknown = (job.data as { outboxId?: unknown } | undefined)?.outboxId;
  if (typeof outboxId !== 'string' || !isUuid(outboxId)) {
    throw new UnrecoverableError('An outbox job carries only { outboxId }');
  }
  const handler = deps.registry.get(kind);
  if (handler === undefined) throw new Error(`No outbox handler for kind ${kind}`);
  const row = await readRow(deps.db, outboxId);
  if (row === undefined || row.kind !== kind || !runnable.has(row.status)) return 'skipped';

  let outcome: KindOutcome;
  try {
    outcome = await handler.execute(row);
  } catch (error) {
    if (error instanceof ProviderFailure && error.reason === 'unauthorised') {
      await (deps.parker ?? new LoggingConnectionParker(deps.logger)).park(row, error);
    }
    outcome = failureOutcome(error);
  }
  const policy = deps.policies?.[kind] ?? outboxQueuePolicies[kind];
  const now = deps.now?.() ?? new Date();
  const write = resolveOutcome(row, outcome, policy, now, deps.random);
  const event = outcome.outcome === 'done' ? outcome.audit : undefined;
  let audit: Parameters<typeof writeOutcome>[3];
  if (event !== undefined) {
    if (deps.audit === undefined) {
      throw new Error(`Outbox kind ${kind} returned an audit event but the worker has no sink`);
    }
    audit = { event, sink: deps.audit };
  }
  if (!(await writeOutcome(deps.db, row.id, write, audit))) return 'skipped';
  if (write.status === 'dead') {
    deps.logger.warn(`Outbox row ${row.id} (${kind}) dead after ${write.attempts} attempts`);
  }
  if (write.status === 'enqueued') {
    await job.moveToDelayed(write.nextAttemptAt.getTime(), token);
    throw new DelayedError();
  }
  return write.status;
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
        (job, token) => processOutboxJob(this.#deps, kind, job, token),
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
