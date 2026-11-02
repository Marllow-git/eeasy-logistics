import { ApiException } from '../errors/api-exception.js';
import type { RevocationReason, SessionSurface } from '../schema/identity.js';
import { getMetrics } from '../telemetry/metrics.js';
import type { CookieSurface } from './cookies.js';

// The sign-in counters (PLAT-11 plan 2.15; PLAT-14 catalogue): labels are the surface and an
// outcome or reason from a closed list, never a user, an email or a token.

export type LoginOutcome = 'ok' | 'second_factor' | 'invalid_credentials' | 'rate_limited';
export type RefreshMetricOutcome =
  | 'ok'
  | 'grace'
  | 'reuse_revoked'
  | 'invalid'
  /** A driver refresh from a revoked device (DEL-4 plan 2.8): the family is revoked too. */
  | 'device_revoked';

/**
 * Runs a password step and counts its outcome: what `outcomeOf` says on success, the refusal's
 * code for `invalid_credentials` and `rate_limited`; anything else is not a sign-in outcome.
 */
export async function countedLogin<T>(
  surface: CookieSurface,
  step: () => Promise<T>,
  outcomeOf: (result: T) => LoginOutcome,
): Promise<T> {
  try {
    const result = await step();
    getMetrics().add('auth_logins_total', 1, { surface, outcome: outcomeOf(result) });
    return result;
  } catch (error) {
    if (
      error instanceof ApiException &&
      (error.code === 'invalid_credentials' || error.code === 'rate_limited')
    ) {
      getMetrics().add('auth_logins_total', 1, { surface, outcome: error.code });
    }
    throw error;
  }
}

export function countRefresh(surface: SessionSurface, outcome: RefreshMetricOutcome): void {
  getMetrics().add('auth_refresh_total', 1, { surface, outcome });
}

export function countRevocations(reason: RevocationReason, families: number): void {
  if (families > 0) getMetrics().add('auth_family_revocations_total', families, { reason });
}
