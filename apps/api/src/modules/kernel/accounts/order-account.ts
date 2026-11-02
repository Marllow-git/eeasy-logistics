import type { UnitOfWork } from '@eeasy-logistics/db';
import { getContext } from '@eeasy-logistics/db';
import type { FactoryProvider } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ApiException } from '../errors/api-exception.js';
import type { AccountStore } from '../platform/accounts.repository.js';
import { accountStoreOnPool } from '../platform/accounts.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import { effectiveLimits } from './limits.js';
import { effectiveSettings } from './settings.js';
import { UsageCountersRepository } from './usage.repository.js';

// What Delivery's order intake reads of the token's account (DEL-2 plan 2.3, 2.6; PLAT-12
// `effectiveSettings`, `effectiveLimits`): the intake rule, `max_attempts` (D-14), the reason codes
// and the monthly order limit, read on the platform pool as `AccountService` does (elx_app may only
// read `core_accounts`; no lock, so it waits on nothing the request's app transaction holds). The
// monthly order count is charged in the request's own unit of work, in the order's transaction:
// a rolled-back create gives it back.

export type IntakeRule = 'receive_as_pending' | 'auto_accept';

export interface OrderAccount {
  readonly intakeRule: IntakeRule;
  readonly maxAttempts: number;
  /** The account's reason codes (`reason_codes[].code`). */
  readonly reasonCodes: readonly string[];
  /** `limits.orders_per_month` over the code default. */
  readonly ordersPerMonth: number;
}

/** The settings document's values, each falling back to its default when malformed. */
export function orderAccountOf(settings: unknown, limits: unknown): OrderAccount {
  const effective = effectiveSettings(settings);
  const maxAttempts = effective.max_attempts;
  const reasonCodes = Array.isArray(effective.reason_codes) ? effective.reason_codes : [];
  return {
    intakeRule: effective.intake_rule === 'auto_accept' ? 'auto_accept' : 'receive_as_pending',
    maxAttempts:
      typeof maxAttempts === 'number' && Number.isInteger(maxAttempts) && maxAttempts >= 1
        ? Math.min(maxAttempts, 32_767)
        : 3,
    // A code switched off (`active: false`) stays on old events but is not offered again (DEL-2 E).
    reasonCodes: reasonCodes
      .map((entry: unknown) =>
        entry !== null &&
        typeof entry === 'object' &&
        (entry as Record<string, unknown>).active !== false
          ? (entry as Record<string, unknown>).code
          : undefined,
      )
      .filter((code): code is string => typeof code === 'string'),
    ordersPerMonth: effectiveLimits(limits).orders_per_month,
  };
}

export class OrderAccounts {
  readonly #store: AccountStore | null;

  constructor(store: AccountStore | null) {
    this.#store = store;
  }

  /** The token's account as the order doors read it. */
  async current(): Promise<OrderAccount> {
    if (this.#store === null) {
      new Logger('OrderAccounts').warn(
        'DATABASE_URL_PLATFORM is not set: the order doors answer 500',
      );
      throw new ApiException('internal_error');
    }
    const accountId = getContext().accountId;
    const account = await this.#store.run((accounts) => accounts.find(accountId));
    if (account === undefined) throw new Error('The account of the token has no row');
    return orderAccountOf(account.settings, account.limits);
  }

  /**
   * Counts one order of this month in `uow` (the row lock of the counter held to commit) and
   * refuses `422 limit_exceeded` past `limit`; the refusal rolls the count back with the order.
   */
  async chargeOrder(uow: UnitOfWork, limit: number): Promise<void> {
    const count = await new UsageCountersRepository(uow).increment('orders');
    if (count > limit) {
      throw new ApiException('limit_exceeded', {
        details: { metric: 'orders_per_month', limit },
      });
    }
  }
}

export const orderAccountsProvider: FactoryProvider<OrderAccounts> = {
  provide: OrderAccounts,
  inject: [{ token: PLATFORM_POOL, optional: true }],
  useFactory: (pool: Parameters<typeof accountStoreOnPool>[0] | undefined) =>
    new OrderAccounts(accountStoreOnPool(pool ?? null)),
};
