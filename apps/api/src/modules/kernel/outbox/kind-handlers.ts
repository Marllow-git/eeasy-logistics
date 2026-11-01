import type { OutboxKind } from '../schema/outbox.js';

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

/**
 * What the relay needs from the handler of a kind (integrations §4.1). Leg 2 of PLAT-8 extends the
 * port with execution (plan 2.5). A kind with no handler in this build is never enqueued: its rows
 * stay `pending` and are counted (`outbox_rows_without_handler`).
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

/**
 * The handlers registered in this build. Empty in PLAT-8 leg 1: the relay moves no row yet; leg 2
 * adds `internal_event` and `storage_lifecycle` (plan 2.5), later orders the other kinds.
 */
export const kindHandlers: readonly KindHandler[] = [];
