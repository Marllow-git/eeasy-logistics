import { sql } from 'drizzle-orm';
import {
  check,
  index,
  inet,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';

export const auditActorTypes = ['user', 'api_key', 'driver', 'system', 'platform_user'] as const;
export type AuditActorType = (typeof auditActorTypes)[number];

/**
 * `core_audit_log` (AuditLog, domain model §2.5; data §2.1, §3.1; identity and tenancy §7; K-7).
 * Declared here for its types only: the table is range-partitioned by month on `occurred_at`,
 * which Drizzle cannot express, so migration 0006 creates it by hand (with the partitions, the
 * append-only triggers, the policies and the `pii:` comments). A nullable-account table (data
 * §2.4): platform actors write rows with no account. Rows are never updated or deleted; the only
 * lawful removal is dropping a monthly partition past the retention (24 months) in the migration
 * job.
 */
export const coreAuditLog = pgTable(
  'core_audit_log',
  {
    id: uuid('id')
      .notNull()
      .default(sql`core_uuidv7()`),
    // String mode: the driver hands back PostgreSQL's text, microseconds included (cursors).
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    actorType: text('actor_type', { enum: auditActorTypes }).notNull(),
    actorId: uuid('actor_id'),
    accountId: uuid('account_id').references(() => coreAccounts.id),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    reason: text('reason'),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.occurredAt] }),
    index('core_audit_log_account_idx').on(
      table.accountId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index('core_audit_log_target_idx').on(
      table.targetType,
      table.targetId,
      table.occurredAt.desc(),
    ),
    index('core_audit_log_actor_idx').on(table.actorId, table.occurredAt.desc()),
    check(
      'core_audit_log_actor_type_check',
      sql`${table.actorType} IN ('user', 'api_key', 'driver', 'system', 'platform_user')`,
    ),
    check(
      'core_audit_log_actor_id_check',
      sql`${table.actorId} IS NOT NULL OR ${table.actorType} = 'system'`,
    ),
    check('core_audit_log_action_check', sql`${table.action} ~ '^[a-z]+\\.[a-z_]+\\.[a-z_]+$'`),
  ],
);
