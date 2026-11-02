import { sql } from 'drizzle-orm';
import { check, customType, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// The geocode cache (INT-2 plan 2.4; integrations §2.2; data §1.3 hashes as bytea).

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const geocodeMethods = ['geocode', 'shortcode', 'reverse'] as const;
export type GeocodeMethod = (typeof geocodeMethods)[number];

/** The sources whose answers are cached (INT-2 plan 2.4, 2.11); never the stub. */
export const cachedGeocodeSources = ['spl', 'sayyar', 'hudhud'] as const;
export type CachedGeocodeSource = (typeof cachedGeocodeSources)[number];

/**
 * `core_geocode_cache`: one row per provider answer, keyed by the SHA-256 of `<method>\n<normalised
 * input>`, holding the port's result (or `{ "kind": "not_found" }`) until `expires_at` (30 days for
 * a hit, 24 hours for `not_found`). A platform table: the answer for an address text is the same
 * for every tenant and carries no tenant data, so the row has no `account_id`; it is read and
 * written only on the platform pool. The stub's answers are never cached (the fixture is the cache).
 */
export const coreGeocodeCache = pgTable(
  'core_geocode_cache',
  {
    key: bytea('key').primaryKey(),
    method: text('method', { enum: geocodeMethods }).notNull(),
    /** The source that answered (for `not_found`, the last source asked). */
    provider: text('provider', { enum: cachedGeocodeSources }).notNull(),
    result: jsonb('result').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // The hourly purge of expired rows (plan 2.4).
    index('core_geocode_cache_expires_idx').on(table.expiresAt),
    check('core_geocode_cache_key_check', sql`octet_length(${table.key}) = 32`),
    check(
      'core_geocode_cache_method_check',
      sql`${table.method} IN ('geocode', 'shortcode', 'reverse')`,
    ),
    check(
      'core_geocode_cache_provider_check',
      sql`${table.provider} IN ('spl', 'sayyar', 'hudhud')`,
    ),
    check('core_geocode_cache_expiry_check', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
