import type { ConnectionOptions } from 'bullmq';
import { Queue } from 'bullmq';
import type { OutboxKind } from '../schema/outbox.js';

// The BullMQ side of the outbox (ADR-0024, ADR-0036; integrations §4.2, §4.4): one queue per kind,
// `outbox.<kind>`, under the key prefix `elx`. A job is the outbox row id and nothing else: the
// job id is the row id, so a second add of the same row is a no-op, and the data is `{ outboxId }`,
// so Redis never holds a payload (the worker re-reads the row; Redis is not a source of truth).

export const outboxQueuePrefix = 'elx';

export function outboxQueueName(kind: OutboxKind): string {
  return `outbox.${kind}`;
}

/** The only job data an outbox queue carries. */
export interface OutboxJobData {
  readonly outboxId: string;
}

/** The producer side of the outbox queues, as the relay and its sweeper use it. */
export class OutboxQueues {
  readonly #queues = new Map<OutboxKind, Queue<OutboxJobData>>();

  constructor(
    private readonly connection: ConnectionOptions,
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
      outboxIds.map((outboxId) => ({ name: kind, data: { outboxId }, opts: { jobId: outboxId } })),
    );
  }

  /** Whether the queue of `kind` still holds a job for the row (any state). */
  async hasJob(kind: OutboxKind, outboxId: string): Promise<boolean> {
    return (await this.#queue(kind).getJob(outboxId)) !== undefined;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#queues.values()].map((queue) => queue.close()));
    this.#queues.clear();
  }
}
