import type { Driver as DriverResource } from '@eeasy-logistics/contracts/staff/schemas';
import type { Driver } from './drivers.service.js';
import { activeOrdersOf } from './drivers.service.js';

/**
 * `Driver` (components.yaml; domain model §3.5) from a row and its person: the name is the row's
 * (the account's own, adversary H-3), the phone the person's; never the PIN hash, its failure
 * count or a device. `cash_pin_locked` is whether the five-failure lock is set (plan 2.4).
 */
export function presentDriver({ row, person }: Driver): DriverResource {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    user_id: row.userId,
    name: row.name,
    ...(person.phone === null ? {} : { phone: person.phone }),
    home_site_id: row.homeSiteId,
    status: row.status,
    cash_blocked_at: row.cashBlockedAt?.toISOString() ?? null,
    cash_blocked_reason: row.cashBlockedReason,
    capacity_limit: row.capacityLimit,
    active_orders: activeOrdersOf(row),
    cash_pin_locked: row.cashPinLockedAt !== null,
  };
}
