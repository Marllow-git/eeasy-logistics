// The domain event envelope (ADR-0027; domain model §6.1) and the catalogue of event types.

/**
 * The event types the catalogue (domain model §6.3) names and this build produces. The kernel list
 * comes first; a later order that adds a producer appends its types here in the same PR, so the
 * writer refuses a type the catalogue does not know.
 */
export const domainEventTypes = [
  'core.account.provisioned',
  'core.account.suspended',
  'core.feature_flag.changed',
  'core.site.updated',
  'core.channel_order.received',
  'core.carrier_update.received',
] as const;
export type DomainEventType = (typeof domainEventTypes)[number];

const knownTypes: ReadonlySet<string> = new Set(domainEventTypes);

export function isDomainEventType(value: unknown): value is DomainEventType {
  return typeof value === 'string' && knownTypes.has(value);
}

/** A JSON object payload: snake_case keys, money as halalas plus currency (§6.1). */
export type EventPayload = Readonly<Record<string, unknown>>;

/** One event as written to `core_outbox` and delivered at least once (domain model §6.1, §6.2). */
export interface DomainEvent<TPayload extends EventPayload = EventPayload> {
  /** UUIDv7; consumers deduplicate on it (`core_consumer_receipts`). */
  readonly id: string;
  readonly type: DomainEventType;
  /** Payload schema version: additive changes keep it, a breaking change bumps it. */
  readonly version: number;
  /** Server time of the business change (the transaction's `now()`). */
  readonly occurredAt: Date;
  /** The tenant; null only for a platform-only effect (data §2.4). */
  readonly accountId: string | null;
  readonly aggregateType: string;
  /** The ordering scope (§6.2). */
  readonly aggregateId: string;
  /** The aggregate's `version` after the change; strictly increasing per aggregate. */
  readonly sequence: number;
  readonly causationId: string | null;
  readonly correlationId: string | null;
  readonly payload: TPayload;
}
