import type { OutboxKind, coreOutbox } from '../schema/outbox.js';

/** The envelope columns the relay reads to order a row; never the payload (PLAT-8 plan 2.3). */
export interface RelayRow {
  readonly id: string;
  readonly kind: OutboxKind;
  readonly accountId: string | null;
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly sequence: number;
}

/** A whole outbox row as the queue worker re-reads it (the job carries only its id). */
export type OutboxRow = typeof coreOutbox.$inferSelect;

/**
 * What executing a row came to (PLAT-8 plan 2.5; integrations §4.4). The queue worker writes it
 * back to the row before the job ends:
 * - `done`: the effect happened (or was skipped on purpose; the handler logs why);
 * - `retry`: run again after `retryAfterS`, or after the kind's backoff with full jitter;
 *   `consumesAttempt: false` for failures that are not the effect's fault (a provider's rate
 *   limit, a parked connection, an out-of-order event);
 * - `dead`: never retried (a non-retryable error), or the kind's budget is spent;
 * - `superseded`: no longer wanted (integrations §4.3), with the reason.
 * `error` is a provider status code and message; the worker redacts it before it is stored.
 */
export type KindOutcome =
  | { readonly outcome: 'done' }
  | {
      readonly outcome: 'retry';
      readonly retryAfterS?: number;
      readonly consumesAttempt: boolean;
      readonly error?: OutcomeError;
    }
  | { readonly outcome: 'dead'; readonly error: OutcomeError }
  | { readonly outcome: 'superseded'; readonly reason: string };

/** A failure as it is stored in `last_error`: provider status code plus message. */
export interface OutcomeError {
  readonly status?: number | string;
  readonly message: string;
}

/**
 * The handler of a kind (integrations §4.1): the relay asks it for a row's ordering scope, the
 * queue worker has it execute the row. A kind with no handler in this build is never enqueued: its
 * rows stay `pending` and are counted (`outbox_rows_without_handler`).
 */
export interface KindHandler {
  readonly kind: OutboxKind;
  /**
   * The ordering scope of a row (integrations §4.1 "Ordering"), or null when the kind needs none.
   * The relay holds a row while an earlier row of the same kind, aggregate and key is not `done`,
   * `dead` or `superseded`; so a scope is at most as wide as the aggregate (per aggregate, per
   * subscription and aggregate, per package).
   */
  orderingKey(row: RelayRow): string | null;
  /**
   * Executes the row's effect. The row may still be `pending` (the relay adds jobs before its
   * batch commits) or `enqueued`. A thrown error is a failure: `ProviderFailure` says which kind
   * (rate limited, unauthorised, permanent); anything else is retried and consumes an attempt.
   */
  execute(row: OutboxRow): Promise<KindOutcome>;
}

/** The handlers of this build, one per kind. */
export class KindHandlerRegistry {
  readonly #handlers = new Map<OutboxKind, KindHandler>();

  constructor(handlers: readonly KindHandler[] = []) {
    for (const handler of handlers) {
      if (this.#handlers.has(handler.kind)) {
        throw new Error(`Two outbox handlers for kind ${handler.kind}`);
      }
      this.#handlers.set(handler.kind, handler);
    }
  }

  get(kind: OutboxKind): KindHandler | undefined {
    return this.#handlers.get(kind);
  }

  /** The kinds with a handler, which the relay enqueues. */
  get kinds(): readonly OutboxKind[] {
    return [...this.#handlers.keys()];
  }
}
