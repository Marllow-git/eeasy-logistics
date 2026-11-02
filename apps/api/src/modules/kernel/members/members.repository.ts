import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { and, arrayContains, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { MembershipStatus } from '../schema/identity.js';
import { coreInvitations, coreMemberships } from '../schema/identity.js';

/** A `core_memberships` row of the context's account. */
export type MemberRow = typeof coreMemberships.$inferSelect;

export interface MemberFilters {
  readonly statuses?: readonly MembershipStatus[] | undefined;
  /** Memberships whose `site_ids` contain this site (plan 2.4). */
  readonly siteId?: string | undefined;
}

/**
 * `core_memberships` of the context's account in the request's tenant unit of work (PLAT-12 plan
 * 2.8, 2.9; ADR-0031: memberships are a tenant table, their users are not).
 */
export class MembersRepository extends ScopedRepository<typeof coreMemberships> {
  constructor(uow: UnitOfWork) {
    super(uow, coreMemberships);
  }

  async find(id: string): Promise<MemberRow | undefined> {
    const [row] = await this.findMany(eq(coreMemberships.id, id));
    return row;
  }

  /** The membership of `userId` in the account (one at most: unique per account and user). */
  async findOfUser(userId: string): Promise<MemberRow | undefined> {
    const [row] = await this.findMany(eq(coreMemberships.userId, userId));
    return row;
  }

  /**
   * Every membership of the account the filters keep, unordered: `listMembers` sorts and pages them
   * with their users' names, which only the platform pool can read (plan 2.4, 2.9).
   */
  matching(filters: MemberFilters): Promise<MemberRow[]> {
    return this.findMany(
      and(
        filters.statuses === undefined
          ? undefined
          : inArray(coreMemberships.status, [...filters.statuses]),
        filters.siteId === undefined
          ? undefined
          : arrayContains(coreMemberships.siteIds, [filters.siteId]),
      ),
    );
  }

  /**
   * Orders the account's membership writes (plan 2.8): the owner rules read the caller's roles and
   * count the active owners, then the write follows under this lock, so two owners demoting each
   * other at once cannot leave the account without one.
   */
  lockWrites(): Promise<void> {
    return this.transactionLock('core_memberships');
  }

  /** The account's `active` memberships holding `owner`. */
  activeOwners(): Promise<number> {
    return this.countWhere(
      and(eq(coreMemberships.status, 'active'), arrayContains(coreMemberships.roles, ['owner'])),
    );
  }

  /** New roles and sites; the caller holds `lockWrites()`. */
  async write(
    id: string,
    values: { readonly roles: readonly string[]; readonly siteIds: readonly string[] },
  ): Promise<MemberRow> {
    const [row] = await this.updateWhere(
      {
        roles: [...values.roles],
        siteIds: [...values.siteIds],
        updatedAt: sql`now()` as unknown as Date,
      },
      eq(coreMemberships.id, id),
    );
    if (row === undefined) throw new Error('The membership vanished under the write lock');
    return row;
  }

  /** `revoked`; the caller holds `lockWrites()`. */
  async revoke(id: string): Promise<MemberRow> {
    const [row] = await this.updateWhere(
      { status: 'revoked', updatedAt: sql`now()` as unknown as Date },
      eq(coreMemberships.id, id),
    );
    if (row === undefined) throw new Error('The membership vanished under the write lock');
    return row;
  }
}

/** `core_invitations` of the context's account (tenant rows; elx_app may update them, 0012). */
export class MemberInvitationsRepository extends ScopedRepository<typeof coreInvitations> {
  constructor(uow: UnitOfWork) {
    super(uow, coreInvitations);
  }

  /** Ends the open invitations of a membership now (`revokeMember`, plan 2.8). */
  async expireOpenOf(membershipId: string): Promise<number> {
    const rows = await this.updateWhere(
      { expiresAt: sql`now()` as unknown as Date, updatedAt: sql`now()` as unknown as Date },
      and(
        eq(coreInvitations.membershipId, membershipId),
        isNull(coreInvitations.acceptedAt),
        gt(coreInvitations.expiresAt, sql`now()`),
      ),
    );
    return rows.length;
  }
}
