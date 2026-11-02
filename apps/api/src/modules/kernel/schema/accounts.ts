import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreUsers } from './identity.js';

export const accountStatuses = ['provisioned', 'active', 'suspended', 'closed'] as const;
export type AccountStatus = (typeof accountStatuses)[number];
export const accountLocales = ['ar', 'en'] as const;
export type AccountLocale = (typeof accountLocales)[number];

/**
 * `core_accounts`: the tenant itself (Account, domain model §2.1; data §2.1). Minimal in PLAT-5
 * (plan 2.3); `settings` from PLAT-11 (0012), the rest of the row from PLAT-12 (0014): `country`,
 * `default_locale` and `timezone` (one value each in wave 0, CHECKed), `limits` (AccountLimits; a
 * missing key reads as the default of `modules/kernel/accounts/limits.ts`), `provisioned_by`
 * (written by PLAT-13's provisioning door), `closed_at` and `version`. A platform table, exempt
 * from `account_id` (data §2.4): elx_app may only read its own row (0003), so every write is
 * platform-pool work. Its `tenant_isolation` and `platform_access` policies (0003) are the template
 * every later table copies (data §4.3). The id is a UUIDv7 from the API.
 */
export const coreAccounts = pgTable(
  'core_accounts',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    status: text('status', { enum: accountStatuses }).notNull().default('provisioned'),
    // The integer the Eeasy WhatsApp engine knows this account by (`eeasy_account_id`, PLAT-9 plan
    // 2A.3): allocated from `core_accounts_engine_account_id_seq` (from 2) at first use; 1 is the
    // platform's reserved id. Never taken from a request.
    engineAccountId: bigint('engine_account_id', { mode: 'number' }).unique(),
    // AccountSettings (components.yaml; data §2.1), from PLAT-11 migration 0012: sign-in reads
    // `second_factor_required` (plan 2.7, Q-7); PLAT-12's settings door writes the rest.
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
    country: char('country', { length: 2 }).notNull().default('SA'),
    defaultLocale: text('default_locale', { enum: accountLocales }).notNull().default('ar'),
    timezone: text('timezone').notNull().default('Asia/Riyadh'),
    limits: jsonb('limits')
      .notNull()
      .default(sql`'{}'::jsonb`),
    provisionedBy: uuid('provisioned_by').references(() => coreUsers.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('core_accounts_status_idx').on(table.status),
    check(
      'core_accounts_status_check',
      sql`${table.status} IN ('provisioned', 'active', 'suspended', 'closed')`,
    ),
    check('core_accounts_engine_account_id_check', sql`${table.engineAccountId} >= 2`),
    check('core_accounts_country_check', sql`${table.country} = 'SA'`),
    check('core_accounts_default_locale_check', sql`${table.defaultLocale} IN ('ar', 'en')`),
    check('core_accounts_timezone_check', sql`${table.timezone} = 'Asia/Riyadh'`),
    check('core_accounts_version_check', sql`${table.version} >= 1`),
  ],
);
