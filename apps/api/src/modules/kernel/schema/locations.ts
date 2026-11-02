import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  geometry,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';
import { delDrivers } from './drivers.js';
import { delDriverShifts } from './shifts.js';

// Driver location telemetry (DEL-5 plan 2.1, 2.6, 2.8; domain model §3.7, §7; data §2.2, §6, §10;
// ADR-0009, ADR-0028, ADR-0039). Delivery's (`del_`) tables in the kernel's schema folder, read by
// Delivery through the kernel's public surface. Tenant tables with the template policies (migration
// <timestamp>_del_shifts_locations): elx_app CRUD, elx_platform SELECT. Every position is personal
// data of the driver (data §10, `pii:driver`): never logged, never in an event payload.

/** The ring's depth per driver: one hour at 15 s (ADR-0028; data §6). */
export const locationRingSize = 240;

/**
 * `geometry(LineStringM, 4326)`: the daily trail with M = Unix seconds (data §6). Written and read
 * only through SQL (`ST_MakeLine`, `ST_AsGeoJSON`); the column value is the driver's hex EWKB.
 */
const lineStringM = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(LineStringM,4326)',
});

/**
 * `del_driver_locations` (DriverLocation, domain model §7): a fixed ring of the last 240 points per
 * driver, written by upsert into slot `seq % 240` (data §6). No `id`: the key is `(driver_id, slot)`.
 * `fillfactor = 70` and the per-table autovacuum setting are added by hand in the migration.
 */
export const delDriverLocations = pgTable(
  'del_driver_locations',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => delDrivers.id),
    slot: smallint('slot').notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => delDriverShifts.id),
    point: geometry('point', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
    clientTs: timestamp('client_ts', { withTimezone: true }).notNull(),
    serverTs: timestamp('server_ts', { withTimezone: true }).notNull(),
    accuracyM: real('accuracy_m'),
    speedMps: real('speed_mps'),
    headingDeg: real('heading_deg'),
    batteryPct: smallint('battery_pct'),
    isCharging: boolean('is_charging'),
    powerSaver: boolean('power_saver'),
  },
  (table) => [
    primaryKey({ name: 'del_driver_locations_pkey', columns: [table.driverId, table.slot] }),
    index('del_driver_locations_account_driver_idx').on(table.accountId, table.driverId),
    check('del_driver_locations_slot_check', sql`${table.slot} BETWEEN 0 AND 239`),
    check('del_driver_locations_seq_check', sql`${table.seq} >= 1`),
    check(
      'del_driver_locations_battery_check',
      sql`${table.batteryPct} IS NULL OR ${table.batteryPct} BETWEEN 0 AND 100`,
    ),
  ],
);

/**
 * `del_driver_location_heads` (data §2.2, §6): the ring head per driver. `last_seq` numbers the
 * accepted points; the latest point is the dispatcher maps' fallback when the Redis key expired;
 * `trail_seq` is the last seq the trail appender took (plan 2.8).
 */
export const delDriverLocationHeads = pgTable(
  'del_driver_location_heads',
  {
    driverId: uuid('driver_id')
      .primaryKey()
      .references(() => delDrivers.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    lastPoint: geometry('last_point', { type: 'point', mode: 'xy', srid: 4326 }),
    lastClientTs: timestamp('last_client_ts', { withTimezone: true }),
    lastServerTs: timestamp('last_server_ts', { withTimezone: true }),
    trailSeq: bigint('trail_seq', { mode: 'number' }).notNull().default(0),
  },
  (table) => [
    index('del_driver_location_heads_account_idx').on(table.accountId),
    check('del_driver_location_heads_seq_check', sql`${table.lastSeq} >= 0`),
    check(
      'del_driver_location_heads_trail_seq_check',
      sql`${table.trailSeq} BETWEEN 0 AND ${table.lastSeq}`,
    ),
  ],
);

/**
 * `del_driver_trails` (domain model §7; data §2.2, §6): one simplified line per driver and business
 * day (Asia/Riyadh), M = Unix seconds. Kept 90 days (Q-5), then deleted by `telemetry-retention`.
 */
export const delDriverTrails = pgTable(
  'del_driver_trails',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => delDrivers.id),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    path: lineStringM('path').notNull(),
    pointCount: integer('point_count').notNull(),
    firstTs: timestamp('first_ts', { withTimezone: true }).notNull(),
    lastTs: timestamp('last_ts', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('del_driver_trails_account_driver_date_key').on(
      table.accountId,
      table.driverId,
      table.businessDate,
    ),
    index('del_driver_trails_path_idx').using('gist', table.path),
    index('del_driver_trails_business_date_idx').on(table.businessDate),
    check('del_driver_trails_point_count_check', sql`${table.pointCount} >= 1`),
    check('del_driver_trails_ts_check', sql`${table.firstTs} <= ${table.lastTs}`),
  ],
);
