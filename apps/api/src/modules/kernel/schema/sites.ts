import { sql } from 'drizzle-orm';
import {
  check,
  date,
  geometry,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';

export const siteKinds = ['branch', 'warehouse', 'both'] as const;
export type SiteKind = (typeof siteKinds)[number];
export const siteStatuses = ['active', 'inactive'] as const;
export type SiteStatus = (typeof siteStatuses)[number];

/** One opening window: weekday 0 (Sunday) to 6, `HH:MM` 24 h; `closes` before `opens` overnight. */
export interface OpeningHours {
  readonly weekday: number;
  readonly opens: string;
  readonly closes: string;
}

/**
 * `core_sites` (Site, domain model §2.3; ADR-0018; data §2.1; PLAT-12 plan 2.1): one table for
 * branches and warehouses (`kind`), the place dispatch, cash custody and stock hang off. A tenant
 * table with the template policies (0014). `point` is PostGIS `geometry(Point, 4326)`, written as
 * `ST_SetSRID(ST_MakePoint(lng, lat), 4326)` and read longitude first (`x`), as Drizzle's `xy`
 * mode does (data §8). Never deleted once referenced: `status` goes `active ⇄ inactive` (K-5).
 */
export const coreSites = pgTable(
  'core_sites',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    kind: text('kind', { enum: siteKinds }).notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    addressText: text('address_text'),
    nationalAddressShortCode: text('national_address_short_code'),
    point: geometry('point', { type: 'point', mode: 'xy', srid: 4326 }),
    openingHours: jsonb('opening_hours')
      .$type<OpeningHours[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    status: text('status', { enum: siteStatuses }).notNull().default('active'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('core_sites_account_status_idx').on(table.accountId, table.status),
    index('core_sites_point_idx').using('gist', table.point),
    check('core_sites_kind_check', sql`${table.kind} IN ('branch', 'warehouse', 'both')`),
    check('core_sites_status_check', sql`${table.status} IN ('active', 'inactive')`),
    check(
      'core_sites_national_address_short_code_check',
      sql`${table.nationalAddressShortCode} ~ '^[A-Z]{4}[0-9]{4}$'`,
    ),
    check('core_sites_version_check', sql`${table.version} >= 1`),
  ],
);

export const usageMetrics = ['orders', 'drivers', 'sites', 'api_keys'] as const;
export type UsageMetric = (typeof usageMetrics)[number];

/**
 * `core_usage_counters` (domain model §2.1 usage counters; data §2.1; PLAT-12 plan 2.1, 2.2): one
 * counter per account, metric and period (the month start in Asia/Riyadh). A tenant table. Only
 * `orders` is read from here (`usage.orders_per_month`); DEL-2's order intake increments it in the
 * same transaction as the order insert. The other usages are counted from their own tables.
 */
export const coreUsageCounters = pgTable(
  'core_usage_counters',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    metric: text('metric', { enum: usageMetrics }).notNull(),
    period: date('period', { mode: 'string' }).notNull(),
    value: integer('value').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'core_usage_counters_pkey',
      columns: [table.accountId, table.metric, table.period],
    }),
    check(
      'core_usage_counters_metric_check',
      sql`${table.metric} IN ('orders', 'drivers', 'sites', 'api_keys')`,
    ),
    check('core_usage_counters_value_check', sql`${table.value} >= 0`),
  ],
);
