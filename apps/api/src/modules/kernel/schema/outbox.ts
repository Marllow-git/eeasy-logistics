import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';

/** The seven outbox kinds (domain model §2.7; integrations §4.1; ADR-0036 adds storage_lifecycle). */
export const outboxKinds = [
  'internal_event',
  'webhook',
  'message',
  'push',
  'channel_publish',
  'carrier_call',
  'storage_lifecycle',
] as const;
export type OutboxKind = (typeof outboxKinds)[number];

/** Delivery states of an outbox row (domain model §2.7; data §5.2). */
export const outboxStatuses = ['pending', 'enqueued', 'done', 'dead', 'superseded'] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

/**
 * `core_outbox` (domain model §2.7, §6.1; data §2.1, §3.1, §5.2; ADR-0024, ADR-0027, ADR-0036):
 * the event envelope plus delivery state. Written only in the business transaction by the kernel
 * `OutboxWriter` (K-10). The envelope columns (`id` … `payload`, and `kind`) are immutable after
 * insert: the `core_outbox_envelope_immutable` trigger of migration 0001, attached in 0007,
 * rejects any change with SQLSTATE EL001; only the delivery-state columns change. A
 * nullable-account table (data §2.4): platform-only effects carry no account. `payload` and
 * `last_error` may hold personal data (`pii:` comments in 0007).
 */
export const coreOutbox = pgTable(
  'core_outbox',
  {
    // Envelope (§6.1); `id` is the envelope id, a UUIDv7 minted by the writer.
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    eventVersion: integer('event_version').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    accountId: uuid('account_id').references(() => coreAccounts.id),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    sequence: integer('sequence').notNull(),
    causationId: uuid('causation_id'),
    correlationId: uuid('correlation_id'),
    payload: jsonb('payload').notNull(),
    kind: text('kind', { enum: outboxKinds }).notNull(),
    // Delivery state (§2.7; data §5.2).
    status: text('status', { enum: outboxStatuses }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    supersedeKey: text('supersede_key'),
    enqueuedAt: timestamp('enqueued_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Worker scans (data §2.1): the relay's due rows and the sweeper's enqueued rows.
    index('core_outbox_pending_due_idx')
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
    // The relay's batch order (data §5.2: ORDER BY id over pending rows; lead review round 1).
    index('core_outbox_pending_id_idx')
      .on(table.id)
      .where(sql`${table.status} = 'pending'`),
    index('core_outbox_enqueued_idx')
      .on(table.enqueuedAt)
      .where(sql`${table.status} = 'enqueued'`),
    index('core_outbox_account_idx').on(table.accountId, table.status, table.createdAt.desc()),
    // Finished rows by age: the daily pruning job (plan 2.8, data §5.2) and the platform list of
    // dead rows across accounts (plan 2.7).
    index('core_outbox_finished_idx')
      .on(table.status, table.createdAt)
      .where(sql`${table.status} IN ('done', 'superseded', 'dead')`),
    index('core_outbox_aggregate_idx').on(table.aggregateId, table.sequence),
    // One pending row per key and account, as `supersedePending` is account-scoped (lead review
    // round 2): two accounts may share a key. Migration 0007 adds NULLS NOT DISTINCT by hand (the
    // Drizzle index builder cannot say it), so platform-only rows (NULL account) share one scope.
    // Rows without a key are left out: NULLS NOT DISTINCT would make them collide per account.
    uniqueIndex('core_outbox_supersede_key_pending_idx')
      .on(table.accountId, table.supersedeKey)
      .where(sql`${table.status} = 'pending' AND ${table.supersedeKey} IS NOT NULL`),
    check(
      'core_outbox_kind_check',
      sql`${table.kind} IN ('internal_event', 'webhook', 'message', 'push', 'channel_publish', 'carrier_call', 'storage_lifecycle')`,
    ),
    check(
      'core_outbox_status_check',
      sql`${table.status} IN ('pending', 'enqueued', 'done', 'dead', 'superseded')`,
    ),
    check(
      'core_outbox_type_check',
      sql`${table.type} ~ '^[a-z]+(_[a-z]+)*([.][a-z]+(_[a-z]+)*){2}$'`,
    ),
    check('core_outbox_event_version_check', sql`${table.eventVersion} >= 1`),
    check('core_outbox_sequence_check', sql`${table.sequence} >= 1`),
    check('core_outbox_attempts_check', sql`${table.attempts} >= 0`),
  ],
);

/**
 * `core_consumer_receipts` (domain model §2.7; data §2.1, §5.3): one row per internal consumer and
 * event, written in the consumer's transaction so a redelivery is a no-op. Kept 35 days (longer
 * than the 30-day dead-row window). The account mirrors the event's (NULL for a platform-only
 * event). No foreign key to `core_outbox`: outbox rows are pruned after 7 days.
 */
export const coreConsumerReceipts = pgTable(
  'core_consumer_receipts',
  {
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    accountId: uuid('account_id').references(() => coreAccounts.id),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'core_consumer_receipts_pk', columns: [table.consumer, table.eventId] }),
    index('core_consumer_receipts_account_idx').on(table.accountId, table.processedAt),
    // The receipt purge after 35 days, across accounts (plan 2.8, data §5.3).
    index('core_consumer_receipts_processed_idx').on(table.processedAt),
  ],
);

/**
 * `core_consumer_dead_letters` (data §2.1, §5.3): an internal delivery that stayed parked past the
 * window or failed its budget; feeds the platform `ConsumerList`. Kept 30 days.
 */
export const coreConsumerDeadLetters = pgTable(
  'core_consumer_dead_letters',
  {
    id: uuid('id').primaryKey(),
    consumer: text('consumer').notNull(),
    eventId: uuid('event_id').notNull(),
    accountId: uuid('account_id').references(() => coreAccounts.id),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    replayedAt: timestamp('replayed_at', { withTimezone: true }),
  },
  (table) => [
    unique('core_consumer_dead_letters_consumer_event_unique').on(table.consumer, table.eventId),
    index('core_consumer_dead_letters_account_idx').on(table.accountId, table.createdAt.desc()),
  ],
);
