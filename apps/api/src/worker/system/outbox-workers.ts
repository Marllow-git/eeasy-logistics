import { isUuid } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type { Job } from 'bullmq';
import { DelayedError, UnrecoverableError, Worker } from 'bullmq';
import { and, eq, inArray, sql } from 'drizzle-orm';
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
import { coreAccounts } from '../../modules/kernel/schema/accounts.js';
import { coreOutbox } from '../../modules/kernel/schema/outbox.js';
import { SpanKind } from '@opentelemetry/api';
import { annotateActiveSpan, withSpan } from '../../modules/kernel/telemetry/spans.js';

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
export type JobResult = 'skipped' | 'held' | RowWrite['status'];

/** The account's status, or undefined when it does not exist. */
async function accountStatusOf(
  db: PlatformDatabase,
  accountId: string,
): Promise<string | undefined> {
  const [account] = await db
    .select({ status: coreAccounts.status })
    .from(coreAccounts)
    .where(eq(coreAccounts.id, accountId));
  return account?.status;
}

/** Returns a row to `pending` (no attempt, no outcome), while it is still open; true if it did. */
async function holdRow(db: PlatformDatabase, id: string): Promise<boolean> {
  const held = await db
    .update(coreOutbox)
    .set({ status: 'pending', enqueuedAt: null, nextAttemptAt: sql`now()` })
    .where(and(eq(coreOutbox.id, id), inArray(coreOutbox.status, ['pending', 'enqueued'])))
    .returning({ id: coreOutbox.id });
  return held.length === 1;
}

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
export type OutboxJob = Pick<Job<OutboxJobData>, 'data' | 'moveToDelayed' | 'updateData'>;

/** The job's first-park time, when it carries a valid one (anything else counts as none). */
function parkedSinceOf(data: unknown): Date | undefined {
  const value: unknown = (data as { parkedSince?: unknown } | undefined)?.parkedSince;
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value)
    : undefined;
}

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
  // The job span (PLAT-14 plan 2.2): the row's ids, never its payload.
  annotateActiveSpan({
    'elx.account.id': row.accountId ?? undefined,
    'elx.correlation_id': row.correlationId ?? undefined,
    'elx.event_type': row.type,
    'elx.outbox.attempt': row.attempts + 1,
  });
  // A row of an account no longer provisioned or active (suspended, closed) does not execute: it
  // goes back to `pending` without an attempt, and the relay holds it until the account is active
  // again (K-2, adversary M-2). `internal_event` is exempt, like the relay's hold (A-23).
  if (kind !== 'internal_event' && row.accountId !== null) {
    const status = await accountStatusOf(deps.db, row.accountId);
    if (status !== 'provisioned' && status !== 'active') {
      return (await holdRow(deps.db, row.id)) ? 'held' : 'skipped';
    }
  }

  let outcome: KindOutcome;
  try {
    const parkedSince = parkedSinceOf(job.data);
    outcome = await handler.execute(row, parkedSince === undefined ? {} : { parkedSince });
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
    // A park carries its first-park time to the next run; any other retry ends the park.
    const parked = outcome.outcome === 'retry' ? outcome.parked : undefined;
    const data: OutboxJobData =
      parked === undefined ? { outboxId } : { outboxId, parkedSince: parked.since.getTime() };
    if (data.parkedSince !== parkedSinceOf(job.data)?.getTime()) await job.updateData(data);
    await job.moveToDelayed(write.nextAttemptAt.getTime(), token);
    throw new DelayedError();
  }
  return write.status;
}

/**
 * `processOutboxJob` inside one span per job (PLAT-14 plan 2.2), a new trace named `outbox.job`
 * with the kind and row id; a retry's `DelayedError` is control flow, not an error.
 */
export function tracedOutboxJob(
  deps: ProcessDependencies,
  kind: OutboxKind,
  job: OutboxJob,
  token?: string,
): Promise<JobResult> {
  const outboxId: unknown = (job.data as { outboxId?: unknown } | undefined)?.outboxId;
  return withSpan(
    'outbox.job',
    {
      'elx.outbox.kind': kind,
      'elx.outbox.row_id': typeof outboxId === 'string' && isUuid(outboxId) ? outboxId : undefined,
    },
    async (span) => {
      try {
        const result = await processOutboxJob(deps, kind, job, token);
        span.setAttribute('elx.outbox.result', result);
        return result;
      } catch (error) {
        if (error instanceof DelayedError) span.setAttribute('elx.outbox.result', 'retry');
        throw error;
      }
    },
    { root: true, kind: SpanKind.CONSUMER, isError: (error) => !(error instanceof DelayedError) },
  );
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
        (job, token) => tracedOutboxJob(this.#deps, kind, job, token),
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
