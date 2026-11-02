import type { UnitOfWork } from '@eeasy-logistics/db';
import { getContext, uuidv7 } from '@eeasy-logistics/db';
import type {
  AuditSink,
  GeocodeLocale,
  GeocoderService,
  OrderAccounts,
  OrderSource,
  OutboxWriter,
  RequestFacts,
  SequenceAllocator,
} from '../../kernel/public/index.js';
import { ApiException, siteSummaries } from '../../kernel/public/index.js';
import type { CoverageQuery } from '../zones/coverage-query.js';
import type { Located } from './intake.js';
import { intakeOutcome, locate } from './intake.js';
import type { NewOrderFields } from './order-input.js';
import type { OrderItemRow, OrderRow } from './orders.repository.js';
import {
  OrderEventsRepository,
  OrderItemsRepository,
  OrdersRepository,
} from './orders.repository.js';

// Order intake (DEL-2 plan 2.3 to 2.6; domain model §3.1, D-2, D-3, D-14; integrations §6.2;
// data §10). One path for every source: the staff door now, the CSV import (DEL-3) and WMS-7's
// `OwnFleetOrderPort.createFromPackage` later. The site is checked and the address located first
// (the geocoder is I/O, so it runs before any lock is taken); then, in the caller's unit of work,
// the month's order count, the number, the zone of the point under the site's coverage, the intake
// rule, the order, its items and its first event, the audit row and the outbox row. Neither the
// audit row nor the event carries the recipient's name or phone (data §3.1, §10).

export type AuditFacts = Pick<RequestFacts, 'requestId' | 'clientRequestId' | 'ip' | 'userAgent'>;

export interface IntakeDependencies {
  readonly geocoder: Pick<GeocoderService, 'geocode' | 'lookupShortCode'>;
  readonly coverage: Pick<CoverageQuery, 'coverage'>;
  readonly accounts: Pick<OrderAccounts, 'current' | 'chargeOrder'>;
  readonly sequences: Pick<SequenceAllocator, 'next'>;
  readonly audit: AuditSink;
  readonly outbox: Pick<OutboxWriter, 'enqueue'>;
}

export interface IntakeRequest {
  readonly fields: NewOrderFields;
  readonly source: OrderSource;
  /** The request's `Idempotency-Key`: the first event's key (D-15). */
  readonly idempotencyKey: string;
  readonly facts: AuditFacts;
}

export interface CreatedOrder {
  readonly order: OrderRow;
  readonly items: readonly OrderItemRow[];
}

export class OrderIntake {
  constructor(private readonly deps: IntakeDependencies) {}

  async create(uow: UnitOfWork, request: IntakeRequest): Promise<CreatedOrder> {
    const { fields } = request;
    await this.assertDispatchSite(uow, fields.siteId);
    const account = await this.deps.accounts.current();
    const locale: GeocodeLocale = fields.recipient.language ?? 'ar';
    const located: Located | undefined = await locate(this.deps.geocoder, fields.address, locale);
    const zoneId =
      located === undefined
        ? null
        : (await this.deps.coverage.coverage(located.point, { siteId: fields.siteId, uow })).zoneId;
    const outcome = intakeOutcome(account.intakeRule, located !== undefined, zoneId);

    await this.deps.accounts.chargeOrder(uow, account.ordersPerMonth);
    const number = await this.deps.sequences.next(uow, 'delivery_order');
    const context = getContext();
    const order = await new OrdersRepository(uow).insert(
      {
        id: uuidv7(),
        number,
        kind: fields.kind,
        status: outcome.status,
        pendingReason: outcome.pendingReason,
        siteId: fields.siteId,
        source: request.source,
        sourceRef: fields.sourceRef,
        recipientName: fields.recipient.name,
        recipientPhone: fields.recipient.phone,
        recipientAltPhone: fields.recipient.altPhone,
        recipientLanguage: fields.recipient.language,
        addressText: fields.address.text,
        addressCity: fields.address.city,
        addressDistrict: fields.address.district,
        nationalAddressShortCode: fields.address.shortCode,
        pinSource: located?.pinSource ?? null,
        geocodeConfidence: located?.confidence ?? null,
        zoneId,
        codAmount: fields.codAmount,
        maxAttempts: account.maxAttempts,
        notes: fields.notes,
      },
      located?.point ?? null,
    );
    const items = await new OrderItemsRepository(uow).insert(
      order.id,
      fields.items.map((item, position) => ({
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
    await new OrderEventsRepository(uow).append({
      id: uuidv7(),
      orderId: order.id,
      type: 'transition',
      fromStatus: null,
      toStatus: order.status,
      actorType: 'user',
      actorId: context.userId,
      idempotencyKey: request.idempotencyKey,
      payload: order.pendingReason === null ? {} : { pending_reason: order.pendingReason },
    });
    await this.deps.audit.record({
      actorType: 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: 'order',
      targetId: order.id,
      action: 'delivery.order.created',
      after: {
        number: order.number,
        kind: order.kind,
        site_id: order.siteId,
        status: order.status,
        pending_reason: order.pendingReason,
        item_count: items.length,
        cod_amount: order.codAmount,
      },
      requestId: request.facts.requestId,
      clientRequestId: request.facts.clientRequestId,
      ip: request.facts.ip,
      userAgent: request.facts.userAgent,
    });
    await this.deps.outbox.enqueue(uow, {
      type: 'delivery.order.created',
      version: 1,
      aggregate: { type: 'order', id: order.id, version: order.version },
      kind: 'internal_event',
      payload: {
        order_id: order.id,
        number: order.number,
        kind: order.kind,
        source: order.source,
        site_id: order.siteId,
        status: order.status,
        pending_reason: order.pendingReason,
        zone_id: order.zoneId,
        cod_amount: { amount: order.codAmount, currency: 'SAR' },
      },
    });
    return { order, items };
  }

  /**
   * The order's site: the account's, `active` and a branch (`branch` or `both`, ADR-0018). An
   * unknown or inactive site is `400` at `/body/site_id`; a warehouse `422 site_kind_mismatch`.
   */
  private async assertDispatchSite(uow: UnitOfWork, siteId: string): Promise<void> {
    const [site] = await siteSummaries(uow, [siteId]);
    if (site?.status !== 'active') {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/body/site_id', code: 'invalid' }],
      });
    }
    if (site.kind === 'warehouse') {
      throw new ApiException('site_kind_mismatch', {
        details: { site_id: site.id, kind: site.kind },
      });
    }
  }
}
