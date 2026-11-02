import { getContext, getUnitOfWork } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditFacts } from '../accounts/account.service.js';
import type { AuditSink } from '../audit/audit-sink.js';
import type { Invitations } from '../auth/invitations.js';
import type { ListPage, ListPagePlan, PageKey } from '../contract/list-page.js';
import { containsPattern, keysetSlice } from '../contract/list-page.js';
import { oneLineTextProblem } from '../contract/text-rules.js';
import type { FieldProblem } from '../errors/api-exception.js';
import { ApiException } from '../errors/api-exception.js';
import type { AccountStore } from '../platform/accounts.repository.js';
import type { IdentityStore, UserRow } from '../platform/identity.repository.js';
import type { MembershipStatus } from '../schema/identity.js';
import { SitesRepository } from '../sites/sites.repository.js';
import type { MemberRow } from './members.repository.js';
import { MembersRepository } from './members.repository.js';

// The member doors of the staff surface (PLAT-12 plan 2.4, 2.7 to 2.10; identity and tenancy §2,
// §3.1, §4, §6). The account is always the token's (`getContext()`, ADR-0025). Two pools, as 2.9
// rules (ADR-0031): memberships are read and written in the request's tenant unit of work; their
// users are platform-pool rows, read through PLAT-11's `IdentityStore` with no lock; the invitation
// writes both sides and runs whole in PLAT-11's `Invitations` on the platform pool. The request
// holds its app connection while it waits for a platform one, never the other way round, and no
// platform transaction here waits on a lock the request's app transaction holds (PLAT-11 8.2 #29).

/** The documented sort fields of `listMembers` (plan 2.4; `name` is the user's). */
export type MemberSortField = 'created_at' | 'name' | 'status';

/** A membership with its user. */
export interface Member {
  readonly row: MemberRow;
  readonly user: UserRow;
}

export interface MemberListRequest {
  readonly plan: ListPagePlan<MemberSortField>;
  readonly statuses: readonly MembershipStatus[] | undefined;
  readonly siteId: string | undefined;
  /** The trimmed `q`, or undefined. */
  readonly q: string | undefined;
}

/** `InviteMemberRequest` as the controller hands it over (contract types stay there, A-17). */
export interface MemberInvite {
  readonly email: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly site_ids?: readonly string[] | undefined;
}

/** The longest invited name (as a site name, 2.5); the contract leaves it unbounded. */
const maxNameLength = 120;

/** The cursor key of a member for `field`. */
export function memberKeyOf(field: MemberSortField, member: Member): PageKey {
  const value =
    field === 'created_at'
      ? member.row.createdAt.toISOString()
      : field === 'name'
        ? member.user.name
        : member.row.status;
  return { value, id: member.row.id };
}

export class MembersService {
  constructor(
    private readonly deps: {
      readonly identity: IdentityStore | null;
      readonly accounts: AccountStore | null;
      readonly invitations: Pick<Invitations, 'createStaff'>;
      readonly audit: AuditSink;
    },
  ) {}

  private identity(): IdentityStore {
    const store = this.deps.identity;
    if (store === null) {
      new Logger('Members').warn('DATABASE_URL_PLATFORM is not set: the member doors answer 500');
      throw new ApiException('internal_error');
    }
    return store;
  }

  /** The users of `ids` by id (platform pool, read only); `q` keeps those it matches. */
  private async users(ids: readonly string[], q?: string): Promise<Map<string, UserRow>> {
    if (ids.length === 0) return new Map();
    const pattern = q === undefined ? undefined : containsPattern(q);
    const users = await this.identity().run((tx) => tx.users.findByIds(ids, pattern));
    return new Map(users.map((user) => [user.id, user]));
  }

  private async withUser(row: MemberRow): Promise<Member> {
    const user = (await this.users([row.userId])).get(row.userId);
    // `core_memberships.user_id` references `core_users`; a missing user is no client's fault.
    if (user === undefined) throw new Error('The user of a membership has no row');
    return { row, user };
  }

  /**
   * `listMembers` (plan 2.4, 2.8): the account's memberships the status and site filters keep, in
   * the tenant transaction; their users on the platform pool, `q` matched there (`ILIKE` over name
   * and email, escaped); then ordered and cut by the keyset in memory, because the `name` sort and
   * `q` need the users, which elx_app cannot read (plan 2.9). Every state is listed.
   */
  async list(request: MemberListRequest): Promise<ListPage<Member>> {
    const rows = await new MembersRepository(getUnitOfWork()).matching({
      statuses: request.statuses,
      siteId: request.siteId,
    });
    const users = await this.users(
      rows.map((row) => row.userId),
      request.q,
    );
    const members = rows.flatMap((row) => {
      const user = users.get(row.userId);
      return user === undefined ? [] : [{ row, user }];
    });
    const { plan } = request;
    const keyOf = (member: Member) => memberKeyOf(plan.sort.field, member);
    return plan.page(keysetSlice(plan, members, keyOf), keyOf);
  }

  /** `getMember`: a membership of the token's account in any state; another account's is `404`. */
  async get(id: string): Promise<Member> {
    const row = await new MembersRepository(getUnitOfWork()).find(id);
    if (row === undefined) throw new ApiException('not_found');
    return this.withUser(row);
  }

  /**
   * `inviteMember` (plan 2.7): the name and the sites checked, the owner rule (only an owner grants
   * `owner`, or replaces a pending invitation that grants it), then PLAT-11's `createStaff` with the
   * token's account, which checks the role combination, creates or re-invites the membership and
   * mails the link in its own platform transaction. The door's own audit row is written committed
   * after the service returns (the invitation has committed by then).
   */
  async invite(input: MemberInvite, facts: AuditFacts): Promise<Member> {
    const context = getContext();
    const uow = getUnitOfWork();
    const roles = [...new Set(input.roles)];
    const sent = input.site_ids ?? [];
    const siteIds = [...new Set(sent)];
    const problems: FieldProblem[] = [];
    const nameProblem = oneLineTextProblem('/body/name', input.name, maxNameLength);
    if (nameProblem !== undefined) problems.push(nameProblem);
    const known = await new SitesRepository(uow).knownIds(siteIds);
    // Another account's site is a bad id like any unknown one, never a 404 (plan 2.7).
    const bad = sent.findIndex((id) => !known.has(id));
    if (bad >= 0) problems.push({ pointer: `/body/site_ids/${bad}`, code: 'invalid' });
    if (problems.length > 0) throw new ApiException('validation_failed', { fields: problems });

    const members = new MembersRepository(uow);
    const caller = await callerOf(members);
    const email = input.email.toLowerCase();
    const knownUser = await this.identity().run((tx) => tx.users.findByEmail(email));
    const existing = knownUser === undefined ? undefined : await members.findOfUser(knownUser.id);
    const pendingOwner = existing?.status === 'invited' && existing.roles.includes('owner');
    if ((roles.includes('owner') || pendingOwner) && !caller.roles.includes('owner')) {
      throw new ApiException('forbidden');
    }

    const created = await this.deps.invitations.createStaff({
      accountId: context.accountId,
      email,
      name: input.name,
      roles,
      siteIds,
      invitedBy: context.userId,
      locale: await this.defaultLocale(context.accountId),
    });
    const membershipId = created.membershipId;
    if (membershipId === null) throw new Error('A staff invitation has a membership');
    await this.deps.audit.recordCommitted({
      actorType: 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: 'membership',
      targetId: membershipId,
      action: 'core.member.invited',
      after: { roles, site_ids: siteIds, email },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    // Committed by `createStaff`, so the tenant transaction reads it (read committed).
    const row = await members.find(membershipId);
    if (row === undefined) throw new Error('The invited membership is not readable');
    return this.withUser(row);
  }

  /** The account's `default_locale`: the language of the invitation mail. */
  private async defaultLocale(accountId: string): Promise<'ar' | 'en'> {
    const store = this.deps.accounts;
    if (store === null) throw new ApiException('internal_error');
    const account = await store.run((accounts) => accounts.find(accountId));
    if (account === undefined) throw new Error('The account of the token has no row');
    return account.defaultLocale;
  }
}

/**
 * The caller's own membership as stored now: the owner rules read its roles, not the token's (a
 * role removed since the token was minted no longer counts). One no longer active is `401
 * token_invalid`, as its session would be at the next refresh.
 */
async function callerOf(members: MembersRepository): Promise<MemberRow> {
  const { membershipId } = getContext();
  const row = membershipId === null ? undefined : await members.find(membershipId);
  if (row?.status !== 'active') throw new ApiException('token_invalid');
  return row;
}
