import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase, PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import {
  PlatformRepository,
  getCrossTenantPlatformUnitOfWork,
  getPlatformUnitOfWork,
  withPlatformUnitOfWork,
} from '@eeasy-logistics/db/platform';
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { coreAccounts } from '../schema/accounts.js';
import { delDriverDevices, delDrivers } from '../schema/drivers.js';
import type { DriverStatus } from '../schema/drivers.js';
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

  /** The user with this E.164 phone (`core_users.phone`, never the second-factor phone), or undefined. */
  async findByPhone(phone: string): Promise<UserRow | undefined> {
    const [row] = await this.unscoped()
      .select(userColumns)
      .from(coreUsers)
      .where(eq(coreUsers.phone, phone))
      .limit(1);
    return row;
  }

  /**
   * A person known by phone only (DEL-4 plan 2.2: a driver has no email and no password), unless
   * the phone already has a user (a concurrent creation): `ON CONFLICT` on the partial unique
   * phone index does nothing, and the caller reads the row back by phone.
   */
  async insertByPhone(user: {
    readonly id: string;
    readonly name: string;
    readonly phone: string;
    readonly locale: UserLocale;
  }): Promise<void> {
    await this.unscoped()
      .insert(coreUsers)
      .values(user)
      .onConflictDoNothing({ target: coreUsers.phone, where: sql`${coreUsers.phone} IS NOT NULL` });
  }

  /**
   * `token_version + 1` (DEL-4 plan 2.4: a driver suspended or archived): every refresh family of
   * the user is refused at its next rotation and every sensitive action re-reads it (identity §4).
   */
  async bumpTokenVersion(id: string): Promise<void> {
    await this.unscoped()
      .update(coreUsers)
      .set({ tokenVersion: sql`${coreUsers.tokenVersion} + 1`, updatedAt: sql`now()` })
      .where(eq(coreUsers.id, id));
  }

  /**
   * The users of `ids` (PLAT-12 `listMembers`, `getMember`: the people behind an account's
   * memberships), read only. `q` is matched by the door over what each membership shows
   * (adversary M-2), not here.
   */
  async findByIds(ids: readonly string[]): Promise<UserRow[]> {
    if (ids.length === 0) return [];
    return this.unscoped()
      .select(userColumns)
      .from(coreUsers)
      .where(inArray(coreUsers.id, [...new Set(ids)]));
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

  /** Moves `token_version`: every session of the user ends at its next refresh (PLAT-13 plan 2.9). */
  async endSessions(id: string): Promise<void> {
    await this.unscoped()
      .update(coreUsers)
      .set({ tokenVersion: sql`${coreUsers.tokenVersion} + 1`, updatedAt: sql`now()` })
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

  /**
   * The drivers this E.164 phone may sign in as (DEL-4 plan 2.7): a user not disabled, an `active`
   * membership holding `driver` on an `active` account, and its `active` driver row; the most
   * recently changed driver first. One query whatever the phone, so a stranger costs what a
   * driver does.
   */
  async driversOfPhone(phone: string): Promise<DriverSignInRow[]> {
    return this.unscoped()
      .select({
        userId: coreUsers.id,
        tokenVersion: coreUsers.tokenVersion,
        membershipId: coreMemberships.id,
        accountId: coreMemberships.accountId,
        accountName: coreAccounts.name,
        roles: coreMemberships.roles,
        siteIds: coreMemberships.siteIds,
        driverId: delDrivers.id,
      })
      .from(coreUsers)
      .innerJoin(coreMemberships, eq(coreMemberships.userId, coreUsers.id))
      .innerJoin(coreAccounts, eq(coreAccounts.id, coreMemberships.accountId))
      .innerJoin(
        delDrivers,
        and(
          eq(delDrivers.membershipId, coreMemberships.id),
          eq(delDrivers.accountId, coreMemberships.accountId),
        ),
      )
      .where(
        and(
          eq(coreUsers.phone, phone),
          isNull(coreUsers.disabledAt),
          eq(coreMemberships.status, 'active'),
          sql`'driver' = ANY(${coreMemberships.roles})`,
          eq(coreAccounts.status, 'active'),
          eq(delDrivers.status, 'active'),
        ),
      )
      .orderBy(desc(delDrivers.updatedAt), desc(delDrivers.id));
  }
}

/** A driver a phone may sign in as (DEL-4 plan 2.7). */
export interface DriverSignInRow {
  readonly userId: string;
  readonly tokenVersion: number;
  readonly membershipId: string;
  readonly accountId: string;
  /** The account's name: the choice `account_choice_required` offers (adversary H-2). */
  readonly accountName: string;
  readonly roles: string[];
  readonly siteIds: string[];
  readonly driverId: string;
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
  /**
   * A driver row's driver and device (DEL-4 plan 2.8), read through the device row the refresh row
   * carries; null on the other surfaces. `device` is null when the row names no device that exists.
   */
  readonly driver: {
    readonly status: DriverStatus | null;
    readonly device: { readonly appDeviceId: string; readonly revoked: boolean } | null;
  } | null;
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
        appDeviceId: delDriverDevices.deviceId,
        deviceRevoked: sql<boolean>`${delDriverDevices.revokedAt} IS NOT NULL`,
        driverStatus: delDrivers.status,
      })
      .from(coreRefreshTokens)
      .innerJoin(coreUsers, eq(coreUsers.id, coreRefreshTokens.userId))
      .leftJoin(coreMemberships, eq(coreMemberships.id, coreRefreshTokens.membershipId))
      .leftJoin(coreAccounts, eq(coreAccounts.id, coreMemberships.accountId))
      .leftJoin(corePlatformStaff, eq(corePlatformStaff.userId, coreRefreshTokens.userId))
      // The driver of the device (DEL-4 plan 2.8): the device's account must be the membership's.
      .leftJoin(
        delDriverDevices,
        and(
          eq(delDriverDevices.id, coreRefreshTokens.deviceId),
          eq(delDriverDevices.accountId, coreMemberships.accountId),
        ),
      )
      .leftJoin(
        delDrivers,
        and(
          eq(delDrivers.id, delDriverDevices.driverId),
          eq(delDrivers.membershipId, coreRefreshTokens.membershipId),
        ),
      )
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
      driver:
        row.surface !== 'driver'
          ? null
          : {
              status: row.driverStatus,
              device:
                row.appDeviceId === null
                  ? null
                  : { appDeviceId: row.appDeviceId, revoked: row.deviceRevoked },
            },
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
   * logout without a refresh cookie), or of one driver device of that membership (DEL-4 plan 2.5:
   * `deviceId` is the `del_driver_devices` row id the rows carry); returns the distinct families
   * revoked.
   */
  async revokeAll(
    userId: string,
    reason: RevocationReason,
    scope?: {
      readonly surface: SessionSurface;
      readonly membershipId: string | null;
      readonly deviceId?: string;
    },
  ): Promise<string[]> {
    const conditions = [eq(coreRefreshTokens.userId, userId), isNull(coreRefreshTokens.revokedAt)];
    if (scope !== undefined) {
      conditions.push(eq(coreRefreshTokens.surface, scope.surface));
      conditions.push(
        scope.membershipId === null
          ? isNull(coreRefreshTokens.membershipId)
          : eq(coreRefreshTokens.membershipId, scope.membershipId),
      );
      if (scope.deviceId !== undefined) {
        conditions.push(eq(coreRefreshTokens.deviceId, scope.deviceId));
      }
    }
    const rows = await this.unscoped()
      .update(coreRefreshTokens)
      .set({ revokedAt: sql`now()`, revokedReason: reason, updatedAt: sql`now()` })
      .where(and(...conditions))
      .returning({ familyId: coreRefreshTokens.familyId });
    return [...new Set(rows.map((row) => row.familyId))];
  }

  /**
   * Revokes every live row of `surfaces` whose membership belongs to the account (PLAT-13 plan 2.7:
   * the staff sessions of a suspended account, every session of a closed one); returns the distinct
   * families revoked.
   */
  async revokeAccount(
    accountId: string,
    reason: RevocationReason,
    surfaces: readonly SessionSurface[],
  ): Promise<string[]> {
    const memberships = this.unscoped()
      .select({ id: coreMemberships.id })
      .from(coreMemberships)
      .where(eq(coreMemberships.accountId, accountId));
    const rows = await this.unscoped()
      .update(coreRefreshTokens)
      .set({ revokedAt: sql`now()`, revokedReason: reason, updatedAt: sql`now()` })
      .where(
        and(
          isNull(coreRefreshTokens.revokedAt),
          inArray(coreRefreshTokens.surface, [...surfaces]),
          inArray(coreRefreshTokens.membershipId, memberships),
        ),
      )
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
  /**
   * A reset TOTP (PLAT-13 adversary M-2): no secret, and the replay guard kept as the marker that
   * only the emailed re-enrolment link may enrol again (as a staff reset keeps the phone).
   */
  readonly enrolmentLinkRequired: boolean;
}

const enrolmentLinkRequired = sql<boolean>`(${corePlatformStaff.totpSecretCiphertext} IS NULL AND ${corePlatformStaff.totpLastStep} IS NOT NULL)`;

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
        enrolmentLinkRequired,
      })
      .from(corePlatformStaff)
      .where(eq(corePlatformStaff.userId, userId));
    return row;
  }

  /**
   * The staff row's role and revocation with the user's `token_version`, in one read (a join on the
   * user's primary key): what the permission guard compares with a platform access token
   * (PLAT-13 adversary M-1 and round 2).
   */
  async findCurrent(
    userId: string,
  ): Promise<{ role: PlatformStaffRole; revoked: boolean; tokenVersion: number } | undefined> {
    const [row] = await this.unscoped()
      .select({
        role: corePlatformStaff.role,
        revoked: sql<boolean>`${corePlatformStaff.revokedAt} IS NOT NULL`,
        tokenVersion: coreUsers.tokenVersion,
      })
      .from(corePlatformStaff)
      .innerJoin(coreUsers, eq(coreUsers.id, corePlatformStaff.userId))
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
        enrolmentLinkRequired,
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
   * comes back with its TOTP cleared (enrol again; the emailed invitation link is the possession
   * proof, as the re-enrolment link is after a reset); a live one only takes the role. A role
   * change restoring a revoked row is `restore`, which keeps the TOTP.
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

  /**
   * Restores a revoked row with `role` (`platformSetStaffRoles`, PLAT-13 adversary round 2): only
   * the role and the revocation change; the TOTP stays, so the password alone still meets the
   * `totp` challenge. A lost device is `platformResetStaffTotp` (the emailed re-enrolment link).
   */
  async restore(userId: string, role: PlatformStaffRole, grantedBy: string): Promise<void> {
    await this.unscoped()
      .update(corePlatformStaff)
      .set({ role, grantedBy, revokedAt: null, updatedAt: sql`now()` })
      .where(and(eq(corePlatformStaff.userId, userId), isNotNull(corePlatformStaff.revokedAt)));
  }

  /**
   * Serialises the staff doors' role changes (PLAT-13 plan 2.9), so two super admins demoting each
   * other at once cannot both pass the last-super-admin check (a transaction-scoped advisory lock).
   */
  async lockRoles(): Promise<void> {
    await this.unscoped().execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('elx:platform-staff-roles'))`,
    );
  }

  /** How many staff rows hold `super_admin` and are not revoked. */
  async liveSuperAdmins(): Promise<number> {
    const rows = await this.unscoped()
      .select({ count: sql<number>`count(*)::int` })
      .from(corePlatformStaff)
      .where(and(eq(corePlatformStaff.role, 'super_admin'), isNull(corePlatformStaff.revokedAt)));
    return rows[0]?.count ?? 0;
  }

  /** A live row's new role (plan 2.9), granted by `grantedBy`. */
  async setRole(userId: string, role: PlatformStaffRole, grantedBy: string): Promise<void> {
    await this.unscoped()
      .update(corePlatformStaff)
      .set({ role, grantedBy, updatedAt: sql`now()` })
      .where(and(eq(corePlatformStaff.userId, userId), isNull(corePlatformStaff.revokedAt)));
  }

  /**
   * Revokes the row (`roles: []`, plan 2.9): the role and the TOTP stay; `restore` brings the row
   * back with them, an accepted invitation (`grant`) clears the TOTP and enrols again.
   */
  async revoke(userId: string): Promise<void> {
    await this.unscoped()
      .update(corePlatformStaff)
      .set({ revokedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(corePlatformStaff.userId, userId), isNull(corePlatformStaff.revokedAt)));
  }

  /**
   * Clears the TOTP secret and its key id (plan 2.9, `platformResetStaffTotp`): the next
   * `platformLogin` asks for an enrolment. The replay guard stays (0 when none was kept) as the
   * marker that only the emailed re-enrolment link may enrol again (adversary M-2,
   * `enrolmentLinkRequired`); `enrolTotp` replaces it with the new secret's first step.
   */
  async resetTotp(userId: string): Promise<void> {
    await this.unscoped()
      .update(corePlatformStaff)
      .set({
        totpSecretCiphertext: null,
        totpKeyId: null,
        totpLastStep: sql`coalesce(${corePlatformStaff.totpLastStep}, 0)`,
        updatedAt: sql`now()`,
      })
      .where(eq(corePlatformStaff.userId, userId));
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

  /** Ends every open staff invitation of the account (a closed account, plan 2.7); how many. */
  async expireOpenOfAccount(accountId: string): Promise<number> {
    const rows = await this.unscoped()
      .update(coreInvitations)
      .set({ expiresAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(coreInvitations.accountId, accountId),
          isNull(coreInvitations.acceptedAt),
          sql`${coreInvitations.expiresAt} > now()`,
        ),
      )
      .returning({ id: coreInvitations.id });
    return rows.length;
  }

  /**
   * Ends every open `platform` invitation of an email (PLAT-13 adversary H-1): a new invitation or
   * a role change makes the earlier links stale; how many.
   */
  async expireOpenPlatform(email: string): Promise<number> {
    const rows = await this.unscoped()
      .update(coreInvitations)
      .set({ expiresAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(coreInvitations.kind, 'platform'),
          eq(coreInvitations.email, email),
          isNull(coreInvitations.acceptedAt),
          sql`${coreInvitations.expiresAt} > now()`,
        ),
      )
      .returning({ id: coreInvitations.id });
    return rows.length;
  }

  /** Whether a later `platform` invitation of the same email exists (this one is superseded). */
  async platformSuperseded(id: string, email: string): Promise<boolean> {
    const rows = await this.unscoped().execute<{ found: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM core_invitations later
        WHERE later.kind = 'platform' AND later.email = ${email} AND later.id <> ${id}
          AND later.created_at > (SELECT created_at FROM core_invitations WHERE id = ${id})
      ) AS found`);
    return rows[0]?.found === true;
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

  /**
   * The account's status, read again under `FOR SHARE` (PLAT-13 adversary L-2): a session start
   * re-reads it after its refresh row is written, and a suspension (which locks the row `FOR
   * UPDATE` before revoking the account's families) either committed first and is seen here, or
   * waits for this transaction and then revokes the new family with the others.
   */
  async lockStatus(id: string): Promise<string | undefined> {
    const [row] = await this.unscoped()
      .select({ status: coreAccounts.status })
      .from(coreAccounts)
      .where(eq(coreAccounts.id, id))
      .for('share');
    return row?.status;
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

/**
 * The identity repositories on `uow`: the store's own transaction, or a platform request's (PLAT-13
 * plan 2.2: the provisioning door writes the account and its owner's invitation in one).
 */
export function identityTransactionOf(uow: PlatformUnitOfWork): IdentityTransaction {
  return {
    uow,
    users: new UsersRepository(uow),
    memberships: new MembershipsRepository(uow),
    refreshTokens: new RefreshTokensRepository(uow),
    challenges: new AuthChallengesRepository(uow),
    platformStaff: new PlatformStaffRepository(uow),
    invitations: new InvitationsRepository(uow),
    resets: new PasswordResetsRepository(uow),
    accounts: new InvitingAccounts(uow),
  };
}

/** The identity repositories on the current platform request's transaction (PLAT-13 plan 2.9). */
export function currentIdentity(): IdentityTransaction {
  return identityTransactionOf(getPlatformUnitOfWork());
}

/** One platform transaction per call, with no platform user (the doors are anonymous). */
export function identityStore(db: PlatformDatabase): IdentityStore {
  return {
    run: (fn) => withPlatformUnitOfWork(db, (uow) => fn(identityTransactionOf(uow))),
  };
}

/**
 * The identity repositories on the current cross-tenant door's own transaction (PLAT-13 lead
 * ruling on 8.2 #11): a door never holds a second platform connection. `run` is not a transaction
 * of its own here: what `fn` writes commits or rolls back with the door.
 */
export function doorIdentityStore(): IdentityStore {
  return { run: (fn) => fn(identityTransactionOf(getCrossTenantPlatformUnitOfWork())) };
}

/** The store on the API's platform pool, or null without one (`DATABASE_URL_PLATFORM` unset). */
export function identityStoreOnPool(pool: Pool<PlatformDatabase> | null): IdentityStore | null {
  return pool === null ? null : identityStore(pool.db);
}
