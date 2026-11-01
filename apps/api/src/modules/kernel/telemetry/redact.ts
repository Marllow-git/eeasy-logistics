import { keyHasToken, secretKeyTokens } from '../audit/redaction.js';

// The telemetry redactor (PLAT-14 plan 2.4; integrations §11 "Logging redaction"): every log
// argument, error message, span attribute string, Sentry event and `last_error` goes through it.
// It generalises the PLAT-7 audit rule (secret key tokens) with value patterns: credentials
// wherever they appear (tokens in URL paths too), phone numbers kept as their last four digits,
// email addresses masked.

export const redacted = '[redacted]';
/** Strings are cut to this many code points (a log line, a span attribute, an error message). */
export const maxTextLength = 2_000;
/** Nesting kept; deeper values become `[too_deep]` (also ends any cycle). */
export const maxDepth = 12;
/** Array items kept per array. */
export const maxItems = 50;

/**
 * Key tokens whose value never reaches telemetry, beyond the audit set (secrets): personal data
 * (phone, email, address text) and whole requests (headers, bodies, payloads). A key is split into
 * tokens as for the audit log (`keyTokens`): `recipient_phone`, `X-Api-Key`, `requestBody` all hit.
 */
export const telemetryKeyTokens: ReadonlySet<string> = new Set([
  ...secretKeyTokens,
  'phone',
  'phones',
  'mobile',
  'msisdn',
  'email',
  'emails',
  'mail',
  'address',
  'addresses',
  'body',
  'headers',
  'header',
  'payload',
  // OTP and verification codes; a bare `code` (an error or status code) stays.
  'otpcode',
  'verificationcode',
]);

/** Whether a key's value is withheld from telemetry (`telemetryKeyTokens`, by `keyHasToken`). */
export function isWithheldKey(key: string): boolean {
  return keyHasToken(key, telemetryKeyTokens);
}

const bearer = /\bbearer\s+[^\s,;"']+/gi;
/** `Basic <base64>` credentials (the PLAT-8 `last_error` rule). */
const basic = /\bbasic\s+[A-Za-z0-9+/=._~-]+/gi;
const digest =
  /\bdigest\s+[A-Za-z_-]+=(?:"[^"]*"|[^\s,]+)(?:\s*,\s*[A-Za-z_-]+=(?:"[^"]*"|[^\s,]+))*/gi;
/** URL user-info, `scheme://user:password@host`. */
const userInfo = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const jwt = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g;
/** A quoted value of a `name=` / `name:` pair (it may hold spaces and commas). */
const quotedPair = /(["']?)([A-Za-z][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)(["'])((?:(?!\4).)*)\4/g;
/**
 * `name=value`, `name: value`, `"name":"value"` and query-string pairs; a URL scheme (`https://`)
 * is not a pair, so the query string after it is still read pair by pair.
 */
const pair = /(["']?)([A-Za-z][A-Za-z0-9_.-]*)\1(\s*[:=](?!\/\/)\s*)(["']?)([^\s,;&"'}]+)\4/g;
const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
/**
 * Phone numbers: E.164 (`+` and 8 to 15 digits, spaces or dashes allowed between groups), the
 * `00` international prefix, and Saudi mobiles written without it (`9665XXXXXXXX`,
 * `05XXXXXXXX`). Bare digit runs are left alone: they are ids, counts and timestamps.
 */
const phone = /(?<![\w+])(?:(?:\+|00)[1-9](?:[ -]?\d){7,14}|9665\d{8}|05\d{8})(?![\w])/g;

/**
 * C0 controls and DEL become spaces and runs of spaces collapse to one: a value cannot forge a
 * second log line (the PLAT-8 `last_error` rule, now the only pass).
 */
function withoutControls(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : char;
  }
  return out.replace(/ {2,}/g, ' ');
}

/** A phone number reduced to its last four digits (integrations §11). */
export function maskPhone(match: string): string {
  const digits = match.replace(/\D/g, '');
  return `[phone …${digits.slice(-4)}]`;
}

/**
 * A run of URL path segments (`/a/b/c`), wherever it stands: a full URL, a path in an error
 * message, a route. Segments end at whitespace, `?`, `#`, quotes and list separators.
 */
const pathRun = /(?:\/[^\s/?#"'<>,;]*)+/g;
/** Path segments after one of these carry a provider's secret (integrations §3, the Zid path). */
const secretPathMarkers: ReadonlySet<string> = new Set([
  'webhook',
  'webhooks',
  'hooks',
  'callbacks',
]);
const uuidSegment = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jwtSegment = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const hexSegment = /^[0-9a-f]{32,}$/i;
const base64urlSegment = /^[A-Za-z0-9_-]{24,}$/;
/** A route template parameter (`:token`, `{token}`): a name, never a value. */
const templateSegment = /^(?::[A-Za-z_]\w*|\{[A-Za-z_]\w*\})$/;

/**
 * Whether a path segment has the shape of a token (integrations §11 "tokens in URLs"): a JWT, hex
 * of 32 or more, or base64url of 24 or more holding both a letter and a digit (a long kebab-case
 * route word has no digit; a UUID, the ids of our routes, is never a token).
 */
export function isTokenSegment(segment: string): boolean {
  if (uuidSegment.test(segment)) return false;
  if (jwtSegment.test(segment) || hexSegment.test(segment)) return true;
  return base64urlSegment.test(segment) && /\d/.test(segment) && /[A-Za-z]/.test(segment);
}

/** A path with token-shaped segments, and every segment after a webhook marker, redacted. */
function redactPath(path: string): string {
  let afterMarker = false;
  return path
    .split('/')
    .map((segment) => {
      if (segment === '' || templateSegment.test(segment)) return segment;
      if (afterMarker || isTokenSegment(segment)) return redacted;
      if (secretPathMarkers.has(segment.toLowerCase())) afterMarker = true;
      return segment;
    })
    .join('/');
}

/** An email address masked whole (the domain can name a merchant's customer). */
export const maskedEmail = '[email]';

/** `text` cut to `max` code points (never inside a surrogate pair). */
export function capText(text: string, max: number = maxTextLength): string {
  if (text.length <= max) return text;
  const points = Array.from(text);
  return points.length <= max ? text : `${points.slice(0, max).join('')}…`;
}

/**
 * Free text fit for telemetry: credentials removed wherever they appear (bearer, basic and digest
 * credentials, URL user-info, JWTs, token-shaped URL path segments and every segment after a
 * webhook path marker, values of secret- or personal-named `name=value` pairs), phone numbers kept
 * as their last four digits, email addresses masked, control characters replaced and spaces
 * collapsed, cut to `max` code points.
 */
export function redactText(text: string, max: number = maxTextLength): string {
  const withheld = (whole: string, q1: string, key: string, sep: string, q2: string) =>
    isWithheldKey(key) ? `${q1}${key}${q1}${sep}${q2}${redacted}${q2}` : whole;
  const clean = withoutControls(text)
    .replace(bearer, `Bearer ${redacted}`)
    .replace(digest, `Digest ${redacted}`)
    .replace(basic, `Basic ${redacted}`)
    .replace(userInfo, `$1${redacted}@`)
    .replace(jwt, redacted)
    .replace(pathRun, redactPath)
    .replace(quotedPair, withheld)
    .replace(pair, withheld)
    .replace(email, maskedEmail)
    .replace(phone, maskPhone);
  return capText(clean, max);
}

/** JSON-shaped telemetry data. */
export type TelemetryJson =
  null | boolean | number | string | TelemetryJson[] | { readonly [key: string]: TelemetryJson };

function redactAt(value: unknown, depth: number, seen: Set<object>): TelemetryJson | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return redactText(value);
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'boolean':
      return value;
    case 'bigint':
      return value.toString();
    case 'object':
      break;
    default:
      return undefined; // undefined, functions and symbols are not data
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Error) return describeError(value);
  if (depth >= maxDepth || seen.has(value)) return '[too_deep]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value
        .slice(0, maxItems)
        .map((item: unknown) => redactAt(item, depth + 1, seen) ?? null);
    }
    const out = Object.create(null) as Record<string, TelemetryJson>;
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__') continue;
      if (isWithheldKey(key)) {
        out[key] = redacted;
        continue;
      }
      const kept = redactAt(entry, depth + 1, seen);
      if (kept !== undefined) out[key] = kept;
    }
    return { ...out };
  } finally {
    seen.delete(value);
  }
}

/**
 * Any value fit for telemetry: keys naming a secret or personal data (`isWithheldKey`) replaced by
 * `"[redacted]"` at any depth, strings through `redactText`, errors as `{ type, message }`.
 */
export function redactValue(value: unknown): TelemetryJson {
  return redactAt(value, 0, new Set()) ?? null;
}

/** An error as telemetry may carry it: its class and its redacted message, never its fields. */
export function describeError(error: Error): { readonly type: string; readonly message: string } {
  return { type: error.name, message: redactText(error.message, 500) };
}
