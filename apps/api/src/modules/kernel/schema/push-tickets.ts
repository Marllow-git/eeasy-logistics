import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';

// Push tickets (INT-4 plan 2.4; integrations §2.5; ADR-0024).

export const pushTicketStatuses = ['pending', 'ok', 'error'] as const;
export type PushTicketStatus = (typeof pushTicketStatuses)[number];

/**
 * `core_push_tickets`: one row per message the Expo push service accepted (`ok` ticket), written by
 * the `push` handler; the receipts job checks it 15 minutes later and writes `status`, `error` and
 * `checked_at` (`no_receipt` after 24 hours), and deletes it after 7 days. Holds ids only: never the
 * push token, title, body or `data`. Tenant table (the row's account: a push always belongs to a
 * driver's account), written only by the worker on the platform pool. No foreign key to
 * `core_outbox` (pruned after 7 days) or to the Delivery device row (DEL-4's table).
 */
export const corePushTickets = pgTable(
  'core_push_tickets',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    /** The `push` outbox row the message belongs to (the app's `push_id`). */
    outboxId: uuid('outbox_id').notNull(),
    /** The Delivery device (`del_driver_devices.id`) the message went to. */
    deviceId: uuid('device_id').notNull(),
    /** The Expo ticket id, which is the receipt id. */
    ticketId: text('ticket_id').notNull(),
    status: text('status', { enum: pushTicketStatuses }).notNull().default('pending'),
    /** The receipt's error name (`DeviceNotRegistered`, …) or `no_receipt`. */
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Expo ticket ids are unique across projects and accounts (data §4.1 worker-owned keys).
    uniqueIndex('core_push_tickets_ticket_id_idx').on(table.ticketId),
    index('core_push_tickets_account_idx').on(table.accountId, table.sentAt),
    // Worker scans (data §2.1): the receipts job's unchecked tickets by age, and the 7-day purge.
    index('core_push_tickets_unchecked_idx')
      .on(table.sentAt)
      .where(sql`${table.checkedAt} IS NULL`),
    index('core_push_tickets_sent_idx').on(table.sentAt),
    check('core_push_tickets_status_check', sql`${table.status} IN ('pending', 'ok', 'error')`),
    check(
      'core_push_tickets_checked_check',
      sql`(${table.status} = 'pending') = (${table.checkedAt} IS NULL)`,
    ),
    check('core_push_tickets_ticket_id_check', sql`length(${table.ticketId}) BETWEEN 1 AND 128`),
    check(
      'core_push_tickets_error_check',
      sql`${table.error} IS NULL OR length(${table.error}) <= 64`,
    ),
  ],
);
