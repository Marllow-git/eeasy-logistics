import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository } from '@eeasy-logistics/db/platform';
import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository, uuidv7 } from '@eeasy-logistics/db';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { coreAccounts } from '../modules/kernel/schema/accounts.js';
import { coreSites } from '../modules/kernel/schema/sites.js';
import {
  coreMemberships,
  corePlatformStaff,
  coreUsers,
} from '../modules/kernel/schema/identity.js';
import { coreOtpChallenges } from '../modules/kernel/schema/otp-challenges.js';
import { coreOutbox } from '../modules/kernel/schema/outbox.js';
import type { CensusAccountKey, CensusAccountStatus, CensusSite, CensusUser } from './census.js';

/**
 * Puts the census identities back to their starting state (seed tool only; local and ci; WEB-2
 * plan 2.14). Upserts by the deterministic ids of `census.ts`, so a run never duplicates a row.
 */
export class CensusIdentitiesRepository extends PlatformRepository<typeof coreUsers> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreUsers);
  }

  /** Each account with its starting status (`active` by default; WEB-4's suspended and provisioned), never closed. */
  async putAccounts(
    accounts: readonly {
      id: string;
      name: string;
      factor: boolean;
      status?: CensusAccountStatus;
    }[],
  ): Promise<void> {
    for (const account of accounts) {
      const settings = account.factor ? { second_factor_required: true } : {};
      const status = account.status ?? 'active';
      await this.unscoped()
        .insert(coreAccounts)
        .values({ id: account.id, name: account.name, status, settings })
        .onConflictDoUpdate({
          target: coreAccounts.id,
          set: { name: account.name, status, closedAt: null, settings, updatedAt: sql`now()` },
        });
    }
  }

  /** The user with the census password, its factor as `user.phone` says, its memberships active. */
  async putUser(
    user: CensusUser,
    passwordHash: string,
    accounts: Record<CensusAccountKey, { id: string }>,
  ): Promise<void> {
    const values = {
      name: user.name,
      email: user.email,
      locale: user.locale,
      passwordHash,
      secondFactorEnabled: user.phone !== null,
      secondFactorPhone: user.phone,
      disabledAt: null,
    };
    await this.unscoped()
      .insert(coreUsers)
      .values({ id: user.id, ...values })
      .onConflictDoUpdate({
        target: coreUsers.id,
        // A new token version ends the sessions of the last run.
        set: { ...values, tokenVersion: sql`${coreUsers.tokenVersion} + 1`, updatedAt: sql`now()` },
      });
    for (const membership of user.memberships) {
      const accountId = accounts[membership.account].id;
      await this.unscoped()
        .insert(coreMemberships)
        .values({
          id: uuidv7(),
          accountId,
          userId: user.id,
          roles: [...membership.roles],
          status: 'active',
        })
        .onConflictDoUpdate({
          target: [coreMemberships.accountId, coreMemberships.userId],
          set: { roles: [...membership.roles], status: 'active', updatedAt: sql`now()` },
        });
    }
  }

  /** Revokes the invitees' memberships of the last run, so the invitation can be sent again. */
  async revokeInvitees(emails: readonly string[], accountId: string): Promise<void> {
    const users = await this.unscoped()
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(inArray(coreUsers.email, [...emails]));
    if (users.length === 0) return;
    await this.unscoped()
      .update(coreMemberships)
      .set({ status: 'revoked', updatedAt: sql`now()` })
      .where(
        and(
          eq(coreMemberships.accountId, accountId),
          inArray(
            coreMemberships.userId,
            users.map((user) => user.id),
          ),
        ),
      );
  }

  /** Deletes the OTP challenges of the census phones: no cooldown is left from the last run. */
  async forgetPhones(phones: readonly string[]): Promise<void> {
    await this.unscoped()
      .delete(coreOtpChallenges)
      .where(inArray(coreOtpChallenges.phone, [...phones]));
  }

  /**
   * A console super admin with the census password, a live staff row, and the TOTP secret sealed
   * for it (or none: enrolment at sign-in); the replay guard starts over.
   */
  async putPlatformStaff(
    admin: { id: string; email: string; name: string; role: 'super_admin' | 'admin' | 'support' },
    passwordHash: string,
    sealed: { blob: Buffer; keyId: string } | null,
  ): Promise<void> {
    const values = {
      name: admin.name,
      email: admin.email,
      locale: 'en' as const,
      passwordHash,
      secondFactorEnabled: false,
      secondFactorPhone: null,
      disabledAt: null,
    };
    await this.unscoped()
      .insert(coreUsers)
      .values({ id: admin.id, ...values })
      .onConflictDoUpdate({
        target: coreUsers.id,
        set: { ...values, tokenVersion: sql`${coreUsers.tokenVersion} + 1`, updatedAt: sql`now()` },
      });
    const staff = {
      role: admin.role,
      totpSecretCiphertext: sealed?.blob ?? null,
      totpKeyId: sealed?.keyId ?? null,
      totpLastStep: null,
      revokedAt: null,
    };
    await this.unscoped()
      .insert(corePlatformStaff)
      .values({ userId: admin.id, ...staff })
      .onConflictDoUpdate({
        target: corePlatformStaff.userId,
        set: { ...staff, updatedAt: sql`now()` },
      });
  }

  /**
   * WEB-4 leg 2: one dead `webhook` row of a console census account, fresh each run, so the
   * outbox census lists it, opens its drawer and replays it. The rows of the last run on the same
   * aggregate (dead, or pending after a replay) are deleted first: elx_platform holds DELETE on
   * `core_outbox` (0007; used otherwise by the pruning job only), and the seed runs on local and ci
   * stacks only. The envelope is a census marker, never a real effect.
   */
  async putDeadOutboxRow(row: {
    id: string;
    accountId: string;
    aggregateId: string;
  }): Promise<void> {
    await this.unscoped().delete(coreOutbox).where(eq(coreOutbox.aggregateId, row.aggregateId));
    await this.unscoped()
      .insert(coreOutbox)
      .values({
        id: row.id,
        type: 'core.account.suspended',
        eventVersion: 1,
        accountId: row.accountId,
        aggregateType: 'account',
        aggregateId: row.aggregateId,
        sequence: 1,
        payload: { census: true, note: 'WEB-4 outbox census row' },
        kind: 'webhook',
        status: 'dead',
        attempts: 5,
        lastError: 'http_503: endpoint unavailable',
        enqueuedAt: sql`now()`,
      });
  }

  /** Revokes the staff rows of the platform invitees of the last run, so they can be invited again. */
  async revokePlatformStaff(emails: readonly string[]): Promise<void> {
    const users = await this.unscoped()
      .select({ id: coreUsers.id })
      .from(coreUsers)
      .where(inArray(coreUsers.email, [...emails]));
    if (users.length === 0) return;
    await this.unscoped()
      .update(corePlatformStaff)
      .set({ revokedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        inArray(
          corePlatformStaff.userId,
          users.map((user) => user.id),
        ),
      );
  }
}

/**
 * Puts a census settings account's sites back to their starting state (WEB-3 leg 2): the seeded
 * sites written by their deterministic ids, active, with their seeded fields, and every other site
 * of the account deleted (those the last census run created). Seed tool only, local and ci;
 * elx_platform may not write core_sites (0014), so this runs in a tenant unit of work on the
 * elx_app pool for the account.
 */
export class CensusSitesRepository extends ScopedRepository<typeof coreSites> {
  constructor(uow: UnitOfWork) {
    super(uow, coreSites);
  }

  async reset(sites: readonly CensusSite[]): Promise<void> {
    await this.deleteWhere(
      notInArray(
        coreSites.id,
        sites.map((site) => site.id),
      ),
    );
    for (const site of sites) {
      // Drizzle's `xy` mode would write the point without its SRID (SitesRepository does the same).
      const point =
        site.point === null
          ? sql`NULL`
          : sql`ST_SetSRID(ST_MakePoint(${site.point.lng}::float8, ${site.point.lat}::float8), 4326)`;
      const fields = {
        kind: site.kind,
        nameAr: site.nameAr,
        nameEn: site.nameEn,
        addressText: site.addressText,
        nationalAddressShortCode: site.shortCode,
        point: point as unknown as null,
        openingHours: [...site.openingHours],
        status: 'active' as const,
      };
      const [kept] = await this.updateWhere(
        { ...fields, updatedAt: sql`now()` as unknown as Date },
        eq(coreSites.id, site.id),
      );
      if (kept === undefined) await this.insertMany([{ id: site.id, ...fields }]);
    }
  }
}
