import { isSecretKey, redactText, scrubUrl } from './redact';

// PostHog scrubbing for the web apps (PLAT-14 plan 2.8, web §9, §10.4): the `before_send` of
// posthog-js. Product events carry ids and enums only by type (each app's `src/analytics.ts`);
// this pass covers what the SDK adds itself: page URLs, paths, referrers and titles. Every URL
// keeps its origin and path with token segments as `:token` (so a recipient page view reads
// `/track/:token`), every other string is redacted, and person properties are dropped.

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const urlLike = /^(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|\/)/;

/**
 * Properties the SDK needs as they are: the project key PostHog routes on (public, the same value
 * the bundle carries) and the SDK's own random ids (distinct, device, session, window, insert).
 */
const sdkKeys = new Set([
  'token',
  'distinct_id',
  '$device_id',
  '$session_id',
  '$window_id',
  '$insert_id',
  '$anon_distinct_id',
]);

function scrubValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return urlLike.test(value) ? scrubUrl(value) : redactText(value);
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrubValue(item, depth + 1));
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !isSecretKey(key))
        .map(([key, item]) => [key, scrubValue(item, depth + 1)]),
    );
  }
  return value;
}

/** The structural part of posthog-js's `CaptureResult` this pass reads and returns. */
export interface AnalyticsCapture {
  event: string;
  properties: Json;
  $set?: Json;
  $set_once?: Json;
}

/**
 * posthog-js `before_send`: secret-named keys dropped, URLs rewritten, strings redacted,
 * `$set`/`$set_once` dropped.
 */
export function scrubAnalyticsEvent<Capture extends AnalyticsCapture>(
  capture: Capture | null,
): Capture | null {
  if (capture === null) return null;
  const properties: Json = {};
  for (const [key, value] of Object.entries(capture.properties)) {
    // The SDK's own ids first (`token` and `$session_id` would read as secret names), then
    // every other secret-named key is dropped, at any depth (lead review round 2).
    if (sdkKeys.has(key) && typeof value === 'string') properties[key] = value;
    else if (!isSecretKey(key)) properties[key] = scrubValue(value, 1);
  }
  const scrubbed = { ...capture, properties };
  delete scrubbed.$set;
  delete scrubbed.$set_once;
  return scrubbed;
}

/** Recipient pages (web §9): analytics there keeps no identity beyond the page (memory only). */
export function isRecipientPath(pathname: string): boolean {
  return /^\/(?:embed\/)?(?:track|reschedule|pin)(?:\/|$)/.test(pathname);
}
