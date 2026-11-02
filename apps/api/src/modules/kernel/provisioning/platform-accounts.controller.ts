import type {
  Account,
  Membership,
  PlatformListAccountMembers200,
  PlatformListAccounts200,
} from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import { findContext, findPlatformContext } from '@eeasy-logistics/db';
import { Controller, Get, HttpCode, Inject, Optional, Patch, Post } from '@nestjs/common';
import { AccountService } from '../accounts/account.service.js';
import type { AuditSink } from '../audit/audit-sink.js';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import { Invitations } from '../auth/invitations.js';
import type { RequestFacts } from '../auth/request-facts.js';
import { AuthRequest } from '../auth/request-facts.js';
import { SecondFactorResets } from '../auth/second-factor-resets.js';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { PERMISSION_RESOLVER } from '../authz/permission-resolver.js';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation, sentBodyFields } from '../contract/contract-pipe.js';
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
import { presentMember } from '../members/members.presenter.js';
import { MembersService, memberSorts } from '../members/members.service.js';
import { OutboxWriter } from '../outbox/outbox-writer.js';
import { doorAccountStore } from '../platform/accounts.repository.js';
import { doorIdentityStore } from '../platform/identity.repository.js';
import type { AccountSortField } from '../platform/provisioning.repository.js';
import { accountStatuses } from '../schema/accounts.js';
import { CrossTenant, accountIdParam, optionalReason } from '../tenancy/cross-tenant.js';
import { presentListedAccount, presentPlatformAccount } from './platform-accounts.presenter.js';
import { ProvisioningService } from './provisioning.service.js';

// The platform surface's `accounts` tag (PLAT-13 plan 2.2 to 2.4; ADR-0006; K-1): list,
// provision, read, change, invite the owner. The list and the provisioning door are platform
// work (accounts are a platform table); the others name their account as `:account_id` through
// the cross-tenant door (one audit row per call; PLAT-6), whose `X-Support-Reason` is optional:
// their contract declares no `SupportReason` (lead ruling on 8.2 #8), so the row carries it when
// sent. `x-permission` (`platform.accounts.read`, `platform.accounts.provision`) is PLAT-10's
// guard. Registered by `AuthModule`, whose `Invitations` the owner's invitation is delegated to.
// `platformProvisionZone` and `platformProvisionCoverage` are DEL-1's (ADR-0015). Suspension,
// reactivation and closure (leg 2, plan 2.7) are doors too, with the reason in the body
// (`platform.accounts.suspend`). `platformListAccountMembers` (plan 2.8, `support` tag) reads the
// account's members through the door with `X-Support-Reason` required: PLAT-12's list and
// presenter under the door's account.

const listOp = operationSchemas.platformListAccounts;
const provisionOp = operationSchemas.platformProvisionAccount;
const getOp = operationSchemas.platformGetAccount;
const updateOp = operationSchemas.platformUpdateAccount;
const inviteOwnerOp = operationSchemas.platformInviteOwner;
const suspendOp = operationSchemas.platformSuspendAccount;
const reactivateOp = operationSchemas.platformReactivateAccount;
const closeOp = operationSchemas.platformCloseAccount;
const membersOp = operationSchemas.platformListAccountMembers;

/** The lifecycle doors carry their reason in the body (`PlatformReasonRequest`), as the door's. */
const bodyReason = { from: 'path', name: accountIdParam, reason: 'body' } as const;

const accountSorts: ListSorts<AccountSortField> = {
  fields: { created_at: 'timestamp', name: 'text', status: 'text' },
  default: '-created_at',
};

@Controller('v1/platform/accounts')
export class PlatformAccountsController {
  private readonly cursors: CursorCodec;
  private readonly provisioning: ProvisioningService;
  private readonly accounts: AccountService;
  private readonly members: MembersService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    outbox: OutboxWriter,
    invitations: Invitations,
    resets: SecondFactorResets,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
    @Optional() @Inject(PERMISSION_RESOLVER) resolver?: PermissionResolver | null,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    // The door's own transaction (lead ruling on 8.2 #11): the account row, the identity tables and
    // the audit rows of the account doors are read and written there, never on a second platform
    // connection. Provisioning and the list run in the request's platform unit of work.
    const store = doorAccountStore();
    this.provisioning = new ProvisioningService({ invitations, audit, outbox, accounts: store });
    this.accounts = new AccountService(store, audit);
    this.members = new MembersService({
      identity: doorIdentityStore(),
      accounts: store,
      invitations,
      audit,
      resolver: resolver ?? undefined,
      resets,
    });
  }

  @Get()
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<PlatformListAccounts200> {
    const { query } = input;
    // Filters are checked before the cursor, so a bad one answers on its own pointer.
    const statuses = enumListFilter(query.status, accountStatuses, '/query/status');
    const q = textQuery(query.q);
    const plan = planListPage(this.cursors, {
      operation: 'platformListAccounts',
      reader: `platform:${findPlatformContext()?.userId ?? ''}`,
      filters: { status: query.status, q },
      sorts: accountSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = await this.provisioning.list({ plan, statuses, q });
    return presentPage(page, presentListedAccount);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @Operation(provisionOp)
  async provision(
    @Input() input: ContractInput<typeof provisionOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Account> {
    return presentPlatformAccount(await this.provisioning.provision(input.body, facts));
  }

  @Get(':account_id')
  @CrossTenant(optionalReason)
  @Operation(getOp)
  async get(@Input() _input: ContractInput<typeof getOp>): Promise<Account> {
    return presentPlatformAccount(await this.accounts.read());
  }

  /** A PATCH merge: only the fields the body sent change (plan 2.4). */
  @Patch(':account_id')
  @HttpCode(200)
  @CrossTenant(optionalReason)
  @Idempotent()
  @Operation(updateOp)
  async update(
    @Input() input: ContractInput<typeof updateOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Account> {
    await this.provisioning.update(input.body, sentBodyFields(input), facts);
    return presentPlatformAccount(await this.accounts.read());
  }

  @Post(':account_id/owner-invitations')
  @HttpCode(201)
  @CrossTenant(optionalReason)
  @Idempotent()
  @Operation(inviteOwnerOp)
  async inviteOwner(
    @Input() input: ContractInput<typeof inviteOwnerOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Membership> {
    const membershipId = await this.provisioning.inviteOwner(input.body, facts);
    return presentMember(await this.members.get(membershipId));
  }

  /**
   * `platformListAccountMembers` (plan 2.8): PLAT-12's member list and presenter under the door's
   * account (every state, the person each membership shows), `X-Support-Reason` required. The
   * door's committed row is the call's only write; the cursor is bound to the reader and the
   * account, so a page of one account never continues in another.
   */
  @Get(':account_id/members')
  @CrossTenant()
  @Operation(membersOp)
  async listMembers(
    @Input() input: ContractInput<typeof membersOp>,
  ): Promise<PlatformListAccountMembers200> {
    const { query } = input;
    const door = findContext();
    const plan = planListPage(this.cursors, {
      operation: 'platformListAccountMembers',
      reader: `platform:${door?.userId ?? ''}:account:${door?.accountId ?? ''}`,
      filters: {},
      sorts: memberSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = await this.members.list({
      plan,
      statuses: undefined,
      siteId: undefined,
      q: undefined,
    });
    return presentPage(page, presentMember);
  }

  /** `active → suspended` (plan 2.7); the body's reason is the door's and the audit row's. */
  @Post(':account_id/suspend')
  @HttpCode(200)
  @CrossTenant(bodyReason)
  @Idempotent()
  @Operation(suspendOp)
  async suspend(
    @Input() input: ContractInput<typeof suspendOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Account> {
    await this.provisioning.transition('suspend', input.body.reason, facts);
    return presentPlatformAccount(await this.accounts.read());
  }

  /** `suspended → active` (plan 2.7). */
  @Post(':account_id/reactivate')
  @HttpCode(200)
  @CrossTenant(bodyReason)
  @Idempotent()
  @Operation(reactivateOp)
  async reactivate(
    @Input() input: ContractInput<typeof reactivateOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Account> {
    await this.provisioning.transition('reactivate', input.body.reason, facts);
    return presentPlatformAccount(await this.accounts.read());
  }

  /** `suspended → closed` only (plan 2.7, §7 #4); the account stays readable through the door. */
  @Post(':account_id/close')
  @HttpCode(200)
  @CrossTenant(bodyReason)
  @Idempotent()
  @Operation(closeOp)
  async close(
    @Input() input: ContractInput<typeof closeOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Account> {
    await this.provisioning.transition('close', input.body.reason, facts);
    return presentPlatformAccount(await this.accounts.read());
  }
}
