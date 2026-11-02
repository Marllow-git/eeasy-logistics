import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  geometry,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';
import { coreSites } from './sites.js';
import { delZones } from './zones.js';

// Orders (DEL-2 plan 2.1; domain model §3.1 to §3.3, §3.13, D-1 to D-5, D-15, D-22; data §2.2,
// §3.1, §8, §10; ADR-0005, ADR-0008, ADR-0015, ADR-0025, ADR-0031). Delivery's (`del_`) tables,
// declared in the kernel's schema folder as DEL-1's and DEL-4's are; Delivery reads them through
// the kernel's public surface. Tenant tables with the template policies (migration
// <timestamp>_del_orders). `del_order_events` is append-only by trigger (D-15); the order's
// `status` is the fold of its events, written in the same transaction. Points are PostGIS
// `geometry(Point, 4326)`, written as `ST_SetSRID(ST_MakePoint(lng, lat), 4326)` and read
// longitude first (`x`), as Drizzle's `xy` mode does (data §8). Recipient columns carry the
// `pii:recipient` tag (data §10).

export const orderKinds = ['delivery', 'return_pickup', 'exchange', 'pickup_request'] as const;
export type OrderKind = (typeof orderKinds)[number];

/** Domain model §3.13, in the order of the machine. */
export const orderStatuses = [
  'pending',
  'accepted',
  'offered',
  'assigned',
  'picked_up',
  'out_for_delivery',
  'attempted',
  'delivered',
  'failed',
  'returned',
  'cancelled',
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

/** D-3 and integrations §6.2 (`needs_location`: no reliable point; DEL-2 plan 2a). */
export const pendingReasons = ['outside_coverage', 'awaiting_review', 'needs_location'] as const;
export type PendingReason = (typeof pendingReasons)[number];

export const orderSources = ['manual', 'csv', 'api', 'channel', 'wms_package'] as const;
export type OrderSource = (typeof orderSources)[number];

export const pinSources = ['geocoded', 'recipient_pin', 'driver_pin', 'manual'] as const;
export type PinSource = (typeof pinSources)[number];

export const itemDirections = ['out', 'in'] as const;
export type ItemDirection = (typeof itemDirections)[number];

export const orderEventTypes = ['transition', 'note'] as const;
export type OrderEventType = (typeof orderEventTypes)[number];

export const orderActorTypes = ['user', 'driver', 'system', 'api_key'] as const;
export type OrderActorType = (typeof orderActorTypes)[number];

const inList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));
const e164 = sql.raw(`'^\\+[1-9][0-9]{7,14}$'`);

/** `del_orders` (Order, domain model §3.1; data §2.2). */
export const delOrders = pgTable(
  'del_orders',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    number: bigint('number', { mode: 'number' }).notNull(),
    kind: text('kind', { enum: orderKinds }).notNull(),
    status: text('status', { enum: orderStatuses }).notNull(),
    pendingReason: text('pending_reason', { enum: pendingReasons }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => coreSites.id),
    source: text('source', { enum: orderSources }).notNull(),
    sourceRef: text('source_ref'),
    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    recipientAltPhone: text('recipient_alt_phone'),
    recipientLanguage: text('recipient_language', { enum: ['ar', 'en'] }),
    addressText: text('address_text').notNull(),
    addressCity: text('address_city').notNull(),
    addressDistrict: text('address_district'),
    nationalAddressShortCode: text('national_address_short_code'),
    addressPoint: geometry('address_point', { type: 'point', mode: 'xy', srid: 4326 }),
    pinSource: text('pin_source', { enum: pinSources }),
    geocodeConfidence: real('geocode_confidence'),
    zoneId: uuid('zone_id').references(() => delZones.id),
    // No foreign key until the slots order creates `del_slots` (plan 2.3: refused until then).
    slotId: uuid('slot_id'),
    codAmount: bigint('cod_amount', { mode: 'number' }).notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('SAR'),
    // ADR-0005, D-1: reserved, always NULL by CHECK; no code reads or writes it.
    executorAccountId: uuid('executor_account_id'),
    // No foreign key until DEL-6 creates `del_assignments`.
    currentAssignmentId: uuid('current_assignment_id'),
    attemptCount: smallint('attempt_count').notNull().default(0),
    maxAttempts: smallint('max_attempts').notNull(),
    notes: text('notes'),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('del_orders_account_number_key').on(table.accountId, table.number),
    index('del_orders_account_status_site_idx').on(table.accountId, table.status, table.siteId),
    index('del_orders_account_created_idx').on(table.accountId, table.createdAt.desc(), table.id),
    index('del_orders_account_updated_idx').on(table.accountId, table.updatedAt),
    index('del_orders_account_recipient_phone_idx').on(table.accountId, table.recipientPhone),
    index('del_orders_account_source_ref_idx').on(table.accountId, table.sourceRef),
    index('del_orders_address_point_idx').using('gist', table.addressPoint),
    check('del_orders_number_check', sql`${table.number} >= 1`),
    check('del_orders_kind_check', sql`${table.kind} IN (${inList(orderKinds)})`),
    check('del_orders_status_check', sql`${table.status} IN (${inList(orderStatuses)})`),
    check(
      'del_orders_pending_reason_check',
      sql`${table.pendingReason} IN (${inList(pendingReasons)})`,
    ),
    check('del_orders_source_check', sql`${table.source} IN (${inList(orderSources)})`),
    check('del_orders_source_ref_check', sql`char_length(${table.sourceRef}) BETWEEN 1 AND 120`),
    check(
      'del_orders_recipient_name_check',
      sql`char_length(${table.recipientName}) BETWEEN 1 AND 200`,
    ),
    check('del_orders_recipient_phone_check', sql`${table.recipientPhone} ~ ${e164}`),
    check('del_orders_recipient_alt_phone_check', sql`${table.recipientAltPhone} ~ ${e164}`),
    check('del_orders_recipient_language_check', sql`${table.recipientLanguage} IN ('ar', 'en')`),
    check(
      'del_orders_address_text_check',
      sql`char_length(${table.addressText}) BETWEEN 1 AND 500`,
    ),
    check(
      'del_orders_address_city_check',
      sql`char_length(${table.addressCity}) BETWEEN 1 AND 120`,
    ),
    check(
      'del_orders_national_address_short_code_check',
      sql`${table.nationalAddressShortCode} ~ '^[A-Z]{4}[0-9]{4}$'`,
    ),
    check('del_orders_pin_source_check', sql`${table.pinSource} IN (${inList(pinSources)})`),
    check('del_orders_geocode_confidence_check', sql`${table.geocodeConfidence} BETWEEN 0 AND 1`),
    // D-4: non-negative halalas, non-zero only for the kinds that carry goods to the recipient.
    check(
      'del_orders_cod_amount_check',
      sql`${table.codAmount} >= 0 AND (${table.codAmount} = 0 OR ${table.kind} IN ('delivery', 'exchange'))`,
    ),
    check('del_orders_currency_check', sql`${table.currency} = 'SAR'`),
    // D-1 (ADR-0005): nothing is built on the executor-fleet seam.
    check('del_orders_executor_account_id_check', sql`${table.executorAccountId} IS NULL`),
    check('del_orders_attempt_count_check', sql`${table.attemptCount} >= 0`),
    check('del_orders_max_attempts_check', sql`${table.maxAttempts} >= 1`),
    check('del_orders_notes_check', sql`char_length(${table.notes}) <= 1000`),
    check('del_orders_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * `del_order_items` (OrderItem, domain model §3.2; data §2.2): bilingual names, `direction`
 * `out` or `in`, the declared value in halalas; `position` keeps the order the request sent.
 */
export const delOrderItems = pgTable(
  'del_order_items',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => delOrders.id),
    position: smallint('position').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    sku: text('sku'),
    quantity: integer('quantity').notNull(),
    direction: text('direction', { enum: itemDirections }).notNull().default('out'),
    wmsProductId: uuid('wms_product_id'),
    declaredValue: bigint('declared_value', { mode: 'number' }),
    currency: char('currency', { length: 3 }).notNull().default('SAR'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('del_order_items_account_order_idx').on(table.accountId, table.orderId),
    check('del_order_items_position_check', sql`${table.position} >= 0`),
    check('del_order_items_name_ar_check', sql`char_length(${table.nameAr}) BETWEEN 1 AND 200`),
    check('del_order_items_name_en_check', sql`char_length(${table.nameEn}) BETWEEN 1 AND 200`),
    check('del_order_items_sku_check', sql`char_length(${table.sku}) BETWEEN 1 AND 120`),
    check('del_order_items_quantity_check', sql`${table.quantity} BETWEEN 1 AND 9999`),
    check('del_order_items_direction_check', sql`${table.direction} IN ('out', 'in')`),
    check('del_order_items_declared_value_check', sql`${table.declaredValue} >= 0`),
    check('del_order_items_currency_check', sql`${table.currency} = 'SAR'`),
  ],
);

/**
 * `del_order_events` (OrderEvent, domain model §3.3; ADR-0008; data §2.2, §3.1): append-only by
 * trigger, `(account_id, idempotency_key)` unique forever (D-15). Ids, codes and points only, never
 * a name or a phone (data §3.1 design rule).
 */
export const delOrderEvents = pgTable(
  'del_order_events',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    orderId: uuid('order_id')
      .notNull()
      .references(() => delOrders.id),
    type: text('type', { enum: orderEventTypes }).notNull(),
    fromStatus: text('from_status', { enum: orderStatuses }),
    toStatus: text('to_status', { enum: orderStatuses }),
    actorType: text('actor_type', { enum: orderActorTypes }).notNull(),
    actorId: uuid('actor_id'),
    deviceId: uuid('device_id'),
    clientTs: timestamp('client_ts', { withTimezone: true }),
    serverTs: timestamp('server_ts', { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: uuid('idempotency_key'),
    point: geometry('point', { type: 'point', mode: 'xy', srid: 4326 }),
    reasonCode: text('reason_code'),
    note: text('note'),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    uniqueIndex('del_order_events_account_idempotency_key').on(
      table.accountId,
      table.idempotencyKey,
    ),
    index('del_order_events_account_order_server_ts_idx').on(
      table.accountId,
      table.orderId,
      table.serverTs,
    ),
    check('del_order_events_type_check', sql`${table.type} IN ('transition', 'note')`),
    check(
      'del_order_events_from_status_check',
      sql`${table.fromStatus} IN (${inList(orderStatuses)})`,
    ),
    check('del_order_events_to_status_check', sql`${table.toStatus} IN (${inList(orderStatuses)})`),
    // A transition names where it went; a note changes no status.
    check(
      'del_order_events_transition_check',
      sql`(${table.type} = 'transition') = (${table.toStatus} IS NOT NULL)`,
    ),
    check(
      'del_order_events_actor_type_check',
      sql`${table.actorType} IN (${inList(orderActorTypes)})`,
    ),
    check('del_order_events_reason_code_check', sql`char_length(${table.reasonCode}) <= 40`),
    check('del_order_events_note_check', sql`char_length(${table.note}) <= 1000`),
  ],
);
