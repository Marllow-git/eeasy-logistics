import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  inet,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const otpPurposes = ['driver_login', 'second_factor'] as const;
export type OtpPurpose = (typeof otpPurposes)[number];

/**
 * `core_otp_challenges` (data §2.1; identity and tenancy §3.2; PLAT-9 plan 2.4): one row per code
 * sent. Exempt from tenancy (data §2.4, class "users"): the challenge precedes knowing the account,
 * so it is keyed by the E.164 phone. The code is never stored: `code_hash` is an HMAC under a key
 * derived from the credentials key. Single use by a row lock on verification; `attempts` counts
 * wrong codes (five invalidate it). Only the platform pool touches it (elx_app holds no grant);
 * rows are deleted one hour after `expires_at` (data §10; the purge job is PLAT-9 leg 2).
 */
export const coreOtpChallenges = pgTable(
  'core_otp_challenges',
  {
    id: uuid('id').primaryKey(),
    phone: text('phone').notNull(),
    purpose: text('purpose', { enum: otpPurposes }).notNull(),
    codeHash: bytea('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: smallint('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('core_otp_challenges_phone_created_idx').on(table.phone, table.createdAt.desc()),
    check('core_otp_challenges_phone_check', sql`${table.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      'core_otp_challenges_purpose_check',
      sql`${table.purpose} IN ('driver_login', 'second_factor')`,
    ),
    check('core_otp_challenges_attempts_check', sql`${table.attempts} >= 0`),
  ],
);
