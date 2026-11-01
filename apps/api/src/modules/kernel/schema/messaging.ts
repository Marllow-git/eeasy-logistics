import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';

// Messaging tables (PLAT-9 plan 2.5, 2.7, 2.8; integrations §5.5, §5.6; ADR-0037, ADR-0041).

export const optOutSources = ['reply', 'provider'] as const;
export type OptOutSource = (typeof optOutSources)[number];

/**
 * `core_messaging_opt_outs` (integrations §5.5; plan 2.7): a recipient phone that stopped an
 * account's messages, by a stop word in a reply or the engine's `suppression.changed` (source
 * `provider`, plan 2A.2). Recipient templates to the pair are skipped (`done`, reason `opted_out`);
 * OTP never consults it. A START removes the row. Tenant table; written by the worker and the
 * callback door on the platform pool.
 */
export const coreMessagingOptOuts = pgTable(
  'core_messaging_opt_outs',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    phone: text('phone').notNull(),
    source: text('source', { enum: optOutSources }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.phone] }),
    check('core_messaging_opt_outs_phone_check', sql`${table.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check('core_messaging_opt_outs_source_check', sql`${table.source} IN ('reply', 'provider')`),
  ],
);

/**
 * `core_messaging_usage` (integrations §5.6; plan 2.8): messages an account sent per calendar month
 * (UTC, `period` = the first day), counted when a row is sent; the `messages_per_month` limit
 * (PLAT-13) is checked against it. Tenant table, written by the worker only.
 */
export const coreMessagingUsage = pgTable(
  'core_messaging_usage',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    period: date('period').notNull(),
    sent: integer('sent').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.period] }),
    check('core_messaging_usage_sent_check', sql`${table.sent} >= 0`),
    check(
      'core_messaging_usage_period_check',
      sql`${table.period} = date_trunc('month', ${table.period})::date`,
    ),
  ],
);

/** Engine connection states of `connection.event` (engine contract §5.4), plus `linked`. */
export const senderStatuses = [
  'linked',
  'connected',
  'disconnected',
  'qr',
  'reconnecting',
  'needs_relink',
  'banned',
  'replaced',
  'stopped',
] as const;
export type SenderStatus = (typeof senderStatuses)[number];

/**
 * `core_messaging_senders` (PLAT-9 plan 2A.4; ADR-0041): an account's own linked WhatsApp sender in
 * the engine. Recipient messages of an account leave only through it; an account without one gets
 * `no_sender`, never the platform's instance. `status` mirrors the engine's `connection.event`,
 * applied in `status_at` order. Linking (instance create, QR, relink, logout) is a later order
 * behind the platform door; this order reads and updates the row. Tenant table.
 */
export const coreMessagingSenders = pgTable(
  'core_messaging_senders',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => coreAccounts.id),
    senderInstanceId: uuid('sender_instance_id').notNull().unique(),
    status: text('status', { enum: senderStatuses }).notNull().default('linked'),
    statusAt: timestamp('status_at', { withTimezone: true }),
    linkedBy: uuid('linked_by'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'core_messaging_senders_status_check',
      sql`${table.status} IN ('linked', 'connected', 'disconnected', 'qr', 'reconnecting', 'needs_relink', 'banned', 'replaced', 'stopped')`,
    ),
  ],
);

/**
 * `core_engine_callback_nonces` (engine contract §2.5; plan 2A.2): the replay cache of the engine's
 * callbacks, `(service_identity, nonce)` reserved by `INSERT … ON CONFLICT DO NOTHING` before the
 * body is used; `callback_id` set once the body is parsed, so a callback delivered twice is applied
 * once. Kept 24 hours (the OTP purge job deletes older rows). A platform table: no account.
 */
export const coreEngineCallbackNonces = pgTable(
  'core_engine_callback_nonces',
  {
    serviceIdentity: text('service_identity').notNull(),
    nonce: text('nonce').notNull(),
    callbackId: uuid('callback_id').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.serviceIdentity, table.nonce] }),
    index('core_engine_callback_nonces_created_idx').on(table.createdAt),
    check('core_engine_callback_nonces_nonce_check', sql`${table.nonce} ~ '^[0-9a-f]{32}$'`),
  ],
);
