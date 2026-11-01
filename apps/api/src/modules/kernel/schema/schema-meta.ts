import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * `core_schema_meta`: one row holding the migration version the database is at (PLAT-5 plan 2.7).
 * The migration job writes it as `elx_owner`; the runtime roles may only read it, and `/ready`
 * compares it with the version the build ships. A platform table, exempt from tenancy (data §2.4).
 */
export const coreSchemaMeta = pgTable(
  'core_schema_meta',
  {
    singleton: boolean('singleton').primaryKey().default(true),
    version: text('version').notNull(),
    migratedAt: timestamp('migrated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('core_schema_meta_singleton', sql`${table.singleton}`)],
);
