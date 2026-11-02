import type { TenantUpdate, UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { ListPagePlan, PageKey, VehicleKind } from '../../kernel/public/index.js';
import { delVehicles, keysetAfter, keysetOrder } from '../../kernel/public/index.js';

/** A `del_vehicles` row of the context's account. */
export type VehicleRow = typeof delVehicles.$inferSelect;

/** The documented sort fields of `listVehicles` (plan 2.6: `plate` by default). */
export type VehicleSortField = 'plate' | 'created_at';

export interface VehicleFields {
  readonly plate: string;
  readonly kind: VehicleKind;
  readonly capacityParcels: number;
  readonly active: boolean;
}

/** What each sort field orders by (`created_at` at the millisecond the cursor carries). */
const sortValue: Record<VehicleSortField, SQL | AnyPgColumn> = {
  plate: delVehicles.plate,
  created_at: sql`date_trunc('milliseconds', ${delVehicles.createdAt})`,
};

export function vehicleKeyOf(field: VehicleSortField, row: VehicleRow): PageKey {
  return { value: field === 'plate' ? row.plate : row.createdAt.toISOString(), id: row.id };
}

/** `del_vehicles` of the context's account (DEL-4 plan 2.6). */
export class VehiclesRepository extends ScopedRepository<typeof delVehicles> {
  constructor(uow: UnitOfWork) {
    super(uow, delVehicles);
  }

  /** Orders the account's vehicle writes, so a plate's uniqueness check and its write agree. */
  lockWrites(): Promise<void> {
    return this.transactionLock('del_vehicles');
  }

  async find(id: string): Promise<VehicleRow | undefined> {
    const [row] = await this.findMany(eq(delVehicles.id, id));
    return row;
  }

  /** Whether another vehicle of the account has this plate. */
  async plateTaken(plate: string, except?: string): Promise<boolean> {
    const rows = await this.findMany(
      and(
        eq(delVehicles.plate, plate),
        except === undefined ? undefined : ne(delVehicles.id, except),
      ),
      { limit: 1 },
    );
    return rows.length > 0;
  }

  page(query: {
    readonly active: boolean | undefined;
    readonly sort: ListPagePlan<VehicleSortField>['sort'];
    readonly after: PageKey | undefined;
    readonly limit: number;
  }): Promise<VehicleRow[]> {
    const value = sortValue[query.sort.field];
    const plan = { sort: query.sort, after: query.after };
    return this.findMany(
      and(
        query.active === undefined ? undefined : eq(delVehicles.active, query.active),
        keysetAfter(plan, value, delVehicles.id),
      ),
      { orderBy: keysetOrder(plan, value, delVehicles.id), limit: query.limit },
    );
  }

  async insert(id: string, fields: VehicleFields): Promise<VehicleRow> {
    const [row] = await this.insertMany([{ id, ...fields }]);
    if (row === undefined) throw new Error('The vehicle insert returned no row');
    return row;
  }

  /** The changed fields, `version + 1`; the caller holds `lockWrites()`. */
  async update(id: string, values: TenantUpdate<typeof delVehicles>): Promise<VehicleRow> {
    const [row] = await this.updateWhere(
      {
        ...values,
        version: sql`${delVehicles.version} + 1` as unknown as number,
        updatedAt: sql`now()` as unknown as Date,
      },
      eq(delVehicles.id, id),
    );
    if (row === undefined) throw new Error('The vehicle vanished under the write lock');
    return row;
  }
}
