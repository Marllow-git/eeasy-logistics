import type { UnitOfWork } from '@eeasy-logistics/db';
import { getContext, uuidv7 } from '@eeasy-logistics/db';
import type {
  AuditSink,
  GeocodeLocale,
  GeocoderService,
  OrderAccounts,
  PinSource,
} from '../../kernel/public/index.js';
import { ApiException, assertVersion } from '../../kernel/public/index.js';
import type { CoverageQuery } from '../zones/coverage-query.js';
import type { Located } from './intake.js';
import { intakeOutcome, locate } from './intake.js';
import type { AuditFacts, CreatedOrder } from './order-intake.js';
import type { OrderPatch, PatchKey } from './order-input.js';
import { patchKeys } from './order-input.js';
import { isTerminal, prePickupStatuses } from './order-machine.js';
import type { OrderTransitions } from './order-transitions.js';
import type { OrderRow, OrderUpdate } from './orders.repository.js';
import {
  OrderEventsRepository,
  OrderItemsRepository,
  OrdersRepository,
} from './orders.repository.js';

// `updateOrder` (DEL-2 plan 2.8; domain model §3.1, §3.2, D-4, D-22; integrations §6.2; data §10).
// A PATCH of the sent parts under the `If-Match` version: recipient, address and items (the list
// replaced whole) and COD change only before pickup; notes until the order is terminal; nothing on
// a terminal order (`409 order_locked`). A new address is located again (before any lock: the
// geocoder is I/O) unless the order holds a pin of higher trust than the geocoder's (a recipient,
// driver or dispatcher pin is never overwritten by geocoding), and its zone is resolved again in
// the transaction; a `pending` order's intake rule is applied again, so an address fix may clear
// its reason and, under `auto_accept`, accept it (a system arrow through `OrderTransitions`). The
// edit is one `note` event with the changed parts and one audit row naming them; only COD shows
// its values (K-7), never the recipient's.

/** Pins a geocoder result never replaces (integrations §6.2). */
const trustedPins: ReadonlySet<PinSource> = new Set(['recipient_pin', 'driver_pin', 'manual']);

/** The parts locked once the parcel is with a driver (§3.2). */
const prePickupParts: ReadonlySet<PatchKey> = new Set([
  'recipient',
  'address',
  'items',
  'cod_amount',
]);

export interface UpdateDependencies {
  readonly geocoder: Pick<GeocoderService, 'geocode' | 'lookupShortCode'>;
  readonly coverage: Pick<CoverageQuery, 'coverage'>;
  readonly accounts: Pick<OrderAccounts, 'current'>;
  readonly audit: AuditSink;
  readonly transitions: Pick<OrderTransitions, 'apply'>;
}

export interface UpdateRequest {
  readonly orderId: string;
  readonly expectedVersion: number;
  readonly patch: OrderPatch;
  readonly idempotencyKey: string;
  readonly facts: AuditFacts;
}

/** Where a new address puts the order: undefined keeps the current point. */
type Relocation = { readonly located: Located | undefined } | undefined;

/** The parts of `patch` that were sent, in `patchKeys` order. */
export function changedParts(patch: OrderPatch): PatchKey[] {
  const present: Record<PatchKey, boolean> = {
    recipient: patch.recipient !== undefined,
    address: patch.address !== undefined,
    items: patch.items !== undefined,
    cod_amount: patch.codAmount !== undefined,
    notes: patch.notes !== undefined,
  };
  return patchKeys.filter((key) => present[key]);
}

/**
 * `409 order_locked` when the order's status forbids a sent part: any part on a terminal order;
 * recipient, address, items and COD from `picked_up` on. `details.locked` names the parts refused.
 */
export function assertEditable(
  order: Pick<OrderRow, 'status' | 'version'>,
  parts: readonly PatchKey[],
): void {
  const locked = isTerminal(order.status)
    ? [...parts]
    : prePickupStatuses.has(order.status)
      ? []
      : parts.filter((part) => prePickupParts.has(part));
  if (locked.length > 0) {
    throw new ApiException('order_locked', {
      details: { current_status: order.status, version: order.version, locked },
    });
  }
}

export class OrderUpdates {
  constructor(private readonly deps: UpdateDependencies) {}

  async update(uow: UnitOfWork, request: UpdateRequest): Promise<CreatedOrder> {
    const { patch } = request;
    const parts = changedParts(patch);
    const orders = new OrdersRepository(uow);
    // A first read without a lock: refusals answer before any I/O, and the geocoder runs before
    // the row lock is taken (lead ruling on 8.2 #5). Everything is checked again under the lock.
    const seen = await orders.find(request.orderId);
    if (seen === undefined) throw new ApiException('not_found');
    assertVersion(seen, request.expectedVersion);
    assertEditable(seen, parts);
    const relocation = await this.relocate(seen, patch);
    const account =
      patch.address !== undefined && seen.status === 'pending'
        ? await this.deps.accounts.current()
        : undefined;

    const current = await orders.find(request.orderId, { forUpdate: true });
    if (current === undefined) throw new ApiException('not_found');
    assertVersion(current, request.expectedVersion);
    assertEditable(current, parts);
    if (parts.length === 0)
      return { order: current, items: await new OrderItemsRepository(uow).of(current.id) };

    const values: { -readonly [K in keyof OrderUpdate]: OrderUpdate[K] } = {
      version: current.version + 1,
    };
    if (patch.recipient !== undefined) {
      values.recipientName = patch.recipient.name;
      values.recipientPhone = patch.recipient.phone;
      values.recipientAltPhone = patch.recipient.altPhone;
      values.recipientLanguage = patch.recipient.language;
    }
    if (patch.codAmount !== undefined) values.codAmount = patch.codAmount;
    if (patch.notes !== undefined) values.notes = patch.notes;
    let point: { lat: number; lng: number } | null | undefined;
    let accept = false;
    if (patch.address !== undefined) {
      values.addressText = patch.address.text;
      values.addressCity = patch.address.city;
      values.addressDistrict = patch.address.district;
      values.nationalAddressShortCode = patch.address.shortCode;
      if (relocation !== undefined) {
        const { located } = relocation;
        point = located?.point ?? null;
        values.pinSource = located?.pinSource ?? null;
        values.geocodeConfidence = located?.confidence ?? null;
      }
      const at = point === undefined ? pointOf(current) : point;
      const zoneId =
        at === null
          ? null
          : (await this.deps.coverage.coverage(at, { siteId: current.siteId, uow })).zoneId;
      values.zoneId = zoneId;
      // A pending order is taken in again (plan 2.8); a reason intake does not set stays.
      if (current.status === 'pending' && current.pendingReason !== 'awaiting_review') {
        const outcome = intakeOutcome(
          account?.intakeRule ?? 'receive_as_pending',
          at !== null,
          zoneId,
        );
        values.pendingReason = outcome.pendingReason;
        accept = outcome.status === 'accepted';
      }
    }

    let order = await orders.update(current.id, values, point);
    const items =
      patch.items === undefined
        ? await new OrderItemsRepository(uow).of(order.id)
        : await new OrderItemsRepository(uow).replace(
            order.id,
            patch.items.map((item, position) => ({
              id: uuidv7(),
              position,
              nameAr: item.nameAr,
              nameEn: item.nameEn,
              sku: item.sku,
              quantity: item.quantity,
              direction: item.direction,
              wmsProductId: item.wmsProductId,
              declaredValue: item.declaredValue,
            })),
          );
    const context = getContext();
    const located =
      patch.address === undefined
        ? {}
        : { zone_id: order.zoneId, pending_reason: order.pendingReason };
    await new OrderEventsRepository(uow).append({
      id: uuidv7(),
      orderId: order.id,
      type: 'note',
      actorType: 'user',
      actorId: context.userId,
      idempotencyKey: request.idempotencyKey,
      payload: { changed: parts, ...located },
    });
    await this.deps.audit.record({
      actorType: 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: 'order',
      targetId: order.id,
      action: 'delivery.order.updated',
      before: {
        version: current.version,
        ...(patch.codAmount === undefined ? {} : { cod_amount: current.codAmount }),
        ...(patch.address === undefined
          ? {}
          : { zone_id: current.zoneId, pending_reason: current.pendingReason }),
      },
      after: {
        changed: parts,
        version: order.version,
        ...(patch.codAmount === undefined ? {} : { cod_amount: order.codAmount }),
        ...located,
      },
      requestId: request.facts.requestId,
      clientRequestId: request.facts.clientRequestId,
      ip: request.facts.ip,
      userAgent: request.facts.userAgent,
    });
    if (accept) {
      order = await this.deps.transitions.apply(uow, order.id, {
        to: 'accepted',
        actor: { role: 'system', type: 'system', id: null },
        facts: request.facts,
      });
    }
    return { order, items };
  }

  /**
   * Where a sent address puts the order (integrations §6.2): a sent point is the dispatcher's
   * (`manual`); an order already pinned by a recipient, a driver or a dispatcher keeps its point;
   * otherwise the geocoder is asked again. Undefined when no address was sent or the point stays.
   */
  private async relocate(order: OrderRow, patch: OrderPatch): Promise<Relocation> {
    const address = patch.address;
    if (address === undefined) return undefined;
    if (address.point === null && order.pinSource !== null && trustedPins.has(order.pinSource)) {
      return undefined;
    }
    const locale: GeocodeLocale = patch.recipient?.language ?? order.recipientLanguage ?? 'ar';
    return { located: await locate(this.deps.geocoder, address, locale) };
  }
}

function pointOf(order: OrderRow): { lat: number; lng: number } | null {
  const point = order.addressPoint;
  return point === null ? null : { lat: point.y, lng: point.x };
}
