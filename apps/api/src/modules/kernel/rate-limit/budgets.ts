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

/** A budget a service charges by name to an identity it chooses (a phone, an address). */
export interface NamedBudget {
  readonly limit: number;
  readonly windowMs: number;
}

const hourMs = 3_600_000;
const dayMs = 24 * hourMs;

/** The global hourly OTP request budget unless `OTP_GLOBAL_HOURLY_BUDGET` says otherwise. */
export const defaultOtpGlobalHourly = 500;

/**
 * Named budgets (PLAT-9 plan 2.4; identity and tenancy §3.2, §8): charged by the service that knows
 * the stable identity, which a guard cannot read before the body is parsed and normalised. OTP
 * requests: 5 per E.164 phone and 20 per client address in a fixed hour, 20 per phone a day, and
 * 500 an hour across the platform (adversary M-1: bounds how many messages the platform number
 * sends to numbers that are no one's driver, before PLAT-11 looks the phone up).
 */
export const namedBudgets = {
  otp_request_phone: { limit: 5, windowMs: hourMs },
  otp_request_phone_day: { limit: 20, windowMs: dayMs },
  otp_request_ip: { limit: 20, windowMs: hourMs },
  otp_request_global: { limit: defaultOtpGlobalHourly, windowMs: hourMs },
  // Sign-in doors (PLAT-11 plan 2.11, owner question 4): keyed by the lower-cased email (a
  // pseudonym, never the address) and by the client address, the email charged first.
  login_email: { limit: 10, windowMs: hourMs },
  login_ip: { limit: 50, windowMs: hourMs },
  // `platformLogin` counts apart from the staff door (plan 2.11: the same 10 and 50).
  platform_login_email: { limit: 10, windowMs: hourMs },
  platform_login_ip: { limit: 50, windowMs: hourMs },
  password_reset_email: { limit: 3, windowMs: hourMs },
  password_reset_ip: { limit: 20, windowMs: hourMs },
  /** Accept an invitation, confirm a reset, redeem an enrolment link, select an account. */
  auth_token_ip: { limit: 20, windowMs: hourMs },
  session_refresh_ip: { limit: 60, windowMs },
} as const satisfies Record<string, NamedBudget>;

/** The named budgets with the configured global OTP budget (`OTP_GLOBAL_HOURLY_BUDGET`). */
export function namedBudgetsWith(otpGlobalHourly: number): Record<NamedBudgetName, NamedBudget> {
  return { ...namedBudgets, otp_request_global: { limit: otpGlobalHourly, windowMs: hourMs } };
}

export type NamedBudgetName = keyof typeof namedBudgets;

export interface Budgets {
  readonly surfaces: Readonly<Record<Surface, number>>;
  readonly routes: Readonly<Record<string, number>>;
  /** Defaults to `namedBudgets` when a test passes only surface and route budgets. */
  readonly named?: Readonly<Record<NamedBudgetName, NamedBudget>>;
}

export const defaultBudgets: Budgets = {
  surfaces: surfaceBudgets,
  routes: routeBudgets,
  named: namedBudgets,
};

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
