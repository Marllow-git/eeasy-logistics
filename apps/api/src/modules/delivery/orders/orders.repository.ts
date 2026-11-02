import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { getContext } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import {
  and,
  asc,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  lt,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { ListPagePlan, OrderKind, OrderStatus } from '../../kernel/public/index.js';
import {
  ApiException,
  delOrderEvents,
  delOrderItems,
  delOrders,
  keysetAfter,
  keysetOrder,
  siteFilter,
} from '../../kernel/public/index.js';

// The order tables of the context's account (DEL-2 plan 2.1, 2.3; data §2.2, §8). Points are
// written as `ST_SetSRID(ST_MakePoint(lng, lat), 4326)` (Drizzle's `xy` mode would drop the SRID)
// and read longitude first (`x`). Events are only ever inserted (D-15, the trigger).

/** A `del_orders` row; `addressPoint` as Drizzle's `xy` mode reads it. */
export type OrderRow = typeof delOrders.$inferSelect;
export type OrderItemRow = typeof delOrderItems.$inferSelect;
export type OrderEventRow = typeof delOrderEvents.$inferSelect;

type OrderInsert = Omit<typeof delOrders.$inferInsert, 'accountId' | 'addressPoint'>;
type ItemInsert = Omit<typeof delOrderItems.$inferInsert, 'accountId' | 'id' | 'orderId'> & {
  readonly id: string;
};
type EventInsert = Omit<typeof delOrderEvents.$inferInsert, 'accountId' | 'point'>;
/** The columns an edit or a transition writes (never the tenant, the id or the number). */
export type OrderUpdate = Partial<
  Omit<typeof delOrders.$inferInsert, 'accountId' | 'id' | 'number' | 'addressPoint' | 'createdAt'>
>;

export type OrderSortField = 'created_at' | 'updated_at' | 'number' | 'status';

/** A listed order with the text form of its sort value (microseconds kept for the keyset). */
export type ListedOrder = OrderRow & { readonly sortKey: string };
export type ListedOrderEvent = OrderEventRow & { readonly sortKey: string };

/** The list filters of `listOrders` (plan 2.7), all optional, all in SQL. */
export interface OrderFilters {
  readonly statuses?: readonly OrderStatus[] | undefined;
  readonly siteId?: string | undefined;
  readonly zoneId?: string | undefined;
  readonly kind?: OrderKind | undefined;
  readonly number?: number | undefined;
  readonly sourceRef?: string | undefined;
  readonly createdFrom?: string | undefined;
  readonly createdTo?: string | undefined;
  readonly updatedFrom?: string | undefined;
  /** Recipient name (contains), phone tail (digits), or the order number. */
  readonly q?: string | undefined;
}

/** `q` as a literal `ILIKE` pattern: every `%`, `_` and `\` matches itself. */
const containsPattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const orderSortValue: Readonly<Record<OrderSortField, SQL>> = {
  created_at: sql`${delOrders.createdAt}`,
  updated_at: sql`${delOrders.updatedAt}`,
  // Zero-padded so the text keyset orders numerically (`number` is at most 15 digits, data §7).
  number: sql`lpad(${delOrders.number}::text, 19, '0')`,
  status: sql`${delOrders.status}`,
};

/** `D-000123`, `000123` or `123` as the stored number, else undefined. */
export type NumberOf = (q: string) => number | undefined;

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** An order's point as latitude and longitude (`addressPoint` reads longitude first). */
export function orderPoint(order: Pick<OrderRow, 'addressPoint'>): LatLng | null {
  const point = order.addressPoint;
  return point === null ? null : { lat: point.y, lng: point.x };
}

/** The unique index of `del_order_events` on `(account_id, idempotency_key)` (D-15). */
const eventKeyIndex = 'del_order_events_account_idempotency_key';

/** A unique violation (23505) of `index`, as postgres.js raises it, possibly wrapped by Drizzle. */
function isUniqueViolation(error: unknown, index: string): boolean {
  for (
    let cause = error, depth = 0;
    cause !== null && typeof cause === 'object' && depth < 3;
    depth += 1
  ) {
    const failure = cause as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (failure.code === '23505') return failure.constraint_name === index;
    cause = failure.cause;
  }
  return false;
}

function pointValue(point: LatLng | null): SQL {
  return point === null
    ? sql`NULL`
    : sql`ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326)`;
}

export class OrdersRepository extends ScopedRepository<typeof delOrders> {
  constructor(uow: UnitOfWork) {
    super(uow, delOrders);
  }

  async insert(values: OrderInsert, point: LatLng | null): Promise<OrderRow> {
    const [row] = await this.insertMany([
      { ...values, addressPoint: pointValue(point) as unknown as OrderRow['addressPoint'] },
    ]);
    if (row === undefined) throw new Error('The order insert returned no row');
    return row;
  }

  /**
   * The order of the account, within a site-scoped principal's sites (`siteFilter`: another site's
   * order is not found, README §4); `forUpdate` holds the row until the transaction ends.
   */
  async find(
    id: string,
    options: { readonly forUpdate?: boolean } = {},
  ): Promise<OrderRow | undefined> {
    const [row] = await this.findMany(
      and(eq(delOrders.id, id), siteFilter(getContext(), delOrders.siteId)),
      { forUpdate: options.forUpdate === true },
    );
    return row;
  }

  /** Writes `values` and `updated_at`; a sent `point` (null clears it) replaces the address point. */
  async update(id: string, values: OrderUpdate, point?: LatLng | null): Promise<OrderRow> {
    const [row] = await this.updateWhere(
      {
        ...values,
        updatedAt: sql`now()` as unknown as Date,
        ...(point === undefined
          ? {}
          : { addressPoint: pointValue(point) as unknown as OrderRow['addressPoint'] }),
      },
      eq(delOrders.id, id),
    );
    if (row === undefined) throw new Error('The order update returned no row');
    return row;
  }

  /**
   * One page of `listOrders` (plan 2.7): every filter, the site scope and the keyset in SQL, so
   * the dispatch board never pages in memory. `numberOf` parses a display number for `q`.
   */
  page(
    filters: OrderFilters,
    plan: Pick<ListPagePlan<OrderSortField>, 'sort' | 'after'> & { readonly limit: number },
    numberOf: NumberOf,
  ): Promise<ListedOrder[]> {
    const value = orderSortValue[plan.sort.field];
    const sortKey =
      plan.sort.kind === 'timestamp' ? sql<string>`${value}::text` : sql<string>`${value}`;
    return this.selectWhere<ListedOrder>(
      { ...getTableColumns(delOrders), sortKey },
      and(
        filters.statuses === undefined
          ? undefined
          : inArray(delOrders.status, [...filters.statuses]),
        filters.siteId === undefined ? undefined : eq(delOrders.siteId, filters.siteId),
        filters.zoneId === undefined ? undefined : eq(delOrders.zoneId, filters.zoneId),
        filters.kind === undefined ? undefined : eq(delOrders.kind, filters.kind),
        filters.number === undefined ? undefined : eq(delOrders.number, filters.number),
        filters.sourceRef === undefined ? undefined : eq(delOrders.sourceRef, filters.sourceRef),
        filters.createdFrom === undefined
          ? undefined
          : gte(delOrders.createdAt, sql`${filters.createdFrom}::timestamptz`),
        filters.createdTo === undefined
          ? undefined
          : lt(delOrders.createdAt, sql`${filters.createdTo}::timestamptz`),
        filters.updatedFrom === undefined
          ? undefined
          : gte(delOrders.updatedAt, sql`${filters.updatedFrom}::timestamptz`),
        filters.q === undefined ? undefined : textMatch(filters.q, numberOf),
        siteFilter(getContext(), delOrders.siteId),
        keysetAfter(plan, value, delOrders.id),
      ),
      { orderBy: keysetOrder(plan, value, delOrders.id), limit: plan.limit },
    );
  }

  /** Whether the site has an order that is not terminal (PLAT-12's `open_orders` reason). */
  async hasOpenOn(siteId: string, terminal: readonly OrderStatus[]): Promise<boolean> {
    const [row] = await this.selectWhere<{ id: string }>(
      { id: delOrders.id },
      and(eq(delOrders.siteId, siteId), notInArray(delOrders.status, [...terminal])),
      { limit: 1 },
    );
    return row !== undefined;
  }
}

/**
 * `q` (plan 2.7): the recipient's name contains it; or, with at least four digits and nothing but
 * digits, spaces and a leading `+`, a phone ends with them; or it is the order's number.
 */
function textMatch(q: string, numberOf: NumberOf): SQL | undefined {
  const parts: (SQL | undefined)[] = [ilike(delOrders.recipientName, containsPattern(q))];
  const digits = q.replace(/[\s+]/g, '');
  if (/^\+?[0-9 ]+$/.test(q) && digits.length >= 4) {
    const tail = `%${digits}`;
    parts.push(sql`${delOrders.recipientPhone} LIKE ${tail}`);
    parts.push(sql`${delOrders.recipientAltPhone} LIKE ${tail}`);
  }
  const number = numberOf(q);
  if (number !== undefined) parts.push(eq(delOrders.number, number));
  return or(...parts);
}

export class OrderItemsRepository extends ScopedRepository<typeof delOrderItems> {
  constructor(uow: UnitOfWork) {
    super(uow, delOrderItems);
  }

  /** The order's items in the order they were sent (`position`). */
  async insert(orderId: string, items: readonly ItemInsert[]): Promise<OrderItemRow[]> {
    const rows = await this.insertMany(items.map((item) => ({ ...item, orderId })));
    return rows.sort((a, b) => a.position - b.position);
  }

  /** Replaces the order's items with `items` (an edit sends the whole list, plan 2.8). */
  async replace(orderId: string, items: readonly ItemInsert[]): Promise<OrderItemRow[]> {
    await this.deleteWhere(eq(delOrderItems.orderId, orderId));
    return items.length === 0 ? [] : this.insert(orderId, items);
  }

  async of(orderId: string): Promise<OrderItemRow[]> {
    return this.findMany(eq(delOrderItems.orderId, orderId), {
      orderBy: [asc(delOrderItems.position)],
    });
  }
}

export class OrderEventsRepository extends ScopedRepository<typeof delOrderEvents> {
  constructor(uow: UnitOfWork) {
    super(uow, delOrderEvents);
  }

  /**
   * Appends one event. `server_ts` is the clock, not the transaction's start, so the events one
   * transaction writes (an edit and the arrow it causes) keep their order on the timeline.
   */
  async append(values: EventInsert, point: LatLng | null = null): Promise<OrderEventRow> {
    let row: OrderEventRow | undefined;
    try {
      [row] = await this.insertMany([
        {
          ...values,
          serverTs: sql`clock_timestamp()` as unknown as Date,
          point: pointValue(point) as unknown as OrderEventRow['point'],
        },
      ]);
    } catch (error) {
      // The key is unique per account for ever (D-15), across doors and principals: another
      // member's request or a driver event (DEL-7) already holds it. The transaction rolls back.
      if (isUniqueViolation(error, eventKeyIndex)) throw new ApiException('idempotency_key_reused');
      throw error;
    }
    if (row === undefined) throw new Error('The event insert returned no row');
    return row;
  }

  /** One page of the order's events (plan 2.7): `server_ts`, then `id`, in SQL. */
  page(
    orderId: string,
    plan: Pick<ListPagePlan<'server_ts'>, 'sort' | 'after'> & { readonly limit: number },
  ): Promise<ListedOrderEvent[]> {
    const value = sql`${delOrderEvents.serverTs}`;
    return this.selectWhere<ListedOrderEvent>(
      { ...getTableColumns(delOrderEvents), sortKey: sql<string>`${value}::text` },
      and(eq(delOrderEvents.orderId, orderId), keysetAfter(plan, value, delOrderEvents.id)),
      { orderBy: keysetOrder(plan, value, delOrderEvents.id), limit: plan.limit },
    );
  }
}
