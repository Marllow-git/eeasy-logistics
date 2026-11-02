import { multiPolygon } from '@eeasy-logistics/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { coreSites } from './sites.js';

// Zones and coverage (DEL-1 plan 2.1; domain model §3.4; data §2.2, §8; ADR-0015). Delivery's
// (`del_`) tables, declared in the kernel's schema folder as DEL-4's are; Delivery reads them
// through the kernel's public surface. Tenant tables with the template policies (migration
// <timestamp>_del_zones): elx_app works both; elx_platform inserts zones and replaces coverage
// for the provisioning doors, which write on the cross-tenant door's platform transaction.

export const zoneSources = ['official', 'drawn'] as const;
export type ZoneSource = (typeof zoneSources)[number];

/**
 * `del_zones` (Zone, domain model §3.4): a named MultiPolygon in SRID 4326, stored as given (data
 * §8), valid (`ST_IsValid`, a CHECK added by hand) and GiST-indexed for the coverage query (D-3).
 */
export const delZones = pgTable(
  'del_zones',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    boundary: multiPolygon('boundary').notNull(),
    source: text('source', { enum: zoneSources }).notNull(),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('del_zones_account_active_idx').on(table.accountId, table.active),
    check('del_zones_source_check', sql`${table.source} IN ('official', 'drawn')`),
    check('del_zones_name_ar_check', sql`char_length(${table.nameAr}) BETWEEN 1 AND 120`),
    check('del_zones_name_en_check', sql`char_length(${table.nameEn}) BETWEEN 1 AND 120`),
    check('del_zones_version_check', sql`${table.version} >= 1`),
  ],
);

/**
 * `del_coverage` (Coverage, domain model §3.4; ADR-0015): a site serves a zone. Replaced as a set
 * per site by the staff and provisioning doors; no update.
 */
export const delCoverage = pgTable(
  'del_coverage',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    siteId: uuid('site_id')
      .notNull()
      .references(() => coreSites.id),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => delZones.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('del_coverage_account_site_zone_key').on(
      table.accountId,
      table.siteId,
      table.zoneId,
    ),
    index('del_coverage_account_zone_idx').on(table.accountId, table.zoneId),
  ],
);
