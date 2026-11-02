// Account limits (PLAT-12 plan 2.2, 2.13; domain model §2.1; Q-33). `core_accounts.limits` holds
// what PLAT-13's provisioning door set; a key it lacks reads as the default below, so an account
// provisioned before PLAT-13 reads sanely. A product rule until Q-33 is answered, so code, not
// configuration (plan 2.13).

export const limitKeys = ['orders_per_month', 'drivers', 'sites', 'api_keys'] as const;
export type LimitKey = (typeof limitKeys)[number];
export type AccountLimitValues = Readonly<Record<LimitKey, number>>;

/** Plan §7 #1 (provisional owner default): what an account may use when nothing else is set. */
export const defaultAccountLimits: AccountLimitValues = Object.freeze({
  orders_per_month: 5000,
  drivers: 25,
  sites: 5,
  api_keys: 5,
});

/**
 * The stored limits over the defaults: a key holding a non-negative integer wins, anything else
 * (absent, malformed, unknown key) leaves the default.
 */
export function effectiveLimits(stored: unknown): AccountLimitValues {
  const document =
    stored !== null && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const limits: Record<LimitKey, number> = { ...defaultAccountLimits };
  for (const key of limitKeys) {
    const value = document[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) limits[key] = value;
  }
  return Object.freeze(limits);
}
