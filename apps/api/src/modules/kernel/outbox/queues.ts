import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { OutboxKind } from '../schema/outbox.js';
import { outboxBackoffType, outboxJobAttempts } from './queue-options.js';

// The BullMQ side of the outbox (ADR-0024, ADR-0036; integrations §4.2, §4.4): one queue per kind,
// `outbox.<kind>`, under the key prefix `elx`. A job is the outbox row id and nothing else: the
// job id is the row id, so a second add of the same row is a no-op, and the data is `{ outboxId }`,
// so Redis never holds a payload (the worker re-reads the row; Redis is not a source of truth).

export const outboxQueuePrefix = 'elx';

/** The API's producer side of the queues (replays, consumer counts), from `RequestFrameModule`. */
export const OUTBOX_QUEUES = Symbol('OUTBOX_QUEUES');

export function outboxQueueName(kind: OutboxKind): string {
  return `outbox.${kind}`;
}

/**
 * How long finished jobs stay in Redis (lead review round 1, ruling 3; plan 2.5). The leg 2
 * processor writes the row's outcome before it returns, so a completed job means the row has left
 * `enqueued`; keeping completed jobs an hour and failed ones a day lets the sweeper tell "finished
 * recently" from "lost" (a lost job is absent in every state).
 */
export const outboxJobRetention = {
  removeOnComplete: { age: 60 * 60 },
  removeOnFail: { age: 24 * 60 * 60 },
} as const;

/**
 * BullMQ attempts of a job, for a processor that could not finish (the row unreadable or its
 * outcome unwritten); the handler's own retries are counted on the row (PLAT-8 item D).
 */
export const outboxJobRetries = {
  attempts: outboxJobAttempts,
  backoff: { type: outboxBackoffType },
} as const;

/** The only job data an outbox queue carries. */
export interface OutboxJobData {
  readonly outboxId: string;
}

/** The producer side of the outbox queues, as the relay and its sweeper use it. */
export class OutboxQueues {
  readonly #queues = new Map<OutboxKind, Queue<OutboxJobData>>();

  /** `connection` is shared by the queues and never closed here (the caller owns it). */
  constructor(
    private readonly connection: Redis,
    private readonly prefix: string = outboxQueuePrefix,
  ) {}

  #queue(kind: OutboxKind): Queue<OutboxJobData> {
    let queue = this.#queues.get(kind);
    if (queue === undefined) {
      queue = new Queue<OutboxJobData>(outboxQueueName(kind), {
        connection: this.connection,
        prefix: this.prefix,
      });
      this.#queues.set(kind, queue);
    }
    return queue;
  }

  /** Adds one job per row id (`jobId` = row id; an existing job of that id is left as it is). */
  async add(kind: OutboxKind, outboxIds: readonly string[]): Promise<void> {
    if (outboxIds.length === 0) return;
    await this.#queue(kind).addBulk(
      outboxIds.map((outboxId) => ({
        name: kind,
        data: { outboxId },
        opts: { jobId: outboxId, ...outboxJobRetention, ...outboxJobRetries },
      })),
    );
  }

  /**
   * The row ids of `outboxIds` whose job still exists in the queue of `kind`, in any state
   * (waiting, delayed, active, completed, failed: every state keeps the job hash), checked with
   * one pipelined round trip.
   */
  async existingJobs(kind: OutboxKind, outboxIds: readonly string[]): Promise<Set<string>> {
    if (outboxIds.length === 0) return new Set();
    const queue = this.#queue(kind);
    const pipeline = this.connection.pipeline();
    for (const id of outboxIds) pipeline.exists(queue.toKey(id));
    const results = (await pipeline.exec()) ?? [];
    const present = new Set<string>();
    outboxIds.forEach((id, index) => {
      const [error, count] = results[index] ?? [new Error('no reply'), 0];
      if (error !== null) throw error;
      if (count === 1) present.add(id);
    });
    return present;
  }

  /** Whether the queue of `kind` still holds a job for the row, in any state. */
  async hasJob(kind: OutboxKind, outboxId: string): Promise<boolean> {
    return (await this.existingJobs(kind, [outboxId])).has(outboxId);
  }

  /**
   * Removes the retained jobs of the rows (PLAT-8 plan 2.7: a replayed row's old job, completed or
   * failed, would make the relay's re-add a no-op under the same `jobId`). A running job is locked
   * and stays; returns the ids whose job is still there afterwards.
   */
  async removeJobs(kind: OutboxKind, outboxIds: readonly string[]): Promise<Set<string>> {
    if (outboxIds.length === 0) return new Set();
    const queue = this.#queue(kind);
    await Promise.all(outboxIds.map((id) => queue.remove(id, { removeChildren: false })));
    return this.existingJobs(kind, outboxIds);
  }

  /** The row ids of `outboxIds` whose job waits in the delayed set of `kind` (one round trip). */
  async delayedAmong(kind: OutboxKind, outboxIds: readonly string[]): Promise<Set<string>> {
    if (outboxIds.length === 0) return new Set();
    const key = this.#queue(kind).toKey('delayed');
    const pipeline = this.connection.pipeline();
    for (const id of outboxIds) pipeline.zscore(key, id);
    const results = (await pipeline.exec()) ?? [];
    const delayed = new Set<string>();
    outboxIds.forEach((id, index) => {
      const [error, score] = results[index] ?? [new Error('no reply'), null];
      if (error !== null) throw error;
      if (score !== null) delayed.add(id);
    });
    return delayed;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#queues.values()].map((queue) => queue.close()));
    this.#queues.clear();
  }
}
