import { ProviderFailure } from '../outbox/provider-failure.js';
import { retryAfterSeconds } from '../push/expo-push-sender.js';

// What the SPL and Sayyar sources share (INT-2 plan 2.11): one GET with a timeout, the mapping of
// an answer's status to PLAT-8's failure classes (as Hudhud's, plan 2.2), and the small readers of
// their loosely typed answers. A failure message never carries the URL (the SPL key travels in its
// query string), the code, the text or the point.

/** Integrations §2.2 and plan 2.11: 2 s per request for SPL and Sayyar. */
export const sourceTimeoutMs = 2_000;
/** Answers longer than this are not read. */
const maxAnswerBytes = 512 * 1024;

export interface SourceAnswer {
  readonly status: number;
  readonly body: string;
}

export interface SourceRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly fetch: typeof fetch;
  readonly now: () => Date;
}

export const badAnswer = () =>
  new ProviderFailure('transient', 'the geocoder answered in an unexpected shape', {
    status: 'BAD_RESPONSE',
  });

/** The failure of a non-2xx answer (plan 2.2, 2.11). */
export function geocoderFailure(status: number, retryAfter: number): ProviderFailure {
  if (status === 429) {
    return new ProviderFailure('rate_limited', 'the geocoder is rate limiting', {
      status,
      retryAfterS: retryAfter,
    });
  }
  if (status >= 500) return new ProviderFailure('transient', 'the geocoder failed', { status });
  if (status === 401 || status === 403) {
    return new ProviderFailure('unauthorised', 'the geocoder refused our key', { status });
  }
  return new ProviderFailure('permanent', 'the geocoder refused the request', { status });
}

/** Whether a failure is the source being unreachable (what a breaker counts, plan 2.11). */
export function isOutage(error: unknown): boolean {
  return (
    error instanceof ProviderFailure &&
    error.reason === 'transient' &&
    (error.status === 'TIMEOUT' || error.status === 'NETWORK')
  );
}

/**
 * One GET: the status and body of any answer the source gave; `notFoundStatus` answers are
 * returned as they are, every other non-2xx is thrown as its failure; no answer is a transient
 * `TIMEOUT` or `NETWORK`. No retry: the breaker and the next source take over.
 */
export async function getAnswer(
  request: SourceRequest,
  notFoundStatus?: number,
): Promise<SourceAnswer> {
  let response: Response;
  let body: string;
  try {
    response = await request.fetch(request.url, {
      method: 'GET',
      headers: request.headers,
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    body = await response.text();
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new ProviderFailure(
      'transient',
      timedOut ? 'the geocoder timed out' : 'the geocoder is unreachable',
      { status: timedOut ? 'TIMEOUT' : 'NETWORK' },
    );
  }
  if (response.status === notFoundStatus) return { status: response.status, body: '' };
  if (!response.ok) {
    throw geocoderFailure(
      response.status,
      retryAfterSeconds(response.headers.get('retry-after'), request.now()),
    );
  }
  return { status: response.status, body: body.length <= maxAnswerBytes ? body : '' };
}

/** The JSON of a body, or undefined. */
export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

/** A trimmed non-empty string (numbers as their text), else undefined. */
export function textOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** A coordinate from a number or a numeric string, inside its range, else undefined. */
export function coordinateOf(value: unknown, limit: 90 | 180): number | undefined {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d{1,3}(\.\d+)?$/.test(value.trim())
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : undefined;
}

/** "Al Olaya Dist." → "Al Olaya" (the National Address English district names). */
export const withoutDistSuffix = (name: string | undefined) =>
  name?.replace(/\s*Dist\.$/i, '').trim() || undefined;

/** "RIYADH" → "Riyadh", "AL KHOBAR" → "Al Khobar". */
export const titleCase = (name: string | undefined) =>
  name?.toLowerCase().replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase());

/** Joins the present parts with `separator`. */
export function joinParts(parts: readonly (string | undefined)[], separator: string): string {
  return parts.filter((part): part is string => part !== undefined && part !== '').join(separator);
}
