import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';
import { coreMemberships, coreUsers } from './identity.js';
import { coreSites } from './sites.js';

// The driver tables (DEL-4 plan 2.1; domain model §3.5; data §2.2, §10; identity and tenancy §3.2;
// ADR-0025, ADR-0031, ADR-0034). Delivery's (`del_`) tables, declared in the kernel's schema folder
// as the plan rules; Delivery reads them through the kernel's public surface. Tenant tables: the
// template policies, elx_app CRUD, elx_platform SELECT (migration 0016).

export const driverStatuses = ['active', 'suspended', 'archived'] as const;
export type DriverStatus = (typeof driverStatuses)[number];

/** The default capacity limit of a new driver (plan 2.1, 2.2). */
export const defaultDriverCapacity = 30;

/**
 * `del_drivers` (Driver, domain model §3.5): one row per driver membership. `user_id` is the
 * platform-pool person (the key holds across pools as `core_memberships.user_id` does);
 * `membership_id` the `core_memberships` row holding the `driver` role. `cash_pin_hash` is a PHC
 * Argon2id string, never read outside the PIN check (ADR-0034); `cash_blocked_*` are DEL-8's (D-11).
 */
export const delDrivers = pgTable(
  'del_drivers',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => coreUsers.id),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => coreMemberships.id),
    homeSiteId: uuid('home_site_id')
      .notNull()
      .references(() => coreSites.id),
    /**
     * The name this account knows the driver by (adversary H-3): a person may drive for several
     * accounts, and no account reads or writes the name another gave them (`core_users.name`).
     */
    name: text('name').notNull(),
    status: text('status', { enum: driverStatuses }).notNull().default('active'),
    cashBlockedAt: timestamp('cash_blocked_at', { withTimezone: true }),
    cashBlockedReason: text('cash_blocked_reason'),
    capacityLimit: integer('capacity_limit').notNull().default(defaultDriverCapacity),
    cashPinHash: text('cash_pin_hash'),
    cashPinFailures: smallint('cash_pin_failures').notNull().default(0),
    cashPinLockedAt: timestamp('cash_pin_locked_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('del_drivers_account_user_key').on(table.accountId, table.userId),
    index('del_drivers_account_status_idx').on(table.accountId, table.status),
    index('del_drivers_cash_blocked_idx')
      .on(table.accountId)
      .where(sql`${table.cashBlockedAt} IS NOT NULL`),
    check('del_drivers_name_check', sql`length(${table.name}) BETWEEN 1 AND 120`),
    check('del_drivers_status_check', sql`${table.status} IN ('active', 'suspended', 'archived')`),
    check('del_drivers_capacity_limit_check', sql`${table.capacityLimit} >= 0`),
    check('del_drivers_cash_pin_failures_check', sql`${table.cashPinFailures} BETWEEN 0 AND 5`),
    check('del_drivers_version_check', sql`${table.version} >= 1`),
  ],
);

export const vehicleKinds = ['car', 'van', 'motorbike'] as const;
export type VehicleKind = (typeof vehicleKinds)[number];

/** `del_vehicles` (Vehicle, domain model §3.5): the plate is unique per account, upper-cased. */
export const delVehicles = pgTable(
  'del_vehicles',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    plate: text('plate').notNull(),
    kind: text('kind', { enum: vehicleKinds }).notNull(),
    capacityParcels: integer('capacity_parcels').notNull(),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('del_vehicles_account_plate_key').on(table.accountId, table.plate),
    check('del_vehicles_kind_check', sql`${table.kind} IN ('car', 'van', 'motorbike')`),
    check('del_vehicles_capacity_parcels_check', sql`${table.capacityParcels} >= 0`),
    check('del_vehicles_plate_check', sql`length(${table.plate}) BETWEEN 1 AND 20`),
    check('del_vehicles_version_check', sql`${table.version} >= 1`),
  ],
);

export const devicePlatforms = ['ios', 'android'] as const;
export type DevicePlatform = (typeof devicePlatforms)[number];

/** The most active devices a driver may hold (identity §3.2; Q-8 provisional default). */
export const maxActiveDevices = 2;

/**
 * `del_driver_devices` (DriverDevice, domain model §3.5): `device_id` is the app's own random id
 * (at most 200 characters); a revoked row keeps `revoked_at` and is reactivated by a new sign-in on
 * the same id. The two-device cap is counted under the driver row lock (data §2.2), not by an index.
 * `core_refresh_tokens.device_id` holds this row's `id`.
 */
export const delDriverDevices = pgTable(
  'del_driver_devices',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => delDrivers.id),
    deviceId: text('device_id').notNull(),
    platform: text('platform', { enum: devicePlatforms }).notNull(),
    appVersion: text('app_version').notNull(),
    pushToken: text('push_token'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('del_driver_devices_account_driver_device_key').on(
      table.accountId,
      table.driverId,
      table.deviceId,
    ),
    index('del_driver_devices_active_idx')
      .on(table.accountId, table.driverId)
      .where(sql`${table.revokedAt} IS NULL`),
    check('del_driver_devices_platform_check', sql`${table.platform} IN ('ios', 'android')`),
    check('del_driver_devices_device_id_check', sql`length(${table.deviceId}) BETWEEN 1 AND 200`),
    check(
      'del_driver_devices_app_version_check',
      sql`length(${table.appVersion}) BETWEEN 1 AND 64`,
    ),
    check('del_driver_devices_push_token_check', sql`length(${table.pushToken}) <= 4096`),
    check('del_driver_devices_version_check', sql`${table.version} >= 1`),
  ],
);
