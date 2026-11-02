import { getContext, getUnitOfWork } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditFacts } from '../accounts/account.service.js';
import type { AuditSink } from '../audit/audit-sink.js';
import { countRevocations } from '../auth/auth-metrics.js';
import type { Invitations } from '../auth/invitations.js';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { assertRoleCombination } from '../authz/separation.js';
import type { ListPage, ListPagePlan, PageKey } from '../contract/list-page.js';
import { containsPattern, keysetSlice } from '../contract/list-page.js';
import { oneLineTextProblem } from '../contract/text-rules.js';
import type { FieldProblem } from '../errors/api-exception.js';
import { ApiException } from '../errors/api-exception.js';
import { canonicalJson } from '../idempotency/request-hash.js';
import type { AccountStore } from '../platform/accounts.repository.js';
import type { IdentityStore, UserRow } from '../platform/identity.repository.js';
import type { MembershipStatus } from '../schema/identity.js';
import { SitesRepository } from '../sites/sites.repository.js';
import type { MemberChangeRefusal } from './member-rules.js';
import { memberChangeRefusal } from './member-rules.js';
import type { MemberRow } from './members.repository.js';
import { MemberInvitationsRepository, MembersRepository } from './members.repository.js';

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

/** `UpdateMemberRequest`: an absent field keeps its stored value. */
export interface MemberPatch {
  readonly roles?: readonly string[] | undefined;
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
      readonly resolver: Pick<PermissionResolver, 'bundles'> | undefined;
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
    const siteProblem = await unknownSite(sent);
    if (siteProblem !== undefined) problems.push(siteProblem);
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

  /**
   * `updateMember` (plan 2.8): the roles and sites the body sends replace the stored ones under the
   * account's membership write lock, after the caller's token version is re-read (identity §4) and
   * the owner rules (`memberChangeRefusal`) and the role combination over the user's roles in the
   * account (a `driver` role the drivers resource gave stays; PLAT-10 A-7) pass. The member's staff
   * sessions of this membership end, so the new roles hold within one access-token lifetime;
   * audited with the changed fields before and after. A body that changes nothing writes nothing.
   */
  async update(
    id: string,
    patch: MemberPatch,
    facts: AuditFacts,
    tokenVersion: number | undefined,
  ): Promise<Member> {
    const context = getContext();
    await this.assertTokenCurrent(context.userId, tokenVersion);
    const siteProblem =
      patch.site_ids === undefined ? undefined : await unknownSite(patch.site_ids);
    if (siteProblem !== undefined) {
      throw new ApiException('validation_failed', { fields: [siteProblem] });
    }
    const members = new MembersRepository(getUnitOfWork());
    await members.lockWrites();
    const caller = await callerOf(members);
    const target = await members.find(id);
    if (target === undefined) throw new ApiException('not_found');
    const kept = target.roles.filter((role) => role === 'driver');
    const roles =
      patch.roles === undefined ? target.roles : [...new Set([...patch.roles, ...kept])];
    const siteIds = patch.site_ids === undefined ? target.siteIds : [...new Set(patch.site_ids)];
    const refusal = memberChangeRefusal({
      caller,
      target,
      roles,
      revoking: false,
      activeOwners: await members.activeOwners(),
    });
    if (refusal !== undefined) throw forbidden('updateMember', refusal);
    // A revoked membership comes back through an invitation, never through an update.
    if (target.status === 'revoked') {
      throw new ApiException('invalid_transition', { details: { current_status: 'revoked' } });
    }
    assertRoleCombination(roles, this.bundles());

    const before = { roles: target.roles, site_ids: target.siteIds };
    const after = { roles, site_ids: siteIds };
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter(
      (key) => canonicalJson(before[key]) !== canonicalJson(after[key]),
    );
    if (changed.length === 0) return this.withUser(target);
    await this.endSessions(target);
    const row = await members.write(id, { roles, siteIds });
    await this.record(
      row,
      'core.member.updated',
      pick(before, changed),
      pick(after, changed),
      facts,
    );
    return this.withUser(row);
  }

  /**
   * `revokeMember` (plan 2.8): the same lock, token check and owner rules (a revocation removes
   * `owner`); the membership `revoked`, its open invitations expired, its staff sessions ended,
   * audited. A revoked membership is `409 invalid_transition`.
   */
  async revoke(id: string, facts: AuditFacts, tokenVersion: number | undefined): Promise<void> {
    const context = getContext();
    await this.assertTokenCurrent(context.userId, tokenVersion);
    const uow = getUnitOfWork();
    const members = new MembersRepository(uow);
    await members.lockWrites();
    const caller = await callerOf(members);
    const target = await members.find(id);
    if (target === undefined) throw new ApiException('not_found');
    const refusal = memberChangeRefusal({
      caller,
      target,
      roles: target.roles,
      revoking: true,
      activeOwners: await members.activeOwners(),
    });
    if (refusal !== undefined) throw forbidden('revokeMember', refusal);
    if (target.status === 'revoked') {
      throw new ApiException('invalid_transition', { details: { current_status: 'revoked' } });
    }
    await this.endSessions(target);
    const row = await members.revoke(id);
    const invitations = await new MemberInvitationsRepository(uow).expireOpenOf(id);
    await this.record(
      row,
      'core.member.revoked',
      { status: target.status },
      { status: 'revoked', invitations_expired: invitations },
      facts,
    );
  }

  /**
   * The sensitive-action rule (identity §4, staff.yaml `updateMember`): the caller's
   * `token_version` read now on the platform pool; a moved one (a password reset, a second-factor
   * reset) is `401 token_invalid`, as `switchAccount` answers. Read before any lock is taken.
   */
  private async assertTokenCurrent(userId: string | null, tokenVersion: number | undefined) {
    if (userId === null || tokenVersion === undefined) throw new ApiException('token_invalid');
    const user = await this.identity().run((tx) => tx.users.find(userId));
    if (user === undefined || user.disabled || user.tokenVersion !== tokenVersion) {
      throw new ApiException('token_invalid');
    }
  }

  /**
   * Revokes the member's staff refresh families of this membership (PLAT-11 `revokeAll`, reason
   * `revoked`) in a platform transaction of its own, before the tenant write: the request's app
   * transaction holds no row lock yet, so that transaction never waits on it (8.2 #3). A refresh
   * between the two answers `401`; a sign-in between them gets the roles of that moment, which its
   * next refresh re-reads (PLAT-11 `claimsOfRow`).
   */
  private async endSessions(target: MemberRow): Promise<void> {
    const families = await this.identity().run((tx) =>
      tx.refreshTokens.revokeAll(target.userId, 'revoked', {
        surface: 'staff',
        membershipId: target.id,
      }),
    );
    countRevocations('revoked', families.length);
  }

  private bundles(): PermissionResolver['bundles'] {
    const resolver = this.deps.resolver;
    // Without the resolver (no platform pool at boot) no combination can be checked.
    if (resolver === undefined) throw new ApiException('internal_error');
    return resolver.bundles;
  }

  private record(
    row: MemberRow,
    action: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    facts: AuditFacts,
  ): Promise<void> {
    const context = getContext();
    return this.deps.audit.record({
      actorType: 'user',
      actorId: context.userId,
      accountId: context.accountId,
      targetType: 'membership',
      targetId: row.id,
      action,
      before,
      after,
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
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

/**
 * The first of `sent` that names no site of the account (active or inactive), as a field problem
 * at `/body/site_ids/<i>`: another account's site is a bad id like any unknown one, never a `404`
 * (plan 2.7).
 */
async function unknownSite(sent: readonly string[]): Promise<FieldProblem | undefined> {
  const known = await new SitesRepository(getUnitOfWork()).knownIds(sent);
  const bad = sent.findIndex((id) => !known.has(id));
  return bad < 0 ? undefined : { pointer: `/body/site_ids/${bad}`, code: 'invalid' };
}

/** `403 forbidden` (no detail, PLAT-10), the rule logged for the operator. */
function forbidden(operation: string, refusal: MemberChangeRefusal): ApiException {
  new Logger('Members').log(`${operation} refused: ${refusal}`);
  return new ApiException('forbidden');
}

function pick(
  values: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}
