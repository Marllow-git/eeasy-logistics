import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';

export const principalTypes = ['staff', 'driver', 'platform'] as const;
export const idempotencyStates = ['in_progress', 'completed'] as const;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/**
 * `core_idempotency_keys` (IdempotencyKey, domain model §2.6; data §2.1, §5.1; K-8, K-9): one row
 * per retried write, per principal, kept 24 h. A nullable-account table (data §2.4): platform
 * principals off the cross-tenant door store NULL, which the unique constraint treats as one
 * value (`NULLS NOT DISTINCT`). The request hash covers method, path, the body without secret
 * fields and an HMAC of those; secrets and PINs are never stored. The response is stored with its
 * secret fields removed. Purged hourly by the worker through the `expires_at` index (K-9).
 */
export const coreIdempotencyKeys = pgTable(
  'core_idempotency_keys',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id').references(() => coreAccounts.id),
    principalType: text('principal_type', { enum: principalTypes }).notNull(),
    /** User id (staff, platform) or device id (driver: the replay must match the device). */
    principalId: uuid('principal_id').notNull(),
    key: uuid('key').notNull(),
    /** `<METHOD> <route template>`, for diagnosis; the hash covers the concrete path. */
    route: text('route').notNull(),
    requestHash: bytea('request_hash').notNull(),
    state: text('state', { enum: idempotencyStates }).notNull().default('in_progress'),
    responseStatus: smallint('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('core_idempotency_keys_principal_key_unique')
      .on(table.accountId, table.principalId, table.key)
      .nullsNotDistinct(),
    index('core_idempotency_keys_expires_at_idx').on(table.expiresAt),
    check(
      'core_idempotency_keys_principal_type_check',
      sql`${table.principalType} IN ('staff', 'driver', 'platform')`,
    ),
    check('core_idempotency_keys_state_check', sql`${table.state} IN ('in_progress', 'completed')`),
    check(
      'core_idempotency_keys_response_check',
      sql`${table.state} = 'in_progress' OR ${table.responseStatus} IS NOT NULL`,
    ),
  ],
);
