import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository } from '@eeasy-logistics/db/platform';
import { uuidv7 } from '@eeasy-logistics/db';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { coreAccounts } from '../modules/kernel/schema/accounts.js';
import {
  coreMemberships,
  corePlatformStaff,
  coreUsers,
} from '../modules/kernel/schema/identity.js';
import { coreOtpChallenges } from '../modules/kernel/schema/otp-challenges.js';
import type { CensusAccountKey, CensusUser } from './census.js';

/**
 * Puts the census identities back to their starting state (seed tool only; local and ci; WEB-2
 * plan 2.14). Upserts by the deterministic ids of `census.ts`, so a run never duplicates a row.
 */
export class CensusIdentitiesRepository extends PlatformRepository<typeof coreUsers> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreUsers);
  }

  async putAccounts(
    accounts: readonly { id: string; name: string; factor: boolean }[],
  ): Promise<void> {
    for (const account of accounts) {
      const settings = account.factor ? { second_factor_required: true } : {};
      await this.unscoped()
        .insert(coreAccounts)
        .values({ id: account.id, name: account.name, status: 'active', settings })
        .onConflictDoUpdate({
          target: coreAccounts.id,
          set: { name: account.name, status: 'active', settings, updatedAt: sql`now()` },
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

  /** The console super admin with the census password and an enrolled TOTP secret (sealed). */
  async putPlatformAdmin(
    admin: { id: string; email: string; name: string },
    passwordHash: string,
    sealed: { blob: Buffer; keyId: string },
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
      role: 'super_admin' as const,
      totpSecretCiphertext: sealed.blob,
      totpKeyId: sealed.keyId,
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
}
