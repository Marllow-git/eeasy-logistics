import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';
import { coreUsers } from './identity.js';

export const rolloutModes = ['off', 'allowlist', 'all'] as const;
export type RolloutModeValue = (typeof rolloutModes)[number];

/**
 * `core_rollout_modes` (RolloutMode, domain model §2.4; ADR-0006; data §2.1, §2.4; PLAT-13 plan
 * 2.1): one row per feature key, `off | allowlist | all`, default `allowlist`, written only by a
 * super admin (`platformSetRolloutMode`). A platform table (no `account_id`, no policies): elx_app
 * reads it for the feature gate, elx_platform writes it. The migration seeds one row per key of the
 * registry (`modules/kernel/features/feature-keys.ts`) with `updated_by` NULL (the system).
 */
export const coreRolloutModes = pgTable(
  'core_rollout_modes',
  {
    featureKey: text('feature_key').primaryKey(),
    mode: text('mode', { enum: rolloutModes }).notNull().default('allowlist'),
    updatedBy: uuid('updated_by').references(() => coreUsers.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('core_rollout_modes_mode_check', sql`${table.mode} IN ('off', 'allowlist', 'all')`),
  ],
);

/**
 * `core_feature_flags` (FeatureFlag, domain model §2.4, K-6; data §2.1; PLAT-13 plan 2.1): one row
 * per account and feature key. A feature is visible to an account iff its mode is `all`, or it is
 * `allowlist` and this row is `enabled` with `provisioned_by` set (the CHECK backs the second
 * half). A tenant table with the template policies: elx_app only reads it (the gate), elx_platform
 * writes it (the provisioning door and `platformSetFeatureFlag`). `feature_key` must be a key of
 * `core_rollout_modes`, so no flag exists for an unregistered feature.
 */
export const coreFeatureFlags = pgTable(
  'core_feature_flags',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    featureKey: text('feature_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    provisionedBy: uuid('provisioned_by').references(() => coreUsers.id),
    enabledAt: timestamp('enabled_at', { withTimezone: true }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'core_feature_flags_pkey', columns: [table.accountId, table.featureKey] }),
    // Named here: the generated name would pass PostgreSQL's 63-byte limit and be truncated.
    foreignKey({
      name: 'core_feature_flags_feature_key_fk',
      columns: [table.featureKey],
      foreignColumns: [coreRolloutModes.featureKey],
    }),
    check(
      'core_feature_flags_provisioned_check',
      sql`NOT ${table.enabled} OR ${table.provisionedBy} IS NOT NULL`,
    ),
    check('core_feature_flags_version_check', sql`${table.version} >= 1`),
  ],
);
