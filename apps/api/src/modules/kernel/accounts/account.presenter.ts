import type { Account, AccountSettings } from '@eeasy-logistics/contracts/staff/schemas';
import { schemas } from '@eeasy-logistics/contracts/staff/schemas';
import type { AccountView } from './account.service.js';

// `Account` and `AccountSettings` (components.yaml) from the account service's values (PLAT-12
// plan 2.2, 2.3).

export function presentAccount(view: AccountView): Account {
  const { account } = view;
  return {
    id: account.id,
    created_at: account.createdAt.toISOString(),
    updated_at: account.updatedAt.toISOString(),
    name: account.name,
    country: 'SA',
    default_locale: account.defaultLocale,
    timezone: 'Asia/Riyadh',
    status: account.status,
    limits: { ...view.limits },
    usage: { ...view.usage },
    // Written by PLAT-13's provisioning door; an account seeded before it has none.
    ...(account.provisionedBy === null ? {} : { provisioned_by: account.provisionedBy }),
  };
}

/**
 * The effective settings through the contract's schema (plan 2.3): it keeps the documented keys
 * only and fails loudly on a stored value the contract does not allow.
 */
export function presentSettings(settings: Record<string, unknown>): AccountSettings {
  return schemas.GetAccountSettings200Response.parse(settings);
}
