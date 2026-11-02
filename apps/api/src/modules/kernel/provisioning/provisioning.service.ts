import { findContext, findPlatformContext, getContext, uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AccountView, AuditFacts } from '../accounts/account.service.js';
import type { AccountLimitValues, LimitKey } from '../accounts/limits.js';
import { effectiveLimits, limitKeys } from '../accounts/limits.js';
import type { AuditSink } from '../audit/audit-sink.js';
import type { Invitations } from '../auth/invitations.js';
import type { ListPage, ListPagePlan } from '../contract/list-page.js';
import { oneLineTextProblem } from '../contract/text-rules.js';
import type { FieldProblem } from '../errors/api-exception.js';
import { ApiException } from '../errors/api-exception.js';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import type { AccountRecord, AccountStore } from '../platform/accounts.repository.js';
import { identityTransactionOf } from '../platform/identity.repository.js';
import type { AccountSortField } from '../platform/provisioning.repository.js';
import { ProvisionedAccounts, currentProvisioning } from '../platform/provisioning.repository.js';
import type { AccountLocale, AccountStatus } from '../schema/accounts.js';
import { accountNameProblem, moduleKeys, ownerNameMaxLength } from './account-input.js';

// The provisioning doors of the platform surface (PLAT-13 plan 2.2 to 2.4; ADR-0006; identity and
// tenancy §6; K-1, K-2, K-6, K-7). An account comes to exist only through `provision`, in one
// platform transaction with its limits, its first feature flags, its owner's invitation, the
// `core.account.provisioned` event and its audit row. The other doors run inside the cross-tenant
// door of the account they name (`getContext()` is that account), whose `core_accounts` row they
// change on the door's own transaction with its audit row (`recordIn`): the store the controller
// gives is `doorAccountStore()`, so no door holds a second platform connection (lead ruling on
// 8.2 #11).

/** `ProvisionAccountRequest` as the controller hands it over (contract types stay there, A-17). */
export interface ProvisionInput {
  readonly name: string;
  readonly default_locale: AccountLocale;
  readonly limits: Partial<Record<LimitKey, number>>;
  readonly modules?: readonly string[] | undefined;
  readonly owner: { readonly email: string; readonly name: string };
}

/** `UpdateAccountRequest`: only the fields in `sent` change. */
export interface AccountPatch {
  readonly name?: string | undefined;
  readonly default_locale?: AccountLocale | undefined;
  readonly limits?: Partial<Record<LimitKey, number>> | undefined;
}

export interface AccountListRequest {
  readonly plan: ListPagePlan<AccountSortField>;
  readonly statuses: readonly AccountStatus[] | undefined;
  readonly q: string | undefined;
}

/** Usage of an account nobody has used yet. */
const noUsage: AccountLimitValues = Object.freeze({
  orders_per_month: 0,
  drivers: 0,
  sites: 0,
  api_keys: 0,
});

/**
 * Limits as audit documents carry them: PLAT-7's redaction treats any `keys` token as a secret, so
 * `api_keys` is written `api_clients` (as PLAT-8 writes `objects`), or the audit row would hide it.
 */
export function auditLimits(limits: Partial<Record<LimitKey, number>>): Record<string, number> {
  const document: Record<string, number> = {};
  for (const key of limitKeys) {
    const value = limits[key];
    if (value !== undefined) document[key === 'api_keys' ? 'api_clients' : key] = value;
  }
  return document;
}

/** The platform user of the current request: the door's context, or the platform frame's. */
function platformCaller(): string {
  const userId = findContext()?.userId ?? findPlatformContext()?.userId;
  if (userId === undefined || userId === null)
    throw new Error('A provisioning door ran outside a platform request');
  return userId;
}

function validationFailed(problems: readonly (FieldProblem | undefined)[]): void {
  const fields = problems.filter((problem): problem is FieldProblem => problem !== undefined);
  if (fields.length > 0) throw new ApiException('validation_failed', { fields });
}

export interface ProvisioningDependencies {
  readonly invitations: Pick<Invitations, 'createStaff'>;
  readonly audit: AuditSink;
  readonly outbox: Pick<OutboxWriter, 'enqueue'>;
  readonly accounts: AccountStore | null;
}

export class ProvisioningService {
  readonly #logger = new Logger('Provisioning');

  constructor(private readonly deps: ProvisioningDependencies) {}

  private store(): AccountStore {
    const store = this.deps.accounts;
    if (store === null) throw new ApiException('internal_error');
    return store;
  }

  /**
   * `platformProvisionAccount` (plan 2.2): the name bound, every limit key, the owner's name and
   * the module keys are checked first; then, in the request's platform transaction, the
   * `provisioned` account, one enabled flag per module (`provisioned_by` the caller, K-6), the
   * owner's `invited` membership with its invitation and mail (PLAT-11's `createStaff` in the same
   * transaction), the `core.account.provisioned` event and the `core.account.provisioned` audit row.
   * The event is a platform-only row (no account: the writer takes the account from a tenant unit
   * of work only, and this one is the platform's); its payload names the account.
   */
  async provision(input: ProvisionInput, facts: AuditFacts): Promise<AccountView> {
    const modules = moduleKeys(input.modules);
    validationFailed([
      accountNameProblem('/body/name', input.name),
      ...limitKeys.map((key): FieldProblem | undefined =>
        input.limits[key] === undefined
          ? { pointer: `/body/limits/${key}`, code: 'required' }
          : undefined,
      ),
      'problem' in modules ? modules.problem : undefined,
      oneLineTextProblem('/body/owner/name', input.owner.name, ownerNameMaxLength),
    ]);
    if ('problem' in modules) throw new Error('unreachable: module problems are thrown above');
    const caller = platformCaller();
    const { uow, accounts, flags } = currentProvisioning();
    const limits = Object.fromEntries(limitKeys.map((key) => [key, input.limits[key] ?? 0]));
    const email = input.owner.email.toLowerCase();
    const id = uuidv7();
    const account = await accounts.insert({
      id,
      name: input.name,
      defaultLocale: input.default_locale,
      limits,
      provisionedBy: caller,
    });
    await flags.insertEnabled(id, modules.keys, caller);
    const owner = await this.deps.invitations.createStaff(
      {
        accountId: id,
        email,
        name: input.owner.name,
        roles: ['owner'],
        siteIds: [],
        invitedBy: caller,
        locale: input.default_locale,
      },
      identityTransactionOf(uow),
    );
    await this.deps.outbox.enqueue(uow, {
      type: 'core.account.provisioned',
      version: 1,
      aggregate: { type: 'account', id, version: account.version },
      payload: { account_id: id, limits, modules: modules.keys },
      kind: 'internal_event',
    });
    await this.deps.audit.recordIn(uow, {
      actorType: 'platform_user',
      actorId: caller,
      accountId: id,
      targetType: 'account',
      targetId: id,
      action: 'core.account.provisioned',
      after: {
        name: input.name,
        default_locale: input.default_locale,
        limits: auditLimits(limits),
        modules: modules.keys,
        owner_email: email,
        owner_membership_id: owner.membershipId,
      },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    this.#logger.log(`account provisioned account_id=${id}`);
    return { account, limits: effectiveLimits(account.limits), usage: noUsage };
  }

  /**
   * `platformUpdateAccount` (plan 2.4), inside the account's door: the sent name (same bound),
   * language and limit keys replace the stored ones under the row's lock, `version + 1`, audited
   * `core.account.updated` with the changed keys before and after in the same platform transaction.
   * A limit below current usage is allowed (it only blocks new creates). A patch that changes
   * nothing writes nothing.
   */
  async update(patch: AccountPatch, sent: readonly string[], facts: AuditFacts): Promise<void> {
    const has = (field: string) => sent.includes(field);
    validationFailed([has('name') ? accountNameProblem('/body/name', patch.name) : undefined]);
    const caller = platformCaller();
    const accountId = getContext().accountId;
    await this.store().run(async (accounts, uow) => {
      const account = await accounts.find(accountId, { lock: true });
      // The door checked the account exists in its own transaction; no row is never the caller's.
      if (account === undefined) throw new ApiException('not_found');
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      const change: {
        name?: string;
        defaultLocale?: AccountLocale;
        limits?: Record<string, number>;
      } = {};
      if (has('name') && patch.name !== undefined && patch.name !== account.name) {
        before.name = account.name;
        after.name = patch.name;
        change.name = patch.name;
      }
      if (
        has('default_locale') &&
        patch.default_locale !== undefined &&
        patch.default_locale !== account.defaultLocale
      ) {
        before.default_locale = account.defaultLocale;
        after.default_locale = patch.default_locale;
        change.defaultLocale = patch.default_locale;
      }
      if (has('limits') && patch.limits !== undefined) {
        const current = effectiveLimits(account.limits);
        const limitsBefore: Partial<Record<LimitKey, number>> = {};
        const limitsAfter: Partial<Record<LimitKey, number>> = {};
        for (const key of limitKeys) {
          const value = patch.limits[key];
          if (value === undefined || value === current[key]) continue;
          limitsBefore[key] = current[key];
          limitsAfter[key] = value;
        }
        if (Object.keys(limitsAfter).length > 0) {
          before.limits = auditLimits(limitsBefore);
          after.limits = auditLimits(limitsAfter);
          change.limits = { ...current, ...limitsAfter };
        }
      }
      if (Object.keys(after).length === 0) return;
      await new ProvisionedAccounts(uow).updateProfile(accountId, change);
      await this.deps.audit.recordIn(uow, {
        actorType: 'platform_user',
        actorId: caller,
        accountId,
        targetType: 'account',
        targetId: accountId,
        action: 'core.account.updated',
        before,
        after,
        requestId: facts.requestId,
        clientRequestId: facts.clientRequestId,
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
    });
  }

  /**
   * `platformInviteOwner` (plan 2.4, §7 #3), inside the account's door: PLAT-11's `createStaff` with
   * `roles: ['owner']` in the account's language (an `active` membership of that email is `409
   * invalid_transition` from the service; another email adds an owner) and the door's
   * `core.member.invited` row, both in the store's transaction (the door's own). Answers the
   * membership id.
   */
  async inviteOwner(
    input: { readonly email: string; readonly name: string },
    facts: AuditFacts,
  ): Promise<string> {
    validationFailed([oneLineTextProblem('/body/name', input.name, ownerNameMaxLength)]);
    const caller = platformCaller();
    const accountId = getContext().accountId;
    const email = input.email.toLowerCase();
    return this.store().run(async (accounts, uow) => {
      const account = await accounts.find(accountId);
      if (account === undefined) throw new ApiException('not_found');
      const created = await this.deps.invitations.createStaff(
        {
          accountId,
          email,
          name: input.name,
          roles: ['owner'],
          siteIds: [],
          invitedBy: caller,
          locale: account.defaultLocale,
        },
        identityTransactionOf(uow),
      );
      const membershipId = created.membershipId;
      if (membershipId === null) throw new Error('A staff invitation has a membership');
      await this.deps.audit.recordIn(uow, {
        actorType: 'platform_user',
        actorId: caller,
        accountId,
        targetType: 'membership',
        targetId: membershipId,
        action: 'core.member.invited',
        after: { roles: ['owner'], site_ids: [], email },
        requestId: facts.requestId,
        clientRequestId: facts.clientRequestId,
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
      return membershipId;
    });
  }

  /** `platformListAccounts` (plan 2.4): one page of accounts on the platform pool, no usage. */
  async list(request: AccountListRequest): Promise<ListPage<AccountRecord>> {
    const { plan } = request;
    const rows = await currentProvisioning().accounts.page(plan, {
      statuses: request.statuses,
      q: request.q,
    });
    return plan.page(rows, (row) => accountKeyOf(plan.sort.field, row));
  }
}

/** The cursor key of an account for `field`. */
export function accountKeyOf(
  field: AccountSortField,
  row: AccountRecord,
): { value: string; id: string } {
  const value =
    field === 'created_at' ? row.createdAt.toISOString() : field === 'name' ? row.name : row.status;
  return { value, id: row.id };
}
