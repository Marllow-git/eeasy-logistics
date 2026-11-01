// Text and URL redaction for what the web apps send to Sentry and PostHog (PLAT-14 plan 2.7, 2.8;
// web §9, §10.4; integrations §11). The API has its own redactor (apps/api telemetry/redact.ts); the
// browser bundle cannot import it, so this is the web apps' smaller copy of the same rules: no
// phone number, email, token, JWT, credential or recipient token path segment leaves the browser
// or the Next.js server in an error report or an analytics event.
//
// Every pattern starts behind a lookbehind, so a run of characters is tried from its start only,
// and the input is cut to `maxInputLength` first: the cost is linear in a bounded input (the
// API's adversary finding A-1 was quadratic backtracking on long runs).

/** Longest text the patterns ever see; the rest is dropped before any pattern runs. */
export const maxInputLength = 4096;

/** Path segments whose next segment is a secret: recipient and invitation tokens (web §9, §1.1). */
const tokenMarkers = new Set([
  'track',
  'reschedule',
  'pin',
  'invitations',
  'password-reset',
  'reset-password',
]);

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path segment shaped like a secret: 20 or more token characters with a letter and a digit. */
function looksLikeToken(segment: string): boolean {
  return (
    segment.length >= 20 &&
    /^[A-Za-z0-9_.~%-]+$/.test(segment) &&
    /[0-9]/.test(segment) &&
    /[A-Za-z]/.test(segment) &&
    !uuid.test(segment)
  );
}

/** A path segment that is a phone number (`wa.me/9665…`): international, Saudi 9665…, 05…. */
const phoneSegment = /^(?:(?:\+|00|%2B)\d{8,15}|9665\d{8}|05\d{8})$/i;

/**
 * Rewrites token segments of a path to `:token` and phone segments to `:phone`; route templates
 * (`[token]`) stay.
 */
export function scrubPath(path: string): string {
  const segments = path.split('/');
  return segments
    .map((segment, index) => {
      if (segment === '' || segment.startsWith('[') || segment.startsWith(':')) return segment;
      const previous = segments[index - 1];
      if (previous !== undefined && tokenMarkers.has(previous.toLowerCase())) return ':token';
      if (phoneSegment.test(segment)) return ':phone';
      return looksLikeToken(segment) ? ':token' : segment;
    })
    .join('/');
}

/**
 * The origin and path of a URL with token segments rewritten; the query string, the fragment and
 * any user-info are dropped (they carry phone numbers, codes and tokens). A relative URL keeps its
 * path only.
 */
export function scrubUrl(url: string): string {
  const input = url.length > maxInputLength ? url.slice(0, maxInputLength) : url;
  const match = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\s]*)?([^?#\s]*)/.exec(input);
  const origin = (match?.[1] ?? '').replace(/\/\/[^/@]*@/, '//');
  return origin + scrubPath(match?.[2] ?? '');
}

/** Cuts `text` to `maxInputLength`, dropping the run of non-space characters at the cut. */
function cut(text: string): string {
  if (text.length <= maxInputLength) return text;
  let end = maxInputLength;
  while (end > 0 && !/\s/.test(text[end - 1] ?? '')) end -= 1;
  return `${text.slice(0, end)}…`;
}

function maskPhone(match: string): string {
  const digits = match.replace(/\D/g, '');
  return `[phone …${digits.slice(-4)}]`;
}

const replacements: readonly [RegExp, string | ((match: string, ...groups: string[]) => string)][] =
  [
    // URLs and absolute paths: origin and path only, token segments rewritten.
    [/(?<![\w/:.@-])(?:[A-Za-z][A-Za-z0-9+.-]*:\/\/|\/)[^\s"'<>()]*/g, (match) => scrubUrl(match)],
    // JWTs.
    [/(?<![\w-])eyJ[\w-]*\.[\w-]*\.[\w-]*/g, '[jwt]'],
    // Authorization schemes.
    [/\b(Bearer|Basic|Digest|Token)\s+[\w.~+/=-]+/gi, '$1 [redacted]'],
    // Secret pairs in text, query strings and JSON.
    [
      /(?<![\w-])((?:access_|refresh_|id_|recipient_|api_?)?(?:token|key|secret|password|passwd|otp|otp_code|verification_code|signature|sig|session|cookie|authorization))("?\s*[=:]\s*"?)[^\s&"',;]+/gi,
      '$1$2[redacted]',
    ],
    // Email addresses.
    [/(?<![\w.%+-])[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
    // Phone numbers: international (+ or 00), Saudi 9665…, Saudi local 05….
    [/(?<![\d+])(?:\+|00)\d[\d\s-]{6,16}\d(?!\d)/g, maskPhone],
    [/(?<![\d+])9665\d{8}(?!\d)/g, maskPhone],
    [/(?<!\d)05\d{8}(?!\d)/g, maskPhone],
    // Long token-shaped runs (base64url, hex) with a letter and a digit; UUIDs are ids and stay.
    [
      /(?<![\w-])[A-Za-z0-9_-]{20,}(?![\w-])/g,
      (match) => (looksLikeToken(match) ? '[token]' : match),
    ],
  ];

/** `text` with phones, emails, tokens, JWTs, credentials and token path segments redacted. */
export function redactText(text: string): string {
  let result = cut(text);
  for (const [pattern, replacement] of replacements) {
    result =
      typeof replacement === 'string'
        ? result.replace(pattern, replacement)
        : result.replace(pattern, replacement as (match: string, ...rest: unknown[]) => string);
  }
  return result;
}
