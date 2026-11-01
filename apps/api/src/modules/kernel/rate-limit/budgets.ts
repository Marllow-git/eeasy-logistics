import type { Surface } from '../auth/surfaces.js';

// Rate-limit budgets (PLAT-6 plan 2.10; contracts README §7; identity and tenancy §8). Fixed
// windows of one minute. A surface budget covers every route of the surface unless the route has
// its own entry below, which then counts in a bucket of its own. Budgets per hour (sign-in, OTP,
// webhook subscriptions, recipient reschedules) arrive with the orders that build those routes;
// per-account overrides from the platform console are wave 2 (plan §6).

export const windowMs = 60_000;

/** Requests per minute per identity on each surface (README §7 defaults). */
export const surfaceBudgets: Readonly<Record<Surface, number>> = {
  staff: 600,
  platform: 300,
  driver: 300,
  recipient: 60,
  public: 600,
};

/** Per-route budgets per minute, keyed `<METHOD> <route template>` as Express matched it. */
export const routeBudgets: Readonly<Record<string, number>> = {
  'POST /v1/driver/locations': 12,
  'POST /v1/public/orders': 120,
};

export interface Budgets {
  readonly surfaces: Readonly<Record<Surface, number>>;
  readonly routes: Readonly<Record<string, number>>;
}

export const defaultBudgets: Budgets = { surfaces: surfaceBudgets, routes: routeBudgets };

export interface Budget {
  /** `all` for the surface budget, else the route key: the counter the request is charged to. */
  readonly bucket: string;
  readonly limit: number;
}

/**
 * The budget a request is charged to, or undefined when none applies: a path outside every
 * `/v1/<surface>` (the health probes) is not limited unless a route entry names it.
 */
export function budgetFor(
  surface: Surface | undefined,
  routeKey: string,
  budgets: Budgets = defaultBudgets,
): Budget | undefined {
  const route = Object.hasOwn(budgets.routes, routeKey) ? budgets.routes[routeKey] : undefined;
  if (route !== undefined) return { bucket: routeKey, limit: route };
  if (surface === undefined) return undefined;
  return { bucket: 'all', limit: budgets.surfaces[surface] };
}
