import type { ListMembers200, Membership } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { getContext } from '@eeasy-logistics/db';
import { Controller, Delete, Get, HttpCode, Inject, Optional, Patch, Post } from '@nestjs/common';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import type { AuditSink } from '../audit/audit-sink.js';
import { Invitations } from '../auth/invitations.js';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { PERMISSION_RESOLVER } from '../authz/permission-resolver.js';
import type { RequestFacts } from '../auth/request-facts.js';
import { AuthRequest } from '../auth/request-facts.js';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation } from '../contract/contract-pipe.js';
import type { ListSorts } from '../contract/list-page.js';
import {
  CURSOR_CODEC,
  CursorCodec,
  enumListFilter,
  planListPage,
  presentPage,
  textQuery,
} from '../contract/list-page.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { accountStoreOnPool } from '../platform/accounts.repository.js';
import { identityStoreOnPool } from '../platform/identity.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import { membershipStatuses } from '../schema/identity.js';
import { presentMember } from './members.presenter.js';
import type { Member, MemberSortField } from './members.service.js';
import { MembersService } from './members.service.js';

// The staff surface's `members` tag (PLAT-12 plan 2.4, 2.7 to 2.11): `listMembers`, `getMember`,
// `inviteMember`, `updateMember`, `revokeMember`. The account is the token's; a membership of another account is `404`. Members
// are an account resource, not a site one: no door here is site-scoped (2.11). `x-permission`
// (`core.members.read`, `core.members.manage`) is enforced by PLAT-10's guard. Registered by
// `AuthModule`, whose `Invitations` the invitation is delegated to (2.9).

const listOp = operationSchemas.listMembers;
const getOp = operationSchemas.getMember;
const inviteOp = operationSchemas.inviteMember;
const updateOp = operationSchemas.updateMember;
const revokeOp = operationSchemas.revokeMember;

const memberSorts: ListSorts<MemberSortField> = {
  fields: { created_at: 'timestamp', name: 'text', status: 'text' },
  default: '-created_at',
};

const present = (member: Member): Membership => presentMember(member.row, member.user);

@Controller('v1/staff/members')
export class MembersController {
  private readonly cursors: CursorCodec;
  private readonly members: MembersService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    invitations: Invitations,
    @Optional() @Inject(PLATFORM_POOL) pool?: Parameters<typeof identityStoreOnPool>[0],
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
    @Optional() @Inject(PERMISSION_RESOLVER) resolver?: PermissionResolver | null,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    this.members = new MembersService({
      identity: identityStoreOnPool(pool ?? null),
      accounts: accountStoreOnPool(pool ?? null),
      invitations,
      audit,
      resolver: resolver ?? undefined,
    });
  }

  @Get()
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<ListMembers200> {
    const { query } = input;
    // Filters are checked before the cursor, so a bad one answers on its own pointer.
    const statuses = enumListFilter(query.status, membershipStatuses, '/query/status');
    const q = textQuery(query.q);
    const plan = planListPage(this.cursors, {
      operation: 'listMembers',
      reader: `account:${getContext().accountId}`,
      filters: { status: query.status, site_id: query.site_id, q },
      sorts: memberSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = await this.members.list({ plan, statuses, siteId: query.site_id, q });
    return presentPage(page, present);
  }

  @Post('invitations')
  @HttpCode(201)
  @Idempotent()
  @Operation(inviteOp)
  async invite(
    @Input() input: ContractInput<typeof inviteOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Membership> {
    return present(await this.members.invite(input.body, facts));
  }

  @Get(':membership_id')
  @Operation(getOp)
  async get(@Input() input: ContractInput<typeof getOp>): Promise<Membership> {
    return present(await this.members.get(input.params.membership_id));
  }

  /** Roles and sites; an absent field keeps its value (plan 2.8). Re-reads `token_version`. */
  @Patch(':membership_id')
  @HttpCode(200)
  @Idempotent()
  @Operation(updateOp)
  async update(
    @Input() input: ContractInput<typeof updateOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Membership> {
    const member = await this.members.update(
      input.params.membership_id,
      input.body,
      facts,
      facts.principal?.tokenVersion,
    );
    return present(member);
  }

  @Delete(':membership_id')
  @HttpCode(204)
  @Idempotent()
  @Operation(revokeOp)
  async revoke(
    @Input() input: ContractInput<typeof revokeOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<void> {
    await this.members.revoke(input.params.membership_id, facts, facts.principal?.tokenVersion);
  }
}
