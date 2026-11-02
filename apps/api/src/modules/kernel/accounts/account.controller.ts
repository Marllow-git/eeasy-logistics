import type { Account, AccountSettings } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { Controller, Get, HttpCode, Inject, Optional, Patch } from '@nestjs/common';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import type { AuditSink } from '../audit/audit-sink.js';
import type { RequestFacts } from '../auth/request-facts.js';
import { AuthRequest } from '../auth/request-facts.js';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation, sentBodyFields } from '../contract/contract-pipe.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { accountStoreOnPool } from '../platform/accounts.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import { presentAccount, presentSettings } from './account.presenter.js';
import { AccountService } from './account.service.js';

// The staff surface's `account` tag (PLAT-12 plan 2.2, 2.3): `getAccount`, `getAccountSettings`,
// `updateAccountSettings`. The account is the token's; nothing in a request names one (K-3).
// `x-permission` (`core.account.read`, `core.account.manage`) is enforced by PLAT-10's guard.

const getAccount = operationSchemas.getAccount;
const getSettings = operationSchemas.getAccountSettings;
const updateSettings = operationSchemas.updateAccountSettings;

@Controller('v1/staff/account')
export class AccountController {
  private readonly accounts: AccountService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    @Optional() @Inject(PLATFORM_POOL) pool?: Parameters<typeof accountStoreOnPool>[0],
  ) {
    this.accounts = new AccountService(accountStoreOnPool(pool ?? null), audit);
  }

  @Get()
  @Operation(getAccount)
  async get(@Input() _input: ContractInput<typeof getAccount>): Promise<Account> {
    return presentAccount(await this.accounts.read());
  }

  @Get('settings')
  @Operation(getSettings)
  async settings(@Input() _input: ContractInput<typeof getSettings>): Promise<AccountSettings> {
    return presentSettings(await this.accounts.settings());
  }

  /** A PATCH merge: only the fields the body sent replace the stored ones (plan 2.3). */
  @Patch('settings')
  @HttpCode(200)
  @Idempotent()
  @Operation(updateSettings)
  async update(
    @Input() input: ContractInput<typeof updateSettings>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<AccountSettings> {
    const settings = await this.accounts.updateSettings(input.body, sentBodyFields(input), facts);
    return presentSettings(settings);
  }
}
