import type { DriverSite, DriverStatus, FieldProblem } from '../../kernel/public/index.js';
import { ApiException, normalisePhone, oneLineTextProblem } from '../../kernel/public/index.js';

// The rules of the staff driver doors' input (DEL-4 plan 2.2, 2.4; identity and tenancy §3.2):
// pure functions, unit-tested beside this file.

/** The longest driver name (as a site or member name, PLAT-12 2.5); the contract leaves it open. */
export const maxDriverNameLength = 120;

/** The problems of a create body's name and phone, and the E.164 phone when it parses. */
export function personProblems(input: { readonly name: string; readonly phone: string }): {
  readonly problems: FieldProblem[];
  readonly phone: string | undefined;
} {
  const problems: FieldProblem[] = [];
  const nameProblem = oneLineTextProblem('/body/name', input.name, maxDriverNameLength);
  if (nameProblem !== undefined) problems.push(nameProblem);
  const phone = normalisePhone(input.phone);
  if (phone === undefined) problems.push({ pointer: '/body/phone', code: 'invalid' });
  return { problems, phone };
}

/**
 * Why `site` cannot be a driver's home (plan 2.2): no site of the account (another account's
 * included) or an inactive one is a bad id (`400` at `/body/home_site_id`); a warehouse is `422
 * site_kind_mismatch`. Undefined when it can.
 */
export function homeSiteRefusal(site: DriverSite | undefined): ApiException | undefined {
  if (site?.status !== 'active') {
    return new ApiException('validation_failed', {
      fields: [{ pointer: '/body/home_site_id', code: 'invalid' }],
    });
  }
  if (site.kind === 'warehouse') {
    return new ApiException('site_kind_mismatch', {
      details: { site_id: site.id, kind: site.kind },
    });
  }
  return undefined;
}

/** The status arrows of `updateDriver` (plan 2.4): active ⇄ suspended, either → archived. */
export function statusChangeAllowed(from: DriverStatus, to: DriverStatus): boolean {
  if (from === to) return true;
  if (from === 'archived') return false;
  return true;
}

/**
 * `422 capacity_exceeded` when a new capacity limit is below the orders the driver holds (plan
 * 2.4); `active_orders` is D-10's counter, zero until DEL-6 keeps it.
 */
export function capacityRefusal(
  capacityLimit: number,
  activeOrders: number,
): ApiException | undefined {
  return capacityLimit < activeOrders
    ? new ApiException('capacity_exceeded', {
        details: { capacity_limit: capacityLimit, active_orders: activeOrders },
      })
    : undefined;
}

/**
 * Whether a driver matches the list's `q` (plan 2.4): the account's name for the driver, or the
 * phone's last digits.
 */
export function driverMatches(
  driver: { readonly name: string; readonly phone: string | null },
  q: string,
): boolean {
  if (driver.name.toLowerCase().includes(q.toLowerCase())) return true;
  const digits = q.replace(/[\s-]/g, '');
  return /^[0-9]{2,}$/.test(digits) && (driver.phone?.endsWith(digits) ?? false);
}
