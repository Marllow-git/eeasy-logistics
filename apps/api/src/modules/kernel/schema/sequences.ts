import { sql } from 'drizzle-orm';
import { bigint, check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';

// Human numbers (DEL-2 plan 2.1, 2.2; domain model §1.1, §8, D-2; data §2.1, §7). One counter per
// account and name, advanced under the row lock of the allocating transaction, so a rolled-back
// business write gives its number back. A tenant table with the template policies (migration
// <timestamp>_del_orders): the rows belong to the account.

/** The sequence names of data §7; the CHECK lists the same. */
export const sequenceNames = [
  'delivery_order',
  'purchase_order',
  'inbound_receipt',
  'fulfilment_order',
] as const;
export type SequenceName = (typeof sequenceNames)[number];

/**
 * `core_sequences`: `next_value` is the next number to hand out. The first allocation creates the
 * row (data §7 has provisioning create it; PLAT-13 does not yet, so the allocator upserts).
 */
export const coreSequences = pgTable(
  'core_sequences',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    name: text('name', { enum: sequenceNames }).notNull(),
    nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'core_sequences_pkey', columns: [table.accountId, table.name] }),
    check(
      'core_sequences_name_check',
      sql`${table.name} IN ('delivery_order', 'purchase_order', 'inbound_receipt', 'fulfilment_order')`,
    ),
    check('core_sequences_next_value_check', sql`${table.nextValue} >= 1`),
  ],
);
