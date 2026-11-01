import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { withPlatformAccountTransaction } from '@eeasy-logistics/db/platform';
import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { DomainEvent } from '../../modules/kernel/outbox/domain-event.js';
import { isDomainEventType } from '../../modules/kernel/outbox/domain-event.js';
import type {
  DomainEventConsumer,
  DomainEventConsumerRegistry,
} from '../../modules/kernel/outbox/domain-event-consumers.js';
import type {
  KindHandler,
  KindOutcome,
  OutboxRow,
  OutcomeError,
  RelayRow,
} from '../../modules/kernel/outbox/kind-handlers.js';
import { failureOutcome, formatLastError } from '../../modules/kernel/outbox/outcome.js';
import type { QueuePolicy } from '../../modules/kernel/outbox/queue-options.js';
import { isFinalFailure, outboxQueuePolicies } from '../../modules/kernel/outbox/queue-options.js';

// The `internal_event` kind (PLAT-8 plan 2.6; domain model §2.7, §6.2; data §5.3; ADR-0036): the
// dispatcher runs every registered consumer of the row's type once. Per consumer, in one
// platform-pool transaction (with `elx.account_id` set when the row has an account): insert the
// receipt `(consumer, event_id)` first, a conflict meaning already processed; then run it. An
// event whose consumer has not yet processed an earlier event of the aggregate is parked (the job
// is delayed, 30 s then doubling) and dead-lettered for that consumer after 15 minutes.

/** First park delay; each next one doubles (the delay equals the time parked so far). */
export const parkFirstMs = 30_000;
/** After this long parked, the event is dead-lettered for the consumer (data §5.3). */
export const parkWindowMs = 15 * 60_000;

export interface InternalEventDispatcherDependencies {
  readonly db: PlatformDatabase;
  readonly consumers: DomainEventConsumerRegistry;
  readonly logger: { warn(message: string): void };
  /** The clock for the parking window; tests advance it. Must match the worker's. */
  readonly now?: () => Date;
  readonly policy?: QueuePolicy;
}

const list = (values: readonly string[]): SQL =>
  sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  );

/** The envelope of a row (domain model §6.1). */
function eventOf(row: OutboxRow & { type: DomainEvent['type'] }): DomainEvent {
  return {
    id: row.id,
    type: row.type,
    version: row.eventVersion,
    occurredAt: row.occurredAt,
    accountId: row.accountId,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    sequence: row.sequence,
    causationId: row.causationId,
    correlationId: row.correlationId,
    payload: row.payload as DomainEvent['payload'],
  };
}

export class InternalEventDispatcher implements KindHandler {
  readonly kind = 'internal_event' as const;
  readonly #deps: InternalEventDispatcherDependencies;

  constructor(deps: InternalEventDispatcherDependencies) {
    this.#deps = deps;
  }

  /** Per aggregate (integrations §4.1; domain model §6.2). */
  orderingKey(row: RelayRow): string {
    return row.aggregateId;
  }

  /**
   * Runs the consumers of the row that have neither a receipt nor a live dead letter. Outcome:
   * `done` when every consumer has a receipt; a consumer failure retries the row (consuming an
   * attempt) and at the kind's budget dead-letters every consumer still without a receipt; a
   * parked consumer delays the row without consuming an attempt and after 15 minutes is
   * dead-lettered. A row with any dead letter ends `dead` (listed and replayable, leg 3).
   */
  async execute(row: OutboxRow): Promise<KindOutcome> {
    const type = row.type;
    if (!isDomainEventType(type)) return { outcome: 'done' };
    const consumers = this.#deps.consumers.for(type);
    if (consumers.length === 0) return { outcome: 'done' };
    const event = eventOf({ ...row, type });
    const now = this.#deps.now?.() ?? new Date();

    const settled = await this.#settled(row.id, consumers);
    const parked: DomainEventConsumer[] = [];
    const failed: { consumer: DomainEventConsumer; error: OutcomeError }[] = [];
    for (const consumer of consumers) {
      if (settled.has(consumer.consumer)) continue;
      if (await this.#hasGap(row, consumer)) {
        parked.push(consumer);
        continue;
      }
      try {
        await this.#run(row, consumer, event);
      } catch (error) {
        const outcome = failureOutcome(error);
        const detail =
          outcome.outcome === 'retry' || outcome.outcome === 'dead' ? outcome.error : undefined;
        failed.push({ consumer, error: detail ?? { message: 'consumer failed' } });
      }
    }

    const first = failed[0];
    if (first !== undefined) {
      const policy = this.#deps.policy ?? outboxQueuePolicies.internal_event;
      const error: OutcomeError = {
        ...first.error,
        message: `${first.consumer.consumer}: ${first.error.message}`,
      };
      const ageMs = now.getTime() - row.createdAt.getTime();
      if (!isFinalFailure(policy, row.attempts + 1, ageMs)) {
        return { outcome: 'retry', consumesAttempt: true, error };
      }
      const open = [...failed.map((f) => f.consumer), ...parked];
      await this.#deadLetter(row, open, row.attempts + 1, error);
      // The worker turns this final failure into `dead` with the attempt counted.
      return { outcome: 'retry', consumesAttempt: true, error };
    }

    if (parked.length > 0) {
      const since = row.enqueuedAt ?? now;
      const parkedMs = Math.max(0, now.getTime() - since.getTime());
      const names = parked.map((consumer) => consumer.consumer).join(', ');
      if (parkedMs >= parkWindowMs) {
        const error = { message: `parked past ${parkWindowMs / 60_000} min: sequence gap` };
        await this.#deadLetter(row, parked, row.attempts, error);
        this.#deps.logger.warn(`Internal event ${row.id} dead-lettered for ${names}`);
        return { outcome: 'dead', error };
      }
      const delayMs = Math.min(Math.max(parkFirstMs, parkedMs), parkWindowMs - parkedMs);
      return {
        outcome: 'retry',
        consumesAttempt: false,
        retryAfterS: delayMs / 1_000,
        error: { message: `parked: sequence gap for ${names}` },
      };
    }
    return { outcome: 'done' };
  }

  /** Consumers of `eventId` with a receipt, or a dead letter not replayed since. */
  async #settled(eventId: string, consumers: readonly DomainEventConsumer[]): Promise<Set<string>> {
    const names = list(consumers.map((c) => c.consumer));
    const rows = await this.#deps.db.execute<{ consumer: string }>(sql`
      SELECT consumer FROM core_consumer_receipts
      WHERE event_id = ${eventId} AND consumer IN (${names})
      UNION
      SELECT consumer FROM core_consumer_dead_letters
      WHERE event_id = ${eventId} AND consumer IN (${names}) AND replayed_at IS NULL`);
    return new Set(rows.map((r) => r.consumer));
  }

  /**
   * Whether an earlier event of the same aggregate that `consumer` subscribes to is still open
   * (`pending` or `enqueued`) without a receipt or a live dead letter of that consumer: the
   * sequence gap of domain model §6.2, per consumer. Earlier events the consumer does not
   * subscribe to, and finished ones (`done`, `dead`, `superseded`), never hold it.
   */
  async #hasGap(row: OutboxRow, consumer: DomainEventConsumer): Promise<boolean> {
    const types = this.#deps.consumers.typesOf(consumer.consumer);
    const gap = await this.#deps.db.execute<{ id: string }>(sql`
      SELECT o.id FROM core_outbox o
      WHERE o.aggregate_id = ${row.aggregateId}
        AND o.kind = 'internal_event'
        AND o.type IN (${list(types)})
        AND (o.sequence < ${row.sequence} OR (o.sequence = ${row.sequence} AND o.id < ${row.id}))
        AND o.status IN ('pending', 'enqueued')
        AND NOT EXISTS (SELECT 1 FROM core_consumer_receipts r
                        WHERE r.consumer = ${consumer.consumer} AND r.event_id = o.id)
        AND NOT EXISTS (SELECT 1 FROM core_consumer_dead_letters d
                        WHERE d.consumer = ${consumer.consumer} AND d.event_id = o.id
                          AND d.replayed_at IS NULL)
      LIMIT 1`);
    return gap.length > 0;
  }

  /** The receipt first, then the consumer, in one transaction (a failure rolls both back). */
  async #run(row: OutboxRow, consumer: DomainEventConsumer, event: DomainEvent): Promise<void> {
    await withPlatformAccountTransaction(this.#deps.db, row.accountId, async (tx) => {
      const inserted = await tx.execute<{ consumer: string }>(sql`
        INSERT INTO core_consumer_receipts (consumer, event_id, account_id)
        VALUES (${consumer.consumer}, ${row.id}, ${row.accountId})
        ON CONFLICT (consumer, event_id) DO NOTHING
        RETURNING consumer`);
      if (inserted.length === 0) return; // processed meanwhile by another delivery
      await consumer.handle(event);
    });
  }

  /** One dead letter per consumer (a replayed one is reopened), account as the event's. */
  async #deadLetter(
    row: OutboxRow,
    consumers: readonly DomainEventConsumer[],
    attempts: number,
    error: OutcomeError,
  ): Promise<void> {
    const lastError = formatLastError(error);
    await withPlatformAccountTransaction(this.#deps.db, row.accountId, async (tx) => {
      for (const consumer of consumers) {
        await tx.execute(sql`
          INSERT INTO core_consumer_dead_letters
            (id, consumer, event_id, account_id, attempts, last_error)
          VALUES (${uuidv7()}, ${consumer.consumer}, ${row.id}, ${row.accountId}, ${attempts},
                  ${lastError})
          ON CONFLICT (consumer, event_id) DO UPDATE
          SET attempts = EXCLUDED.attempts, last_error = EXCLUDED.last_error,
              created_at = now(), replayed_at = NULL`);
      }
    });
  }
}
