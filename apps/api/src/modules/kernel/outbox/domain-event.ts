// The domain event envelope (ADR-0027; domain model §6.1) and the catalogue of event types.

/**
 * The event types the catalogue (domain model §6.3) names and this build produces. The kernel list
 * comes first; a later order that adds a producer appends its types here in the same PR, so the
 * writer refuses a type the catalogue does not know.
 */
export const domainEventTypes = [
  'core.account.provisioned',
  'core.account.suspended',
  // PLAT-13 plan 2.7: the rest of the platform's account lifecycle (domain model §6.3, A-26 rows).
  'core.account.reactivated',
  'core.account.closed',
  'core.feature_flag.changed',
  'core.site.updated',
  'core.channel_order.received',
  'core.carrier_update.received',
  // PLAT-9: the `message` row of an OTP challenge (an effect of the kernel, never an internal event;
  // not a row of domain model §6.3, which lists business events only).
  'core.otp_challenge.created',
  // PLAT-11: the `message` rows of an invitation and a password reset (mail; kernel effects too).
  'core.invitation.created',
  'core.password_reset.requested',
  'core.second_factor.reset',
  // DEL-4 plan 2.3: the `message` row of a driver's WhatsApp app invitation (an effect, not an
  // internal event; catalogue §6.3 gains no row).
  'delivery.driver.created',
  // PLAT-13: the notice mail of a platform user's TOTP reset (a kernel effect, no link).
  'core.platform_staff.totp_reset',
  'delivery.order.created',
  // DEL-2 adversary round 1, ruling 5d: COD or the address edited after acceptance (keys only).
  'delivery.order.updated',
  // DEL-2 leg 2: one type per status an arrow lands in (catalogue §6.3), written by
  // `OrderTransitions.apply` for every arrow; DEL-6 and DEL-7 take the same path.
  'delivery.order.accepted',
  'delivery.order.offered',
  'delivery.order.assigned',
  'delivery.order.picked_up',
  'delivery.order.out_for_delivery',
  'delivery.order.attempted',
  'delivery.order.delivered',
  'delivery.order.failed',
  'delivery.order.returned',
  'delivery.order.cancelled',
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
