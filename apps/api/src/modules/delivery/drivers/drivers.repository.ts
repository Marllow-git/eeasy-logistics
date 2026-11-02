import type { TenantUpdate, UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { DevicePlatform, DriverStatus } from '../../kernel/public/index.js';
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
  /** The name this account gives the driver (adversary H-3), never the person's. */
  readonly name: string;
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

  /**
   * The driver row lock (plan 2.7, 2.9; data §2.2): a driver's own doors (sign-in's device binding,
   * the cash PIN) take it alone; a staff write of that driver takes it after `lockWrites()`, so the
   * two orders never cross.
   */
  lockDriver(id: string): Promise<void> {
    return this.transactionLock(`del_drivers:${id}`);
  }

  /** The drivers counted against `limits.drivers`: `active` and `suspended`. */
  countCounted(): Promise<number> {
    return this.countWhere(inArray(delDrivers.status, [...countedStatuses]));
  }

  async find(id: string): Promise<DriverRow | undefined> {
    const [row] = await this.findMany(eq(delDrivers.id, id));
    return row;
  }

  /** The driver of a membership (a driver token's `mem`), or undefined. */
  async findOfMembership(membershipId: string): Promise<DriverRow | undefined> {
    const [row] = await this.findMany(eq(delDrivers.membershipId, membershipId));
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
    values: Pick<
      TenantUpdate<typeof delDrivers>,
      'name' | 'homeSiteId' | 'status' | 'capacityLimit'
    >,
  ): Promise<DriverRow> {
    return this.write(id, values);
  }

  /** The PIN reset (plan 2.5): no hash, no failures, no lock; `version + 1`. */
  resetCashPin(id: string): Promise<DriverRow> {
    return this.write(id, { cashPinHash: null, cashPinFailures: 0, cashPinLockedAt: null });
  }

  /**
   * The outcome of a cash PIN check (plan 2.9): the failure count, and the lock when the fifth
   * failure sets it; `version + 1`. The caller holds `lockDriver(id)`.
   */
  recordPinCheck(id: string, failures: number, lock: boolean): Promise<DriverRow> {
    return this.write(id, {
      cashPinFailures: failures,
      ...(lock ? { cashPinLockedAt: sql`now()` as unknown as Date } : {}),
    });
  }

  /** A new cash PIN hash (plan 2.9): failures and lock cleared; `version + 1`. */
  setCashPin(id: string, hash: string): Promise<DriverRow> {
    return this.write(id, { cashPinHash: hash, cashPinFailures: 0, cashPinLockedAt: null });
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

  /** The driver's device the app names `appDeviceId`, revoked or not, or undefined. */
  async findByAppId(driverId: string, appDeviceId: string): Promise<DriverDeviceRow | undefined> {
    const [row] = await this.findMany(
      and(eq(delDriverDevices.driverId, driverId), eq(delDriverDevices.deviceId, appDeviceId)),
    );
    return row;
  }

  /** A device row seen at a sign-in for the first time (plan 2.7). */
  async insert(values: {
    readonly id: string;
    readonly driverId: string;
    readonly deviceId: string;
    readonly platform: DevicePlatform;
    readonly appVersion: string;
    readonly pushToken: string | null;
  }): Promise<DriverDeviceRow> {
    const [row] = await this.insertMany([{ ...values, lastSeenAt: sql`now()` as unknown as Date }]);
    if (row === undefined) throw new Error('The device insert returned no row');
    return row;
  }

  /**
   * A known, live device signing in again (plan 2.7): its platform and app version, the push token
   * when the app sent one, `last_seen_at`; `version + 1`. A revoked row is never rebound (M-1).
   */
  async rebind(
    id: string,
    values: {
      readonly platform: DevicePlatform;
      readonly appVersion: string;
      readonly pushToken?: string | undefined;
    },
  ): Promise<DriverDeviceRow> {
    return this.write(id, {
      platform: values.platform,
      appVersion: values.appVersion,
      ...(values.pushToken === undefined ? {} : { pushToken: values.pushToken }),
      lastSeenAt: sql`now()` as unknown as Date,
    });
  }

  /** This device's push token replaced (`driverUpdatePushToken`, plan 2.8); `version + 1`. */
  setPushToken(id: string, pushToken: string): Promise<DriverDeviceRow> {
    return this.write(id, { pushToken, lastSeenAt: sql`now()` as unknown as Date });
  }

  /**
   * The push service says the token no longer reaches this device (plan 2.11; INT-4's registry):
   * the token cleared; `version + 1`. Returns whether a row had one.
   */
  async clearPushToken(id: string): Promise<boolean> {
    const rows = await this.updateWhere(
      {
        pushToken: null,
        version: sql`${delDriverDevices.version} + 1` as unknown as number,
        updatedAt: sql`now()` as unknown as Date,
      },
      and(eq(delDriverDevices.id, id), isNotNull(delDriverDevices.pushToken)),
    );
    return rows.length > 0;
  }

  /** `last_seen_at` now (`driverLogout`, plan 2.8): a sighting, not a change (no version). */
  async seen(id: string): Promise<void> {
    await this.updateWhere(
      { lastSeenAt: sql`now()` as unknown as Date },
      eq(delDriverDevices.id, id),
    );
  }

  /** The driver's devices not yet revoked. */
  active(driverId: string): Promise<DriverDeviceRow[]> {
    return this.findMany(
      and(eq(delDriverDevices.driverId, driverId), isNull(delDriverDevices.revokedAt)),
    );
  }

  /** One device revoked (plan 2.5): `revoked_at`, its push token cleared, `version + 1`. */
  revoke(id: string): Promise<DriverDeviceRow> {
    return this.write(id, { revokedAt: sql`now()` as unknown as Date, pushToken: null });
  }

  private async write(
    id: string,
    values: TenantUpdate<typeof delDriverDevices>,
  ): Promise<DriverDeviceRow> {
    const [row] = await this.updateWhere(
      {
        ...values,
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
