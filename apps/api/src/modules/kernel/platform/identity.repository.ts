import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase, PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { coreAccounts } from '../schema/accounts.js';
import type {
  InvitationKind,
  MembershipStatus,
  PlatformStaffRole,
  RevocationReason,
  SessionSurface,
  UserLocale,
} from '../schema/identity.js';
import {
  coreInvitations,
  coreMemberships,
  corePasswordResets,
  corePlatformStaff,
  coreRefreshTokens,
  coreUsers,
} from '../schema/identity.js';
import { AuthChallengesRepository } from './auth-challenges.repository.js';

// The identity tables on the platform pool (PLAT-11 plan 2.1; data §2.4 class "users"; ADR-0031):
// the sign-in doors are anonymous and a person spans accounts, so every read and write of users,
// memberships, sessions, invitations and resets runs in one platform unit of work per step, with
// explicit predicates. No account comes from a request: memberships are found by user, and the
// account of a session is its membership's.

export interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly locale: UserLocale;
  readonly passwordHash: string | null;
  readonly tokenVersion: number;
  readonly secondFactorEnabled: boolean;
  readonly secondFactorPhone: string | null;
  readonly disabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const userColumns = {
  id: coreUsers.id,
  name: coreUsers.name,
  email: coreUsers.email,
  phone: coreUsers.phone,
  locale: coreUsers.locale,
  passwordHash: coreUsers.passwordHash,
  tokenVersion: coreUsers.tokenVersion,
  secondFactorEnabled: coreUsers.secondFactorEnabled,
  secondFactorPhone: coreUsers.secondFactorPhone,
  disabled: sql<boolean>`${coreUsers.disabledAt} IS NOT NULL`,
  createdAt: coreUsers.createdAt,
  updatedAt: coreUsers.updatedAt,
};

export class UsersRepository extends PlatformRepository<typeof coreUsers> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreUsers);
  }

  /** The user with this email (case-insensitive: `citext`), or undefined. */
  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.unscoped()
      .select(userColumns)
      .from(coreUsers)
      .where(eq(coreUsers.email, email))
      .limit(1);
    return row;
  }

  async find(id: string): Promise<UserRow | undefined> {
    const [row] = await this.unscoped()
      .select(userColumns)
      .from(coreUsers)
      .where(eq(coreUsers.id, id))
      .limit(1);
    return row;
  }

  /** The user locked `FOR UPDATE` (password and version changes). */
  async lock(id: string): Promise<UserRow | undefined> {
    const [row] = await this.unscoped()
      .select(userColumns)
      .from(coreUsers)
      .where(eq(coreUsers.id, id))
      .for('update');
    return row;
  }

  async insert(user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly locale: UserLocale;
  }): Promise<void> {
    await this.unscoped().insert(coreUsers).values(user);
  }

  /**
   * Sets the password (and the name, at an invitation). `endSessions` moves `token_version`, which
   * refuses every refresh issued before (identity and tenancy §4); returns the new version.
   */
  async setPassword(
    id: string,
    passwordHash: string,
    options: {
      readonly name?: string;
      readonly locale?: UserLocale | undefined;
      readonly endSessions: boolean;
    },
  ): Promise<number> {
    const [row] = await this.unscoped()
      .update(coreUsers)
      .set({
        passwordHash,
        ...(options.name === undefined ? {} : { name: options.name }),
        ...(options.locale === undefined ? {} : { locale: options.locale }),
        ...(options.endSessions ? { tokenVersion: sql`${coreUsers.tokenVersion} + 1` } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(coreUsers.id, id))
      .returning({ tokenVersion: coreUsers.tokenVersion });
    if (row === undefined) throw new Error('No such user');
    return row.tokenVersion;
  }

  /** A confirmed phone second factor (plan 2.8): enabled, on this E.164 phone. */
  async enableSecondFactor(id: string, phone: string): Promise<void> {
    await this.unscoped()
      .update(coreUsers)
      .set({ secondFactorEnabled: true, secondFactorPhone: phone, updatedAt: sql`now()` })
      .where(eq(coreUsers.id, id));
  }

  /**
   * A second-factor reset (plan 2.8, staff.yaml `resetMemberSecondFactor`): the factor stops being
   * asked for, its phone stays as the marker that only an emailed link may enrol again (the password
   * alone answers `409 second_factor_already_enrolled`), and `token_version` moves so every session
   * ends at its next refresh or sensitive action.
   */
  async resetSecondFactor(id: string): Promise<void> {
    await this.unscoped()
      .update(coreUsers)
      .set({
        secondFactorEnabled: false,
        tokenVersion: sql`${coreUsers.tokenVersion} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(coreUsers.id, id));
  }

  /** A sign-in: `last_login_at`, and a hash made with today's parameters when the old one is not. */
  async signedIn(id: string, rehash?: string): Promise<void> {
    await this.unscoped()
      .update(coreUsers)
      .set({
        lastLoginAt: sql`now()`,
        updatedAt: sql`now()`,
        ...(rehash === undefined ? {} : { passwordHash: rehash }),
      })
      .where(eq(coreUsers.id, id));
  }
}

/** A membership with what sign-in needs of its account. */
export interface MembershipRow {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly roles: readonly string[];
  readonly siteIds: readonly string[];
  readonly status: MembershipStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly account: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly secondFactorRequired: boolean;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  };
}

const membershipColumns = {
  id: coreMemberships.id,
  userId: coreMemberships.userId,
  accountId: coreMemberships.accountId,
  roles: coreMemberships.roles,
  siteIds: coreMemberships.siteIds,
  status: coreMemberships.status,
  createdAt: coreMemberships.createdAt,
  updatedAt: coreMemberships.updatedAt,
  accountName: coreAccounts.name,
  accountStatus: coreAccounts.status,
  secondFactorRequired: sql<boolean>`coalesce((${coreAccounts.settings} ->> 'second_factor_required')::boolean, false)`,
  accountCreatedAt: coreAccounts.createdAt,
  accountUpdatedAt: coreAccounts.updatedAt,
};

interface MembershipSelect {
  readonly id: string;
  readonly userId: string;
  readonly accountId: string;
  readonly roles: string[];
  readonly siteIds: string[];
  readonly status: MembershipStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly accountName: string;
  readonly accountStatus: string;
  readonly secondFactorRequired: boolean;
  readonly accountCreatedAt: Date;
  readonly accountUpdatedAt: Date;
}

function membershipRow(row: MembershipSelect): MembershipRow {
  return {
    id: row.id,
    userId: row.userId,
    accountId: row.accountId,
    roles: row.roles,
    siteIds: row.siteIds,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    account: {
      id: row.accountId,
      name: row.accountName,
      status: row.accountStatus,
      secondFactorRequired: row.secondFactorRequired,
      createdAt: row.accountCreatedAt,
      updatedAt: row.accountUpdatedAt,
    },
  };
}

/** Account states whose members may sign in (identity and tenancy §6: suspended and closed may not). */
export const signInAccountStatuses = ['provisioned', 'active'] as const;

export class MembershipsRepository extends PlatformRepository<typeof coreMemberships> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreMemberships);
  }

  /** The user's active memberships on accounts that are neither suspended nor closed, oldest first. */
  async signInMemberships(userId: string): Promise<MembershipRow[]> {
    const rows = await this.unscoped()
      .select(membershipColumns)
      .from(coreMemberships)
      .innerJoin(coreAccounts, eq(coreAccounts.id, coreMemberships.accountId))
      .where(
        and(
          eq(coreMemberships.userId, userId),
          eq(coreMemberships.status, 'active'),
          inArray(coreAccounts.status, [...signInAccountStatuses]),
        ),
      )
      .orderBy(asc(coreMemberships.createdAt), asc(coreMemberships.id));
    return rows.map(membershipRow);
  }

  /** The membership with this id, whatever its state, or undefined. */
  async find(id: string): Promise<MembershipRow | undefined> {
    const [row] = await this.unscoped()
      .select(membershipColumns)
      .from(coreMemberships)
      .innerJoin(coreAccounts, eq(coreAccounts.id, coreMemberships.accountId))
      .where(eq(coreMemberships.id, id));
    return row === undefined ? undefined : membershipRow(row);
  }

  /** The membership of this user with this id, whatever its state, or undefined. */
  async findOfUser(id: string, userId: string): Promise<MembershipRow | undefined> {
    const [row] = await this.unscoped()
      .select(membershipColumns)
      .from(coreMemberships)
      .innerJoin(coreAccounts, eq(coreAccounts.id, coreMemberships.accountId))
      .where(and(eq(coreMemberships.id, id), eq(coreMemberships.userId, userId)));
    return row === undefined ? undefined : membershipRow(row);
  }

  /** The membership of the user in the account, or undefined. */
  async findInAccount(
    accountId: string,
    userId: string,
  ): Promise<{ id: string; status: MembershipStatus; roles: string[] } | undefined> {
    const [row] = await this.unscoped()
      .select({
        id: coreMemberships.id,
        status: coreMemberships.status,
        roles: coreMemberships.roles,
      })
      .from(coreMemberships)
      .where(and(eq(coreMemberships.accountId, accountId), eq(coreMemberships.userId, userId)))
      .for('update');
    return row;
  }

  async insert(membership: {
    readonly id: string;
    readonly accountId: string;
    readonly userId: string;
    readonly roles: readonly string[];
    readonly siteIds: readonly string[];
  }): Promise<void> {
    await this.unscoped()
      .insert(coreMemberships)
      .values({
        ...membership,
        roles: [...membership.roles],
        siteIds: [...membership.siteIds],
        status: 'invited',
      });
  }

  /** A re-invitation of an `invited` or `revoked` membership: new roles and sites, `invited`. */
  async reinvite(id: string, roles: readonly string[], siteIds: readonly string[]): Promise<void> {
    await this.unscoped()
      .update(coreMemberships)
      .set({ roles: [...roles], siteIds: [...siteIds], status: 'invited', updatedAt: sql`now()` })
      .where(eq(coreMemberships.id, id));
  }

  async activate(id: string): Promise<void> {
    await this.unscoped()
      .update(coreMemberships)
      .set({ status: 'active', updatedAt: sql`now()` })
      .where(eq(coreMemberships.id, id));
  }
}

/** A refresh row as the rotation reads it, with the subject's state, on the database clock. */
export interface RefreshState {
  readonly id: string;
  readonly surface: SessionSurface;
  readonly userId: string;
  readonly membershipId: string | null;
  readonly deviceId: string | null;
  readonly familyId: string;
  readonly tokenVersion: number;
  readonly amr: readonly string[];
  readonly userAgentHash: Buffer | null;
  readonly successorCiphertext: Buffer | null;
  readonly expiresAt: Date;
  readonly usedAt: Date | null;
  readonly revoked: boolean;
  readonly now: Date;
  readonly user: { readonly tokenVersion: number; readonly disabled: boolean };
  /** Null on the platform surface. */
  readonly membership: {
    readonly status: MembershipStatus;
    readonly accountId: string;
    readonly accountStatus: string;
    readonly roles: readonly string[];
    readonly siteIds: readonly string[];
  } | null;
  /** Null unless the user is platform staff. */
  readonly platformStaff: { readonly role: PlatformStaffRole; readonly revoked: boolean } | null;
}

export interface NewRefreshToken {
  readonly id: string;
  readonly surface: SessionSurface;
  readonly userId: string;
  readonly membershipId: string | null;
  readonly deviceId: string | null;
  readonly familyId: string;
  readonly tokenHash: Buffer;
  readonly tokenVersion: number;
  readonly amr: readonly string[];
  readonly userAgentHash: Buffer | null;
  /** Either seconds from now (a new family, a sliding rotation) or a fixed instant. */
  readonly expires: { readonly inSeconds: number } | { readonly at: Date };
}

export class RefreshTokensRepository extends PlatformRepository<typeof coreRefreshTokens> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreRefreshTokens);
  }

  /** Inserts a row; returns its `expires_at` and the seconds left (for the cookie's Max-Age). */
  async insert(token: NewRefreshToken): Promise<{ expiresAt: Date; ttlSeconds: number }> {
    const expiresAt =
      'inSeconds' in token.expires
        ? sql`now() + make_interval(secs => ${token.expires.inSeconds})`
        : sql`${token.expires.at.toISOString()}::timestamptz`;
    const [row] = await this.unscoped()
      .insert(coreRefreshTokens)
      .values({
        id: token.id,
        surface: token.surface,
        userId: token.userId,
        membershipId: token.membershipId,
        deviceId: token.deviceId,
        familyId: token.familyId,
        tokenHash: token.tokenHash,
        tokenVersion: token.tokenVersion,
        amr: [...token.amr],
        userAgentHash: token.userAgentHash,
        expiresAt,
      })
      .returning({
        expiresAt: coreRefreshTokens.expiresAt,
        ttlSeconds: sql<number>`greatest(0, floor(extract(epoch from (${coreRefreshTokens.expiresAt} - now()))))::int`,
      });
    if (row === undefined) throw new Error('The refresh token was not inserted');
    return row;
  }

  /** The row of this token hash with its subject's state, locked `FOR UPDATE`, or undefined. */
  async lockByHash(tokenHash: Buffer): Promise<RefreshState | undefined> {
    const [row] = await this.unscoped()
      .select({
        id: coreRefreshTokens.id,
        surface: coreRefreshTokens.surface,
        userId: coreRefreshTokens.userId,
        membershipId: coreRefreshTokens.membershipId,
        deviceId: coreRefreshTokens.deviceId,
        familyId: coreRefreshTokens.familyId,
        tokenVersion: coreRefreshTokens.tokenVersion,
        amr: coreRefreshTokens.amr,
        userAgentHash: coreRefreshTokens.userAgentHash,
        successorCiphertext: coreRefreshTokens.successorCiphertext,
        expiresAt: coreRefreshTokens.expiresAt,
        usedAt: coreRefreshTokens.usedAt,
        revoked: sql<boolean>`${coreRefreshTokens.revokedAt} IS NOT NULL`,
        now: sql<Date>`now()`.mapWith(coreRefreshTokens.expiresAt),
        userTokenVersion: coreUsers.tokenVersion,
        userDisabled: sql<boolean>`${coreUsers.disabledAt} IS NOT NULL`,
        membershipStatus: coreMemberships.status,
        membershipAccountId: coreMemberships.accountId,
        membershipRoles: coreMemberships.roles,
        membershipSiteIds: coreMemberships.siteIds,
        accountStatus: coreAccounts.status,
        staffRole: corePlatformStaff.role,
        staffRevoked: sql<boolean>`${corePlatformStaff.revokedAt} IS NOT NULL`,
      })
      .from(coreRefreshTokens)
      .innerJoin(coreUsers, eq(coreUsers.id, coreRefreshTokens.userId))
      .leftJoin(coreMemberships, eq(coreMemberships.id, coreRefreshTokens.membershipId))
      .leftJoin(coreAccounts, eq(coreAccounts.id, coreMemberships.accountId))
      .leftJoin(corePlatformStaff, eq(corePlatformStaff.userId, coreRefreshTokens.userId))
      .where(eq(coreRefreshTokens.tokenHash, tokenHash))
      .for('update', { of: coreRefreshTokens });
    if (row === undefined) return undefined;
    return {
      id: row.id,
      surface: row.surface,
      userId: row.userId,
      membershipId: row.membershipId,
      deviceId: row.deviceId,
      familyId: row.familyId,
      tokenVersion: row.tokenVersion,
      amr: row.amr,
      userAgentHash: row.userAgentHash,
      successorCiphertext: row.successorCiphertext,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      revoked: row.revoked,
      now: row.now,
      user: { tokenVersion: row.userTokenVersion, disabled: row.userDisabled },
      membership:
        row.membershipStatus === null ||
        row.membershipAccountId === null ||
        row.membershipRoles === null ||
        row.membershipSiteIds === null ||
        row.accountStatus === null
          ? null
          : {
              status: row.membershipStatus,
              accountId: row.membershipAccountId,
              accountStatus: row.accountStatus,
              roles: row.membershipRoles,
              siteIds: row.membershipSiteIds,
            },
      platformStaff:
        row.staffRole === null ? null : { role: row.staffRole, revoked: row.staffRevoked },
    };
  }

  /** The row has been rotated: `used_at`, and its successor encrypted for the reuse grace. */
  async markUsed(id: string, successorCiphertext: Buffer | null): Promise<void> {
    await this.unscoped()
      .update(coreRefreshTokens)
      .set({ usedAt: sql`now()`, successorCiphertext, updatedAt: sql`now()` })
      .where(eq(coreRefreshTokens.id, id));
  }

  /** Revokes every live row of the family; returns how many. */
  async revokeFamily(familyId: string, reason: RevocationReason): Promise<number> {
    const rows = await this.unscoped()
      .update(coreRefreshTokens)
      .set({ revokedAt: sql`now()`, revokedReason: reason, updatedAt: sql`now()` })
      .where(and(eq(coreRefreshTokens.familyId, familyId), isNull(coreRefreshTokens.revokedAt)))
      .returning({ id: coreRefreshTokens.id });
    return rows.length;
  }

  /**
   * Revokes every live row of the user (a password reset), or of one surface and membership (a
   * logout without a refresh cookie); returns the distinct families revoked.
   */
  async revokeAll(
    userId: string,
    reason: RevocationReason,
    scope?: { readonly surface: SessionSurface; readonly membershipId: string | null },
  ): Promise<string[]> {
    const conditions = [eq(coreRefreshTokens.userId, userId), isNull(coreRefreshTokens.revokedAt)];
    if (scope !== undefined) {
      conditions.push(eq(coreRefreshTokens.surface, scope.surface));
      conditions.push(
        scope.membershipId === null
          ? isNull(coreRefreshTokens.membershipId)
          : eq(coreRefreshTokens.membershipId, scope.membershipId),
      );
    }
    const rows = await this.unscoped()
      .update(coreRefreshTokens)
      .set({ revokedAt: sql`now()`, revokedReason: reason, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning({ familyId: coreRefreshTokens.familyId });
    return [...new Set(rows.map((row) => row.familyId))];
  }

  /** The family and user of a token hash, unlocked, or undefined (logout). */
  async familyOf(tokenHash: Buffer): Promise<{ familyId: string; userId: string } | undefined> {
    const [row] = await this.unscoped()
      .select({ familyId: coreRefreshTokens.familyId, userId: coreRefreshTokens.userId })
      .from(coreRefreshTokens)
      .where(eq(coreRefreshTokens.tokenHash, tokenHash));
    return row;
  }
}

export interface PlatformStaffRow {
  readonly userId: string;
  readonly role: PlatformStaffRole;
  readonly totpEnrolled: boolean;
  readonly revoked: boolean;
}

export class PlatformStaffRepository extends PlatformRepository<typeof corePlatformStaff> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, corePlatformStaff);
  }

  async find(userId: string): Promise<PlatformStaffRow | undefined> {
    const [row] = await this.unscoped()
      .select({
        userId: corePlatformStaff.userId,
        role: corePlatformStaff.role,
        totpEnrolled: sql<boolean>`${corePlatformStaff.totpSecretCiphertext} IS NOT NULL`,
        revoked: sql<boolean>`${corePlatformStaff.revokedAt} IS NOT NULL`,
      })
      .from(corePlatformStaff)
      .where(eq(corePlatformStaff.userId, userId));
    return row;
  }

  /** The staff row with its TOTP secret and replay guard, locked `FOR UPDATE` (plan 2.9). */
  async lockTotp(userId: string): Promise<PlatformStaffTotp | undefined> {
    const [row] = await this.unscoped()
      .select({
        userId: corePlatformStaff.userId,
        role: corePlatformStaff.role,
        totpEnrolled: sql<boolean>`${corePlatformStaff.totpSecretCiphertext} IS NOT NULL`,
        revoked: sql<boolean>`${corePlatformStaff.revokedAt} IS NOT NULL`,
        secretCiphertext: corePlatformStaff.totpSecretCiphertext,
        lastStep: corePlatformStaff.totpLastStep,
      })
      .from(corePlatformStaff)
      .where(eq(corePlatformStaff.userId, userId))
      .for('update');
    return row;
  }

  /** The step of the last accepted code (the replay guard, RFC 6238 §5.2). */
  async acceptedStep(userId: string, step: number): Promise<void> {
    await this.unscoped()
      .update(corePlatformStaff)
      .set({ totpLastStep: step, updatedAt: sql`now()` })
      .where(eq(corePlatformStaff.userId, userId));
  }

  /** A confirmed TOTP secret, encrypted under `core_platform_staff:<user_id>`, and its first step. */
  async enrolTotp(userId: string, ciphertext: Buffer, keyId: string, step: number): Promise<void> {
    await this.unscoped()
      .update(corePlatformStaff)
      .set({
        totpSecretCiphertext: ciphertext,
        totpKeyId: keyId,
        totpLastStep: step,
        updatedAt: sql`now()`,
      })
      .where(eq(corePlatformStaff.userId, userId));
  }

  /**
   * An accepted platform invitation (plan 2.10): the staff row with the invited role. A revoked row
   * comes back with its TOTP cleared (enrol again); a live one only takes the role.
   */
  async grant(userId: string, role: PlatformStaffRole, grantedBy: string | null): Promise<void> {
    await this.unscoped()
      .insert(corePlatformStaff)
      .values({ userId, role, grantedBy })
      .onConflictDoUpdate({
        target: corePlatformStaff.userId,
        set: {
          role,
          grantedBy,
          totpSecretCiphertext: sql`CASE WHEN ${corePlatformStaff.revokedAt} IS NULL THEN ${corePlatformStaff.totpSecretCiphertext} END`,
          totpKeyId: sql`CASE WHEN ${corePlatformStaff.revokedAt} IS NULL THEN ${corePlatformStaff.totpKeyId} END`,
          totpLastStep: sql`CASE WHEN ${corePlatformStaff.revokedAt} IS NULL THEN ${corePlatformStaff.totpLastStep} END`,
          revokedAt: null,
          updatedAt: sql`now()`,
        },
      });
  }

  /** Serialises bootstrap runs (a transaction-scoped advisory lock). */
  async lockBootstrap(): Promise<void> {
    await this.unscoped().execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('elx:platform-bootstrap'))`,
    );
  }

  /** Whether any platform staff row exists, or a live super admin invitation (the bootstrap, 2.12). */
  async bootstrapped(): Promise<boolean> {
    const rows = await this.unscoped().execute<{ found: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM core_platform_staff)
          OR EXISTS (SELECT 1 FROM core_invitations
                     WHERE kind = 'platform' AND platform_role = 'super_admin'
                       AND accepted_at IS NULL AND expires_at > now()) AS found`);
    return rows[0]?.found === true;
  }
}

/** A staff row as the TOTP doors need it. */
export interface PlatformStaffTotp extends PlatformStaffRow {
  readonly secretCiphertext: Buffer | null;
  readonly lastStep: number | null;
}

export interface InvitationRow {
  readonly id: string;
  readonly kind: InvitationKind;
  readonly accountId: string | null;
  readonly membershipId: string | null;
  readonly platformRole: PlatformStaffRole | null;
  readonly email: string;
  readonly name: string;
  readonly locale: UserLocale;
  readonly accepted: boolean;
  readonly expired: boolean;
  readonly invitedBy: string | null;
}

export class InvitationsRepository extends PlatformRepository<typeof coreInvitations> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreInvitations);
  }

  async insert(invitation: {
    readonly id: string;
    readonly kind: InvitationKind;
    readonly accountId: string | null;
    readonly membershipId: string | null;
    readonly platformRole: PlatformStaffRole | null;
    readonly email: string;
    readonly name: string;
    readonly locale: UserLocale;
    readonly tokenHash: Buffer;
    readonly ttlSeconds: number;
    readonly invitedBy: string | null;
  }): Promise<void> {
    const { ttlSeconds, ...values } = invitation;
    await this.unscoped()
      .insert(coreInvitations)
      .values({ ...values, expiresAt: sql`now() + make_interval(secs => ${ttlSeconds})` });
  }

  /** The invitation of `kind` with this token hash, locked `FOR UPDATE`, or undefined. */
  async lockByHash(tokenHash: Buffer, kind: InvitationKind): Promise<InvitationRow | undefined> {
    const [row] = await this.unscoped()
      .select({
        id: coreInvitations.id,
        kind: coreInvitations.kind,
        accountId: coreInvitations.accountId,
        membershipId: coreInvitations.membershipId,
        platformRole: coreInvitations.platformRole,
        email: coreInvitations.email,
        name: coreInvitations.name,
        locale: coreInvitations.locale,
        accepted: sql<boolean>`${coreInvitations.acceptedAt} IS NOT NULL`,
        expired: sql<boolean>`${coreInvitations.expiresAt} <= now()`,
        invitedBy: coreInvitations.invitedBy,
      })
      .from(coreInvitations)
      .where(and(eq(coreInvitations.tokenHash, tokenHash), eq(coreInvitations.kind, kind)))
      .for('update');
    return row;
  }

  async accept(id: string): Promise<void> {
    await this.unscoped()
      .update(coreInvitations)
      .set({ acceptedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(coreInvitations.id, id));
  }

  /** Ends the open invitations of a membership (a new one replaces them). */
  async expireOpenOf(membershipId: string): Promise<void> {
    await this.unscoped()
      .update(coreInvitations)
      .set({ expiresAt: sql`least(${coreInvitations.expiresAt}, now())`, updatedAt: sql`now()` })
      .where(
        and(eq(coreInvitations.membershipId, membershipId), isNull(coreInvitations.acceptedAt)),
      );
  }
}

export class PasswordResetsRepository extends PlatformRepository<typeof corePasswordResets> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, corePasswordResets);
  }

  /** Marks the user's earlier unused tokens used (one live token per user), then inserts one. */
  async replace(reset: {
    readonly id: string;
    readonly userId: string;
    readonly tokenHash: Buffer;
    readonly ttlSeconds: number;
  }): Promise<void> {
    await this.unscoped()
      .update(corePasswordResets)
      .set({ usedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(corePasswordResets.userId, reset.userId), isNull(corePasswordResets.usedAt)));
    await this.unscoped()
      .insert(corePasswordResets)
      .values({
        id: reset.id,
        userId: reset.userId,
        tokenHash: reset.tokenHash,
        expiresAt: sql`now() + make_interval(secs => ${reset.ttlSeconds})`,
      });
  }

  async lockByHash(
    tokenHash: Buffer,
  ): Promise<{ id: string; userId: string; used: boolean; expired: boolean } | undefined> {
    const [row] = await this.unscoped()
      .select({
        id: corePasswordResets.id,
        userId: corePasswordResets.userId,
        used: sql<boolean>`${corePasswordResets.usedAt} IS NOT NULL`,
        expired: sql<boolean>`${corePasswordResets.expiresAt} <= now()`,
      })
      .from(corePasswordResets)
      .where(eq(corePasswordResets.tokenHash, tokenHash))
      .for('update');
    return row;
  }

  async use(id: string): Promise<void> {
    await this.unscoped()
      .update(corePasswordResets)
      .set({ usedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(corePasswordResets.id, id));
  }
}

/** What an invitation needs of its account: the name for the mail and the status. */
export class InvitingAccounts extends PlatformRepository<typeof coreAccounts> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreAccounts);
  }

  async find(id: string): Promise<{ id: string; name: string; status: string } | undefined> {
    const [row] = await this.unscoped()
      .select({ id: coreAccounts.id, name: coreAccounts.name, status: coreAccounts.status })
      .from(coreAccounts)
      .where(eq(coreAccounts.id, id));
    return row;
  }
}

/** What one auth purge removed (plan 2.13). */
export interface AuthPurgeCounts {
  readonly successorsCleared: number;
  readonly refreshTokens: number;
  readonly invitations: number;
  readonly passwordResets: number;
  readonly challenges: number;
}

/**
 * The retention of the identity tables (plan 2.13; data §10): refresh, invitation, reset and
 * challenge rows are deleted 7 days after the latest of their expiry, use, acceptance, consumption
 * or revocation; a kept successor (the reuse grace's ciphertext) is cleared an hour after the use.
 */
export class IdentityPurgeRepository extends PlatformRepository<typeof coreRefreshTokens> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreRefreshTokens);
  }

  async purge(): Promise<AuthPurgeCounts> {
    const db = this.unscoped();
    const successors = await db.execute(sql`
      UPDATE core_refresh_tokens SET successor_ciphertext = NULL, updated_at = now()
      WHERE successor_ciphertext IS NOT NULL AND used_at < now() - interval '1 hour'
      RETURNING id`);
    const refreshTokens = await db.execute(sql`
      DELETE FROM core_refresh_tokens
      WHERE greatest(expires_at, used_at, revoked_at) < now() - interval '7 days'
      RETURNING id`);
    const invitations = await db.execute(sql`
      DELETE FROM core_invitations
      WHERE greatest(expires_at, accepted_at) < now() - interval '7 days'
      RETURNING id`);
    const passwordResets = await db.execute(sql`
      DELETE FROM core_password_resets
      WHERE greatest(expires_at, used_at) < now() - interval '7 days'
      RETURNING id`);
    const challenges = await db.execute(sql`
      DELETE FROM core_auth_challenges
      WHERE greatest(expires_at, consumed_at) < now() - interval '7 days'
      RETURNING id`);
    return {
      successorsCleared: successors.length,
      refreshTokens: refreshTokens.length,
      invitations: invitations.length,
      passwordResets: passwordResets.length,
      challenges: challenges.length,
    };
  }
}

/** A sign-in step's transaction: every identity repository on one platform unit of work. */
export interface IdentityTransaction {
  readonly uow: PlatformUnitOfWork;
  readonly users: UsersRepository;
  readonly memberships: MembershipsRepository;
  readonly refreshTokens: RefreshTokensRepository;
  readonly challenges: AuthChallengesRepository;
  readonly platformStaff: PlatformStaffRepository;
  readonly invitations: InvitationsRepository;
  readonly resets: PasswordResetsRepository;
  readonly accounts: InvitingAccounts;
}

export interface IdentityStore {
  run<T>(fn: (tx: IdentityTransaction) => Promise<T>): Promise<T>;
}

/** One platform transaction per call, with no platform user (the doors are anonymous). */
export function identityStore(db: PlatformDatabase): IdentityStore {
  return {
    run: (fn) =>
      withPlatformUnitOfWork(db, (uow) =>
        fn({
          uow,
          users: new UsersRepository(uow),
          memberships: new MembershipsRepository(uow),
          refreshTokens: new RefreshTokensRepository(uow),
          challenges: new AuthChallengesRepository(uow),
          platformStaff: new PlatformStaffRepository(uow),
          invitations: new InvitationsRepository(uow),
          resets: new PasswordResetsRepository(uow),
          accounts: new InvitingAccounts(uow),
        }),
      ),
  };
}

/** The store on the API's platform pool, or null without one (`DATABASE_URL_PLATFORM` unset). */
export function identityStoreOnPool(pool: Pool<PlatformDatabase> | null): IdentityStore | null {
  return pool === null ? null : identityStore(pool.db);
}
