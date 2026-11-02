import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';
import { delDrivers, delVehicles } from './drivers.js';
import { coreSites } from './sites.js';

// Driver shifts (DEL-5 plan 2.1; domain model §3.6, §3.17; data §2.2). A Delivery (`del_`) table
// declared in the kernel's schema folder as DEL-4's and DEL-1's are; Delivery reads it through the
// kernel's public surface. Tenant table with the template policies (migration
// <timestamp>_del_shifts_locations): elx_app CRUD, elx_platform SELECT.

/** The DriverShift statuses (state machine §3.17). */
export const shiftStatuses = [
  'planned',
  'active',
  'paused',
  'ended',
  'cancelled',
  'no_show',
] as const;
export type ShiftStatus = (typeof shiftStatuses)[number];

/** The statuses of a live shift: at most one per driver (the partial unique index). */
export const liveShiftStatuses = ['active', 'paused'] as const satisfies readonly ShiftStatus[];

/**
 * `del_driver_shifts` (DriverShift, domain model §3.6): a driver at a site, with a vehicle once
 * started. `started_at` and `ended_at` are server times. `stale_alerted_at` is the last
 * stale-tracking alert of this shift (plan 2.8: at most one per 15 minutes).
 */
export const delDriverShifts = pgTable(
  'del_driver_shifts',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    driverId: uuid('driver_id')
      .notNull()
      .references(() => delDrivers.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => coreSites.id),
    vehicleId: uuid('vehicle_id').references(() => delVehicles.id),
    plannedStart: timestamp('planned_start', { withTimezone: true }).notNull(),
    plannedEnd: timestamp('planned_end', { withTimezone: true }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    status: text('status', { enum: shiftStatuses }).notNull().default('planned'),
    staleAlertedAt: timestamp('stale_alerted_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('del_driver_shifts_account_site_start_idx').on(
      table.accountId,
      table.siteId,
      table.plannedStart,
    ),
    index('del_driver_shifts_account_driver_start_idx').on(
      table.accountId,
      table.driverId,
      table.plannedStart,
    ),
    // One live shift per driver (data §2.2, a guard implied by §3.17). A driver id belongs to one
    // account, so the key is unique across accounts (exemptions.ts `globalUniqueIndexes`).
    uniqueIndex('del_driver_shifts_live_driver_key')
      .on(table.driverId)
      .where(sql`${table.status} IN ('active', 'paused')`),
    check(
      'del_driver_shifts_status_check',
      sql`${table.status} IN ('planned', 'active', 'paused', 'ended', 'cancelled', 'no_show')`,
    ),
    check('del_driver_shifts_window_check', sql`${table.plannedStart} < ${table.plannedEnd}`),
    check(
      'del_driver_shifts_started_check',
      sql`${table.status} IN ('planned', 'cancelled', 'no_show') OR ${table.startedAt} IS NOT NULL`,
    ),
    check(
      'del_driver_shifts_ended_check',
      sql`(${table.status} = 'ended') = (${table.endedAt} IS NOT NULL)`,
    ),
    check('del_driver_shifts_version_check', sql`${table.version} >= 1`),
  ],
);
