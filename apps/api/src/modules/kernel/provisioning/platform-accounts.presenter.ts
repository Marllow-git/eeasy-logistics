import type { Account } from '@eeasy-logistics/contracts/platform/schemas';
import { presentAccount } from '../accounts/account.presenter.js';
import type { AccountView } from '../accounts/account.service.js';
import { effectiveLimits } from '../accounts/limits.js';
import type { AccountRecord } from '../platform/accounts.repository.js';

// `Account` (components.yaml) on the platform surface (PLAT-13 plan 2.2, 2.4): PLAT-12's presenter
// for one account (limits over their defaults, usage), and the list item, which carries no `usage`
// (counting it per row is refused by plan 2.4; the contract leaves `usage` optional).

export function presentPlatformAccount(view: AccountView): Account {
  return presentAccount(view);
}

export function presentListedAccount(account: AccountRecord): Account {
  const item = presentAccount({
    account,
    limits: effectiveLimits(account.limits),
    usage: effectiveLimits({}),
  });
  delete item.usage;
  return item;
}
