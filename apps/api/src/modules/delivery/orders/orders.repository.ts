import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import { asc, eq, sql } from 'drizzle-orm';
import { delOrderEvents, delOrderItems, delOrders } from '../../kernel/public/index.js';

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

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
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

  async find(id: string): Promise<OrderRow | undefined> {
    const [row] = await this.findMany(eq(delOrders.id, id));
    return row;
  }
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

  async append(values: EventInsert, point: LatLng | null = null): Promise<OrderEventRow> {
    const [row] = await this.insertMany([
      { ...values, point: pointValue(point) as unknown as OrderEventRow['point'] },
    ]);
    if (row === undefined) throw new Error('The event insert returned no row');
    return row;
  }
}
