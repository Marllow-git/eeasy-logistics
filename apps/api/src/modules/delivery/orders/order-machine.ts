import type { OrderStatus } from '../../kernel/public/index.js';

// The order state machine as data (DEL-2 plan 2.6, 2.10; domain model §3.13, D-5, D-8). Every
// arrow with the actors that may take it; DEL-6 and DEL-7 reuse it through Delivery's public
// surface and add their own checks (the current assignee, D-16, D-23) on top. The full table is
// the unit test's contract.

export type OrderActor = 'driver' | 'dispatcher' | 'site_staff' | 'system';
export const orderActors: readonly OrderActor[] = ['driver', 'dispatcher', 'site_staff', 'system'];

/** `delivered`, `returned` and `cancelled` (D-8). */
export const terminalStatuses: ReadonlySet<OrderStatus> = new Set([
  'delivered',
  'returned',
  'cancelled',
]);

export const isTerminal = (status: OrderStatus): boolean => terminalStatuses.has(status);

type Arrows = Readonly<
  Partial<Record<OrderStatus, Readonly<Partial<Record<OrderStatus, readonly OrderActor[]>>>>>
>;

/** §3.13: from → to → the actors of the actor table. */
export const orderArrows: Arrows = {
  pending: { accepted: ['dispatcher', 'system'], cancelled: ['dispatcher'] },
  accepted: {
    offered: ['dispatcher', 'system'],
    assigned: ['dispatcher'],
    cancelled: ['dispatcher'],
  },
  offered: { assigned: ['driver'], accepted: ['system'], cancelled: ['dispatcher'] },
  assigned: { picked_up: ['driver'], accepted: ['dispatcher'], cancelled: ['dispatcher'] },
  // Cancelling after pickup goes through `failed` (§3.13's closing note; plan 2.9, Q-6): the
  // dispatcher's cancel of a picked-up order is this arrow.
  picked_up: { out_for_delivery: ['driver'], failed: ['dispatcher'] },
  out_for_delivery: { delivered: ['driver'], attempted: ['driver'], failed: ['dispatcher'] },
  attempted: {
    out_for_delivery: ['driver'],
    accepted: ['dispatcher'],
    failed: ['system', 'dispatcher'],
  },
  failed: { returned: ['site_staff'] },
};

export type MachineVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'terminal' | 'no_arrow' | 'wrong_actor' };

/**
 * Whether `actor` may move an order from `current` to `to` (D-5). A terminal order never moves
 * (D-8); staying in the same status is no arrow.
 */
export function transition(
  current: OrderStatus,
  to: OrderStatus,
  actor: OrderActor,
): MachineVerdict {
  if (isTerminal(current)) return { allowed: false, reason: 'terminal' };
  const actors = orderArrows[current]?.[to];
  if (actors === undefined) return { allowed: false, reason: 'no_arrow' };
  return actors.includes(actor) ? { allowed: true } : { allowed: false, reason: 'wrong_actor' };
}

/** The statuses `actor` may move an order to from `current`. */
export function nextStatuses(current: OrderStatus, actor: OrderActor): OrderStatus[] {
  if (isTerminal(current)) return [];
  return Object.entries(orderArrows[current] ?? {})
    .filter(([, actors]) => actors?.includes(actor) === true)
    .map(([to]) => to as OrderStatus);
}

/** Before the parcel is with a driver: items, recipient and address may still change (§3.2). */
export const prePickupStatuses: ReadonlySet<OrderStatus> = new Set([
  'pending',
  'accepted',
  'offered',
  'assigned',
]);

/** A driver holds the parcel: a dispatcher's cancel becomes `failed` (plan 2.9, Q-6). */
export const afterPickupStatuses: ReadonlySet<OrderStatus> = new Set([
  'picked_up',
  'out_for_delivery',
  'attempted',
]);

/** The machine as one value, for Delivery's public surface (plan 2.10). */
export const OrderMachine = Object.freeze({
  arrows: orderArrows,
  transition,
  isTerminal,
  nextStatuses,
});
