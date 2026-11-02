import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { and, arrayContains, eq, inArray } from 'drizzle-orm';
import type { MembershipStatus } from '../schema/identity.js';
import { coreMemberships } from '../schema/identity.js';

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
}
