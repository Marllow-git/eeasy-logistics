import type { Order, OrderItem } from '@eeasy-logistics/contracts/staff/schemas';
import { displayNumber } from '../../kernel/public/index.js';
import type { OrderItemRow, OrderRow } from './orders.repository.js';

// `Order` and `OrderItem` of components.yaml (DEL-2 plan 2.3, 2.7). The number is rendered from
// the stored integer (data §7); `executor_account_id` is never shown (D-1); a point is `{lat, lng}`
// from the `xy` read (`x` longitude). Optional contract fields the row holds no value for are
// left out rather than sent as null where the contract does not allow null.

const money = (amount: number) => ({ amount, currency: 'SAR' as const });

export function presentOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    name_ar: row.nameAr,
    name_en: row.nameEn,
    ...(row.sku === null ? {} : { sku: row.sku }),
    quantity: row.quantity,
    direction: row.direction,
    wms_product_id: row.wmsProductId,
    ...(row.declaredValue === null ? {} : { declared_value: money(row.declaredValue) }),
  };
}

export function presentOrder(row: OrderRow, items?: readonly OrderItemRow[]): Order {
  const point = row.addressPoint;
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    number: displayNumber('delivery_order', row.number),
    kind: row.kind,
    status: row.status,
    pending_reason: row.pendingReason,
    site_id: row.siteId,
    source: row.source,
    source_ref: row.sourceRef,
    recipient: {
      name: row.recipientName,
      phone: row.recipientPhone,
      ...(row.recipientAltPhone === null ? {} : { alternate_phone: row.recipientAltPhone }),
      ...(row.recipientLanguage === null ? {} : { preferred_language: row.recipientLanguage }),
    },
    address: {
      text: row.addressText,
      city: row.addressCity,
      ...(row.addressDistrict === null ? {} : { district: row.addressDistrict }),
      ...(row.nationalAddressShortCode === null
        ? {}
        : { national_address_short_code: row.nationalAddressShortCode }),
      ...(point === null ? {} : { point: { lat: point.y, lng: point.x } }),
      ...(row.pinSource === null ? {} : { pin_source: row.pinSource }),
      // `real` holds 0.8 as 0.800000011920929: three decimals are what the geocoders give.
      ...(row.geocodeConfidence === null
        ? {}
        : { geocode_confidence: Math.round(row.geocodeConfidence * 1000) / 1000 }),
    },
    ...(items === undefined ? {} : { items: items.map(presentOrderItem) }),
    zone_id: row.zoneId,
    slot_id: row.slotId,
    cod_amount: money(row.codAmount),
    current_assignment_id: row.currentAssignmentId,
    attempt_count: row.attemptCount,
    max_attempts: row.maxAttempts,
    notes: row.notes,
    version: row.version,
  };
}
