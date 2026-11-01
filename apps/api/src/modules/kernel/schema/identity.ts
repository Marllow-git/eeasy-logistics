import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  inet,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { coreAccounts } from './accounts.js';

// Identity tables (PLAT-11 plan 2.1; data §2.1, §2.4, §10; identity and tenancy §1, §3, §4).
// Users-class tables (data §2.4: `core_users`, `core_platform_staff`, `core_refresh_tokens`,
// `core_password_resets`, `core_auth_challenges`) carry no account: a person may belong to several
// accounts or none. They are reached only through the platform pool (elx_app holds no grant).
// `core_memberships` and `core_invitations` are tenant tables with the template policies;
// `core_invitations.account_id` is NULL for a platform invitation (data §2.4 "nullable account").
// Every one-time secret is stored as its SHA-256 (`*_hash bytea`), never readable (data §10).

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const citext = customType<{ data: string; driverData: string }>({ dataType: () => 'citext' });

const e164 = (column: string) => sql.raw(`"${column}" ~ '^\\+[1-9][0-9]{7,14}$'`);

export const userLocales = ['ar', 'en'] as const;
export type UserLocale = (typeof userLocales)[number];

/**
 * `core_users` (User, domain model §2.2; data §2.1): a person. `password_hash` is a PHC Argon2id
 * string (null until an invitation is accepted); `token_version` moves on a password reset and ends
 * every refresh family (identity and tenancy §4); `second_factor_phone` is the enrolled E.164 phone,
 * the only number a second-factor OTP is ever sent to (PLAT-9 adversary M-1).
 */
export const coreUsers = pgTable(
  'core_users',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    email: citext('email'),
    phone: text('phone'),
    locale: text('locale', { enum: userLocales }).notNull().default('ar'),
    passwordHash: text('password_hash'),
    tokenVersion: integer('token_version').notNull().default(1),
    secondFactorEnabled: boolean('second_factor_enabled').notNull().default(false),
    secondFactorPhone: text('second_factor_phone'),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('core_users_email_key')
      .on(table.email)
      .where(sql`${table.email} IS NOT NULL`),
    uniqueIndex('core_users_phone_key')
      .on(table.phone)
      .where(sql`${table.phone} IS NOT NULL`),
    check('core_users_locale_check', sql`${table.locale} IN ('ar', 'en')`),
    check('core_users_phone_check', e164('phone')),
    check('core_users_second_factor_phone_check', e164('second_factor_phone')),
    check(
      'core_users_second_factor_check',
      sql`NOT ${table.secondFactorEnabled} OR ${table.secondFactorPhone} IS NOT NULL`,
    ),
    check('core_users_token_version_check', sql`${table.tokenVersion} >= 1`),
  ],
);

export const platformStaffRoles = ['super_admin', 'admin', 'support'] as const;
export type PlatformStaffRole = (typeof platformStaffRoles)[number];

/**
 * `core_platform_staff` (identity and tenancy §1, §3.3; data §2.1): a user who is platform staff.
 * The TOTP secret is encrypted with the credentials key under `totp_key_id` (data §10);
 * `totp_last_step` is the replay guard (a used code is refused for its window). `granted_by` is
 * null only for the first super admin (the bootstrap command, plan 2.12).
 */
export const corePlatformStaff = pgTable(
  'core_platform_staff',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => coreUsers.id),
    role: text('role', { enum: platformStaffRoles }).notNull(),
    totpSecretCiphertext: bytea('totp_secret_ciphertext'),
    totpKeyId: text('totp_key_id'),
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    grantedBy: uuid('granted_by').references(() => coreUsers.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'core_platform_staff_role_check',
      sql`${table.role} IN ('super_admin', 'admin', 'support')`,
    ),
    check(
      'core_platform_staff_totp_check',
      sql`(${table.totpSecretCiphertext} IS NULL) = (${table.totpKeyId} IS NULL)`,
    ),
  ],
);

export const membershipStatuses = ['invited', 'active', 'revoked'] as const;
export type MembershipStatus = (typeof membershipStatuses)[number];

/**
 * `core_memberships` (Membership, domain model §2.2; identity and tenancy §1, §2): binds a user to
 * one account with a role set and, for site-scoped roles, the sites. A tenant table.
 * `core_memberships_user_idx` is a worker-scan style index for sign-in, which lists a user's
 * memberships across accounts on the platform pool.
 */
export const coreMemberships = pgTable(
  'core_memberships',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => coreAccounts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => coreUsers.id),
    roles: text('roles')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    siteIds: uuid('site_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    status: text('status', { enum: membershipStatuses }).notNull().default('invited'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('core_memberships_account_user_key').on(table.accountId, table.userId),
    index('core_memberships_account_status_idx').on(table.accountId, table.status),
    index('core_memberships_site_ids_idx').using('gin', table.siteIds),
    index('core_memberships_user_idx').on(table.userId),
    check(
      'core_memberships_status_check',
      sql`${table.status} IN ('invited', 'active', 'revoked')`,
    ),
  ],
);

export const invitationKinds = ['staff', 'platform'] as const;
export type InvitationKind = (typeof invitationKinds)[number];

/**
 * `core_invitations` (identity and tenancy §3.1; data §2.1): a one-time token (72 h) that sets the
 * password and activates the membership (`staff`) or the platform staff row (`platform`). A
 * `platform` invitation has no account and no membership, a `staff` one has both (CHECK).
 */
export const coreInvitations = pgTable(
  'core_invitations',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind', { enum: invitationKinds }).notNull(),
    accountId: uuid('account_id').references(() => coreAccounts.id),
    membershipId: uuid('membership_id').references(() => coreMemberships.id),
    platformRole: text('platform_role', { enum: platformStaffRoles }),
    email: citext('email').notNull(),
    name: text('name').notNull(),
    locale: text('locale', { enum: userLocales }).notNull().default('ar'),
    tokenHash: bytea('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    invitedBy: uuid('invited_by').references(() => coreUsers.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('core_invitations_token_hash_key').on(table.tokenHash),
    index('core_invitations_account_membership_idx').on(table.accountId, table.membershipId),
    check('core_invitations_kind_check', sql`${table.kind} IN ('staff', 'platform')`),
    check(
      'core_invitations_platform_role_check',
      sql`${table.platformRole} IN ('super_admin', 'admin', 'support')`,
    ),
    check('core_invitations_locale_check', sql`${table.locale} IN ('ar', 'en')`),
    check(
      'core_invitations_shape_check',
      sql`(${table.kind} = 'staff' AND ${table.accountId} IS NOT NULL AND ${table.membershipId} IS NOT NULL AND ${table.platformRole} IS NULL) OR (${table.kind} = 'platform' AND ${table.accountId} IS NULL AND ${table.membershipId} IS NULL AND ${table.platformRole} IS NOT NULL)`,
    ),
  ],
);

export const sessionSurfaces = ['staff', 'platform', 'driver'] as const;
export type SessionSurface = (typeof sessionSurfaces)[number];

export const revocationReasons = [
  'reuse',
  'logout',
  'password_reset',
  'switch_account',
  'revoked',
] as const;
export type RevocationReason = (typeof revocationReasons)[number];

/**
 * `core_refresh_tokens` (identity and tenancy §4; data §2.1; plan 2.6): one row per refresh token,
 * rotated on every use within a family. `token_version` is the user's at issue; `amr` the methods
 * the session was started with, carried into every access token of the family. A used row keeps
 * its successor encrypted (`successor_ciphertext`, context `core_refresh_tokens:<id>`) for the reuse
 * grace (Q-23) and loses it an hour after use (plan 2.13). `device_id` is DEL-4's.
 */
export const coreRefreshTokens = pgTable(
  'core_refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    surface: text('surface', { enum: sessionSurfaces }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => coreUsers.id),
    membershipId: uuid('membership_id').references(() => coreMemberships.id),
    deviceId: uuid('device_id'),
    familyId: uuid('family_id').notNull(),
    tokenHash: bytea('token_hash').notNull(),
    tokenVersion: integer('token_version').notNull(),
    amr: text('amr')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    userAgentHash: bytea('user_agent_hash'),
    successorCiphertext: bytea('successor_ciphertext'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason', { enum: revocationReasons }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('core_refresh_tokens_token_hash_key').on(table.tokenHash),
    index('core_refresh_tokens_user_idx').on(table.userId),
    index('core_refresh_tokens_family_idx').on(table.familyId),
    check(
      'core_refresh_tokens_surface_check',
      sql`${table.surface} IN ('staff', 'platform', 'driver')`,
    ),
    check(
      'core_refresh_tokens_revoked_reason_check',
      sql`${table.revokedReason} IN ('reuse', 'logout', 'password_reset', 'switch_account', 'revoked')`,
    ),
    check(
      'core_refresh_tokens_membership_check',
      sql`(${table.surface} = 'platform') = (${table.membershipId} IS NULL)`,
    ),
  ],
);

/**
 * `core_password_resets` (identity and tenancy §3.1; data §2.1): a one-time token valid 30 minutes;
 * one live token per user (an earlier one is marked used when a new one is issued).
 */
export const corePasswordResets = pgTable(
  'core_password_resets',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => coreUsers.id),
    tokenHash: bytea('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('core_password_resets_token_hash_key').on(table.tokenHash),
    index('core_password_resets_user_idx').on(table.userId),
  ],
);

export const challengeKinds = [
  'second_factor',
  'totp',
  'selection',
  'enrolment',
  'enrolment_link',
] as const;
export type ChallengeKind = (typeof challengeKinds)[number];

/**
 * `core_auth_challenges` (plan 2.1, 2.7 to 2.9; A-26): the steps between the password and a session:
 * a second-factor or TOTP challenge, an account selection (`membership_ids` pinned), an enrolment or
 * an emailed enrolment link. The client holds `<id>.<secret>`; only the secret's SHA-256 is stored.
 * `amr` records the methods passed so far; `pending_phone` and `pending_secret_ciphertext` (with
 * `pending_key_id`) hold an enrolment until it is confirmed (leg 2).
 */
export const coreAuthChallenges = pgTable(
  'core_auth_challenges',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind', { enum: challengeKinds }).notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => coreUsers.id),
    secretHash: bytea('secret_hash').notNull(),
    amr: text('amr')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    membershipIds: uuid('membership_ids').array(),
    pendingPhone: text('pending_phone'),
    pendingSecretCiphertext: bytea('pending_secret_ciphertext'),
    pendingKeyId: text('pending_key_id'),
    attempts: smallint('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ip: inet('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('core_auth_challenges_secret_hash_key').on(table.secretHash),
    index('core_auth_challenges_user_idx').on(table.userId),
    check(
      'core_auth_challenges_kind_check',
      sql`${table.kind} IN ('second_factor', 'totp', 'selection', 'enrolment', 'enrolment_link')`,
    ),
    check('core_auth_challenges_attempts_check', sql`${table.attempts} >= 0`),
    check('core_auth_challenges_pending_phone_check', e164('pending_phone')),
    check(
      'core_auth_challenges_pending_secret_check',
      sql`(${table.pendingSecretCiphertext} IS NULL) = (${table.pendingKeyId} IS NULL)`,
    ),
  ],
);
