import { sql } from 'drizzle-orm';
import { bigint, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const accountStatuses = ['provisioned', 'active', 'suspended', 'closed'] as const;
export type AccountStatus = (typeof accountStatuses)[number];

/**
 * `core_accounts`: the tenant itself (Account, domain model §2.1; data §2.1). Minimal in PLAT-5
 * (plan 2.3); the provisioning order adds country, locale, limits and settings. A platform table,
 * exempt from `account_id` (data §2.4); its `tenant_isolation` and `platform_access` policies
 * (0003) are the template every later table copies (data §4.3). The id is a UUIDv7 from the API.
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
    // `second_factor_required` (plan 2.7, Q-7); PLAT-12 and PLAT-13 write the rest.
    settings: jsonb('settings')
      .notNull()
      .default(sql`'{}'::jsonb`),
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
  ],
);
