import { headOf, redactText } from '../telemetry/redact.js';
import type { KindOutcome, OutboxRow, OutcomeError } from './kind-handlers.js';
import { parkedRetryS } from './connection-parker.js';
import { ProviderFailure } from './provider-failure.js';
import type { QueuePolicy } from './queue-options.js';
import { baseDelayMs, isFinalFailure, retryDelayMs } from './queue-options.js';

// The outcome of one execution as it is written back to the row (PLAT-8 plan 2.5; integrations
// §4.2, §4.4). Pure, so the rules are unit-tested; the queue worker does the writing.

/** `last_error` is at most this long. */
export const maxLastErrorLength = 500;
/** A provider's `Retry-After` is honoured up to a day. */
export const maxRetryAfterS = 24 * 60 * 60;
/** Retries that consume no attempt, at most; the next one is `dead` (adversary M-4). */
export const maxDeferrals = 50;
/** No retry comes sooner than a second (adversary M-4: `retry_after 0` must not loop). */
export const minRetryDelayMs = 1_000;

/**
 * A provider message fit for `last_error` (plan 2.5): the shared telemetry redactor (PLAT-14 plan
 * 2.4: credentials wherever they appear, values of secret- or personal-named fields, phone numbers
 * to their last four digits, emails masked, control characters dropped and spaces collapsed), cut
 * to 500 characters. The payload never reaches it: handlers pass the provider's answer only.
 */
export function redactErrorMessage(message: string): string {
  // Cut to 4 kB first, then redact (adversary A-1). Only the first 500 code points are kept, so a
  // run straddling the 4 kB edge never reaches the row; redacting the head whole keeps a long
  // message without spaces instead of dropping it as a cut tail (re-check A-1b).
  const clean = redactText(headOf(message)).trim();
  const points = Array.from(clean);
  return points.length <= maxLastErrorLength ? clean : points.slice(0, maxLastErrorLength).join('');
}

/** `last_error`: the provider status code, then the redacted message. */
export function formatLastError(error: OutcomeError): string {
  return redactErrorMessage(
    error.status === undefined ? error.message : `${String(error.status)} ${error.message}`,
  );
}

/**
 * The outcome of a thrown failure (integrations §4.2): `rate_limited` retries at the provider's
 * time without consuming an attempt; `unauthorised` is parked by the caller and retried in an hour
 * without consuming one; `permanent` is dead; anything else retries and consumes an attempt.
 */
export function failureOutcome(error: unknown): KindOutcome {
  if (error instanceof ProviderFailure) {
    const detail: OutcomeError = {
      message: error.message,
      ...(error.status === undefined ? {} : { status: error.status }),
    };
    switch (error.reason) {
      case 'rate_limited':
        return {
          outcome: 'retry',
          consumesAttempt: false,
          ...(error.retryAfterS === undefined ? {} : { retryAfterS: error.retryAfterS }),
          error: detail,
        };
      case 'unauthorised':
        return {
          outcome: 'retry',
          consumesAttempt: false,
          retryAfterS: parkedRetryS,
          error: detail,
        };
      case 'permanent':
        return { outcome: 'dead', error: detail };
      case 'transient':
        return { outcome: 'retry', consumesAttempt: true, error: detail };
    }
  }
  // An unexpected error: its class and message, redacted like a provider's.
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : 'unknown failure';
  return { outcome: 'retry', consumesAttempt: true, error: { message: `${name}: ${message}` } };
}

/** What the worker writes to the row. */
export type RowWrite =
  | { readonly status: 'done' }
  | { readonly status: 'superseded'; readonly lastError: string }
  | { readonly status: 'dead'; readonly attempts: number; readonly lastError: string }
  | {
      readonly status: 'enqueued';
      readonly attempts: number;
      readonly nextAttemptAt: Date;
      /** Null keeps the row's previous `last_error`. */
      readonly lastError: string | null;
      /** The consumers the row is parked for; null when the retry is not a park. */
      readonly parkedConsumers: readonly string[] | null;
      /** Retries so far that consumed no attempt. */
      readonly deferrals: number;
    };

const finiteSeconds = (value: number | undefined): number | undefined =>
  value === undefined || !Number.isFinite(value)
    ? undefined
    : Math.min(Math.max(value, 0), maxRetryAfterS);

/**
 * The row write for `outcome` (plan 2.5): a retry that consumes an attempt and reaches the kind's
 * budget (`policy.deadAfter`, by failures or by the row's age) is `dead` instead; a retry waits
 * the provider's `retryAfterS` (up to a day) or the kind's next backoff step with full jitter, and
 * stays `enqueued` (its job is moved to delayed, so successors stay held by the relay).
 */
export function resolveOutcome(
  row: Pick<OutboxRow, 'attempts' | 'createdAt' | 'deferrals'>,
  outcome: KindOutcome,
  policy: QueuePolicy,
  now: Date,
  random: () => number = Math.random,
): RowWrite {
  switch (outcome.outcome) {
    case 'done':
      return { status: 'done' };
    case 'superseded':
      return { status: 'superseded', lastError: formatLastError({ message: outcome.reason }) };
    case 'dead':
      return { status: 'dead', attempts: row.attempts, lastError: formatLastError(outcome.error) };
    case 'retry': {
      const attempts = row.attempts + (outcome.consumesAttempt ? 1 : 0);
      const lastError = outcome.error === undefined ? null : formatLastError(outcome.error);
      const ageMs = now.getTime() - row.createdAt.getTime();
      if (outcome.consumesAttempt && isFinalFailure(policy, attempts, ageMs)) {
        return { status: 'dead', attempts, lastError: lastError ?? 'retry budget spent' };
      }
      // A retry that consumes no attempt still ages out on the kind's time budget and stops after
      // 50 of them (adversary M-4), so a provider that keeps answering 429 cannot hold a row
      // forever.
      const deferrals = row.deferrals + (outcome.consumesAttempt ? 0 : 1);
      if (!outcome.consumesAttempt) {
        const aged = 'afterMs' in policy.deadAfter && ageMs >= policy.deadAfter.afterMs;
        if (aged || deferrals > maxDeferrals) {
          return {
            status: 'dead',
            attempts,
            lastError: lastError ?? (aged ? 'retry budget spent' : 'too many deferrals'),
          };
        }
      }
      const afterS = finiteSeconds(outcome.retryAfterS);
      // A provider's time is floored at the kind's first backoff step and a second.
      const floorMs = Math.max(minRetryDelayMs, baseDelayMs(policy.backoff, 1));
      const delayMs =
        afterS !== undefined
          ? Math.max(afterS * 1_000, floorMs)
          : retryDelayMs(policy.backoff, Math.max(attempts, 1), random);
      return {
        status: 'enqueued',
        attempts,
        nextAttemptAt: new Date(now.getTime() + delayMs),
        lastError,
        parkedConsumers: outcome.parked === undefined ? null : [...outcome.parked.consumers],
        deferrals,
      };
    }
  }
}
