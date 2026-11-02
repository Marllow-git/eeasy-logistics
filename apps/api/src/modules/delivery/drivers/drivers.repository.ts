import type { TenantUpdate, UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { DriverStatus } from '../../kernel/public/index.js';
import { delDriverDevices, delDrivers } from '../../kernel/public/index.js';

/** A `del_drivers` row of the context's account. */
export type DriverRow = typeof delDrivers.$inferSelect;
/** A `del_driver_devices` row of the context's account. */
export type DriverDeviceRow = typeof delDriverDevices.$inferSelect;

export interface DriverFilters {
  readonly statuses?: readonly DriverStatus[] | undefined;
  readonly homeSiteId?: string | undefined;
  readonly cashBlocked?: boolean | undefined;
}

/** The driver fields a create or a reactivation writes. */
export interface DriverFields {
  readonly userId: string;
  readonly membershipId: string;
  readonly homeSiteId: string;
  readonly capacityLimit: number;
}

/** The statuses that count against `limits.drivers` (plan 2.2). */
const countedStatuses: readonly DriverStatus[] = ['active', 'suspended'];

/** `del_drivers` of the context's account in the request's tenant unit of work (DEL-4 plan 2.2). */
export class DriversRepository extends ScopedRepository<typeof delDrivers> {
  constructor(uow: UnitOfWork) {
    super(uow, delDrivers);
  }

  /**
   * Orders the account's driver writes (plan 2.2, 2.4, 2.5; the site lock's pattern, PLAT-12 8.2
   * #12): the limit count and the insert of a create, and every staff change of a driver, its
   * devices and its PIN, run one after the other, each seeing what the previous committed.
   */
  lockWrites(): Promise<void> {
    return this.transactionLock('del_drivers');
  }

  /** The drivers counted against `limits.drivers`: `active` and `suspended`. */
  countCounted(): Promise<number> {
    return this.countWhere(inArray(delDrivers.status, [...countedStatuses]));
  }

  async find(id: string): Promise<DriverRow | undefined> {
    const [row] = await this.findMany(eq(delDrivers.id, id));
    return row;
  }

  async findOfUser(userId: string): Promise<DriverRow | undefined> {
    const [row] = await this.findMany(eq(delDrivers.userId, userId));
    return row;
  }

  /**
   * Every driver of the account the filters keep, unordered: `listDrivers` sorts and pages them with
   * their people's names, which only the platform pool can read (plan 2.4; PLAT-12 8.2 #21).
   */
  matching(filters: DriverFilters): Promise<DriverRow[]> {
    return this.findMany(
      and(
        filters.statuses === undefined
          ? undefined
          : inArray(delDrivers.status, [...filters.statuses]),
        filters.homeSiteId === undefined
          ? undefined
          : eq(delDrivers.homeSiteId, filters.homeSiteId),
        filters.cashBlocked === undefined
          ? undefined
          : filters.cashBlocked
            ? isNotNull(delDrivers.cashBlockedAt)
            : isNull(delDrivers.cashBlockedAt),
      ),
    );
  }

  async insert(id: string, fields: DriverFields): Promise<DriverRow> {
    const [row] = await this.insertMany([{ id, ...fields }]);
    if (row === undefined) throw new Error('The driver insert returned no row');
    return row;
  }

  /**
   * An archived driver created again (plan 2.2): `active` with the new home site, capacity and
   * membership, the PIN cleared (a new one is set with a fresh code, 2.9), `version + 1`.
   */
  reactivate(id: string, fields: DriverFields): Promise<DriverRow> {
    return this.write(id, {
      ...fields,
      status: 'active',
      cashPinHash: null,
      cashPinFailures: 0,
      cashPinLockedAt: null,
    });
  }

  /** The changed fields, `version + 1`; the caller holds `lockWrites()`. */
  update(
    id: string,
    values: Pick<TenantUpdate<typeof delDrivers>, 'homeSiteId' | 'status' | 'capacityLimit'>,
  ): Promise<DriverRow> {
    return this.write(id, values);
  }

  /** The PIN reset (plan 2.5): no hash, no failures, no lock; `version + 1`. */
  resetCashPin(id: string): Promise<DriverRow> {
    return this.write(id, { cashPinHash: null, cashPinFailures: 0, cashPinLockedAt: null });
  }

  /** Bumps `version` (and `updated_at`) alone: a change that lives on the person (the name). */
  touch(id: string): Promise<DriverRow> {
    return this.write(id, {});
  }

  private async write(id: string, values: TenantUpdate<typeof delDrivers>): Promise<DriverRow> {
    const [row] = await this.updateWhere(
      {
        ...values,
        version: sql`${delDrivers.version} + 1` as unknown as number,
        updatedAt: sql`now()` as unknown as Date,
      },
      eq(delDrivers.id, id),
    );
    if (row === undefined) throw new Error('The driver vanished under the write lock');
    return row;
  }
}

/** `del_driver_devices` of the context's account (plan 2.4, 2.5). */
export class DriverDevicesRepository extends ScopedRepository<typeof delDriverDevices> {
  constructor(uow: UnitOfWork) {
    super(uow, delDriverDevices);
  }

  /** The driver's devices, revoked included, newest first (`listDriverDevices`). */
  ofDriver(driverId: string): Promise<DriverDeviceRow[]> {
    return this.findMany(eq(delDriverDevices.driverId, driverId), {
      orderBy: [desc(delDriverDevices.createdAt), desc(delDriverDevices.id)],
    });
  }

  async find(driverId: string, id: string): Promise<DriverDeviceRow | undefined> {
    const [row] = await this.findMany(
      and(eq(delDriverDevices.driverId, driverId), eq(delDriverDevices.id, id)),
    );
    return row;
  }

  /** The driver's devices not yet revoked. */
  active(driverId: string): Promise<DriverDeviceRow[]> {
    return this.findMany(
      and(eq(delDriverDevices.driverId, driverId), isNull(delDriverDevices.revokedAt)),
    );
  }

  /** One device revoked (plan 2.5): `revoked_at`, its push token cleared, `version + 1`. */
  async revoke(id: string): Promise<DriverDeviceRow> {
    const [row] = await this.updateWhere(
      {
        revokedAt: sql`now()` as unknown as Date,
        pushToken: null,
        version: sql`${delDriverDevices.version} + 1` as unknown as number,
        updatedAt: sql`now()` as unknown as Date,
      },
      eq(delDriverDevices.id, id),
    );
    if (row === undefined) throw new Error('The device vanished under the write lock');
    return row;
  }

  /**
   * The driver archived (plan 2.4; data §10): every device's push token cleared, every active
   * device revoked; returns the rows changed.
   */
  retireAll(driverId: string): Promise<DriverDeviceRow[]> {
    return this.updateWhere(
      {
        revokedAt: sql`coalesce(${delDriverDevices.revokedAt}, now())` as unknown as Date,
        pushToken: null,
        version: sql`${delDriverDevices.version} + 1` as unknown as number,
        updatedAt: sql`now()` as unknown as Date,
      },
      and(
        eq(delDriverDevices.driverId, driverId),
        sql`(${delDriverDevices.revokedAt} IS NULL OR ${delDriverDevices.pushToken} IS NOT NULL)`,
      ),
    );
  }
}
