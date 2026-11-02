import { getContext, getUnitOfWork } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import type { RequestFacts } from '../auth/request-facts.js';
import { ApiException } from '../errors/api-exception.js';
import type { AccountRecord, AccountStore } from '../platform/accounts.repository.js';
import { SitesRepository } from '../sites/sites.repository.js';
import type { AccountLimitValues } from './limits.js';
import { effectiveLimits } from './limits.js';
import type { SettingsDocument } from './settings.js';
import { effectiveSettings, mergeSettings, settingsProblems } from './settings.js';
import { UsageCountersRepository } from './usage.repository.js';

// The account doors of the staff surface (PLAT-12 plan 2.2, 2.3): the caller's account with its
// limits and usage, its settings, and the settings change. The account is always the token's
// (`getContext()`, ADR-0025, K-3). `core_accounts` is read and written on the platform pool
// (elx_app may only read it, review M-3); usage comes from the tenant tables in the request's own
// unit of work. The platform transaction never waits on the app pool, so a request holding its
// app connection while it waits for a platform one cannot close a cycle (PLAT-11 8.2 #29).

/** The request facts an audit row carries. */
export type AuditFacts = Pick<RequestFacts, 'requestId' | 'clientRequestId' | 'ip' | 'userAgent'>;

export interface AccountView {
  readonly account: AccountRecord;
  readonly limits: AccountLimitValues;
  readonly usage: AccountLimitValues;
}

export class AccountService {
  constructor(
    private readonly store: AccountStore | null,
    private readonly audit: AuditSink,
  ) {}

  private requireStore(): AccountStore {
    if (this.store === null) {
      new Logger('Accounts').warn('DATABASE_URL_PLATFORM is not set: the account doors answer 500');
      throw new ApiException('internal_error');
    }
    return this.store;
  }

  private async account(accountId: string): Promise<AccountRecord> {
    const account = await this.requireStore().run((accounts) => accounts.find(accountId));
    // The token's account exists (sign-in pinned it); a missing row is not the caller's fault.
    if (account === undefined) throw new Error('The account of the token has no row');
    return account;
  }

  /** `getAccount`: the row, the limits over their defaults and the usage counted now (plan 2.2). */
  async read(): Promise<AccountView> {
    const account = await this.account(getContext().accountId);
    const uow = getUnitOfWork();
    const usage: AccountLimitValues = {
      orders_per_month: await new UsageCountersRepository(uow).thisMonth('orders'),
      // Active driver memberships once DEL-4 creates them; none exist before.
      drivers: 0,
      sites: await new SitesRepository(uow).countActive(),
      // API keys arrive in wave 4.
      api_keys: 0,
    };
    return { account, limits: effectiveLimits(account.limits), usage };
  }

  /** `getAccountSettings`: the stored settings over their defaults (plan 2.3). */
  async settings(): Promise<Record<string, unknown>> {
    const account = await this.account(getContext().accountId);
    return effectiveSettings(account.settings);
  }

  /**
   * `updateSettings` (plan 2.3): the `sent` fields of `patch` replace the stored ones under the
   * account row's lock, `version + 1`, and one audit row with the changed keys' before and after
   * in the same transaction (K-7). A patch that changes nothing writes nothing.
   */
  async updateSettings(
    patch: SettingsDocument,
    sent: readonly string[],
    facts: AuditFacts,
  ): Promise<Record<string, unknown>> {
    const sentPatch = Object.fromEntries(
      sent.filter((key) => Object.hasOwn(patch, key)).map((key) => [key, patch[key]]),
    );
    const problems = settingsProblems(sentPatch);
    if (problems.length > 0) throw new ApiException('validation_failed', { fields: problems });
    const context = getContext();
    return this.requireStore().run(async (accounts) => {
      const account = await accounts.find(context.accountId, { lock: true });
      if (account === undefined) throw new Error('The account of the token has no row');
      const change = mergeSettings(account.settings, patch, sent);
      if (change.changed.length === 0) return effectiveSettings(account.settings);
      const written = await accounts.writeSettings(context.accountId, change.stored);
      await this.audit.record({
        actorType: 'user',
        actorId: context.userId,
        accountId: context.accountId,
        targetType: 'account',
        targetId: context.accountId,
        action: 'core.account.settings_updated',
        before: change.before,
        after: change.after,
        requestId: facts.requestId,
        clientRequestId: facts.clientRequestId,
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
      return effectiveSettings(written.settings);
    });
  }
}
