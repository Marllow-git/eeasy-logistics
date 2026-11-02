// The security headers of every page (web §3.6, platform §8; WEB-2 plan 2.6), built per request by
// the proxy of each web application with a fresh nonce. The API, Sentry (/monitoring) and PostHog
// (/ingest) are on the page's own origin, so no third-party origin enters the policy; the object
// store's public origin is the only other source, and only when configured.

/** Where browsers send CSP violation reports (`report-to csp`, `Reporting-Endpoints`). */
export const cspReportPath = '/monitoring/csp';

export interface PolicyOptions {
  /** The per-request script nonce (base64). */
  readonly nonce: string;
  /** `NEXT_PUBLIC_STORAGE_ORIGIN`, or undefined for none. */
  readonly storageOrigin?: string | undefined;
  /** `next dev` only: React's development build evaluates code (`'unsafe-eval'`). */
  readonly development?: boolean;
}

/** A fresh nonce: 128 random bits from `crypto.randomUUID()`, base64 (Next.js CSP guide). */
export function newNonce(): string {
  return btoa(crypto.randomUUID());
}

/** The Content-Security-Policy value of web §3.6. */
export function contentSecurityPolicy(options: PolicyOptions): string {
  const storage = options.storageOrigin === undefined ? '' : ` ${options.storageOrigin}`;
  const evaluation = options.development === true ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'${evaluation}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${storage}`,
    `connect-src 'self'${storage}`,
    "worker-src 'self' blob:",
    "font-src 'self'",
    // The recipient group keeps 'none' too until the embed path reads the account's embed origins
    // (wave 2).
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    'report-to csp',
  ].join('; ');
}

export interface HeaderOptions {
  readonly policy: string;
  /** Strict-Transport-Security only in staging and production (HTTPS there). */
  readonly hsts: boolean;
  /** Recipient pages send no referrer at all (web §3.6). */
  readonly noReferrer: boolean;
}

/** Every security header a page response carries, the CSP included. */
export function securityHeaders(options: HeaderOptions): Record<string, string> {
  return {
    'Content-Security-Policy': options.policy,
    'Reporting-Endpoints': `csp="${cspReportPath}"`,
    ...(options.hsts ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {}),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': options.noReferrer ? 'no-referrer' : 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  };
}

/** One CSP violation reduced to what may be logged: the directive and the blocked origin. */
export interface CspViolation {
  readonly directive: string;
  /** The blocked resource's origin, or a CSP keyword (`inline`, `eval`, …), or `other`. */
  readonly blockedOrigin: string;
}

/** A browser sends one violation per report; a body of more is batched or forged (adversary M-2). */
const maxViolationsPerReport = 5;

const keywords = new Set(['inline', 'eval', 'data', 'blob', 'self', 'wasm-eval']);

function blockedOriginOf(value: unknown): string {
  if (typeof value !== 'string') return 'other';
  if (keywords.has(value)) return value;
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? 'other' : origin;
  } catch {
    return 'other';
  }
}

/**
 * The violations of a report body (the Reporting API's array of `csp-violation` reports, or the
 * older `{ "csp-report": … }` form), reduced to directive and origin: never the page URL, the
 * sample or anything else the browser sends (plan 2.6). At most five per body (adversary M-2); junk
 * gives none.
 */
export function cspViolations(body: string): CspViolation[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const reports: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const violations: CspViolation[] = [];
  for (const report of reports.slice(0, maxViolationsPerReport)) {
    if (typeof report !== 'object' || report === null) continue;
    const entry = report as Record<string, unknown>;
    const legacy = entry['csp-report'];
    const candidate = entry.type === 'csp-violation' ? entry.body : legacy;
    if (typeof candidate !== 'object' || candidate === null) continue;
    const fields = candidate as Record<string, unknown>;
    const rawDirective =
      fields.effectiveDirective ?? fields['effective-directive'] ?? fields['violated-directive'];
    const directive = typeof rawDirective === 'string' ? rawDirective.split(' ')[0] : undefined;
    if (directive === undefined || !/^[a-z-]{1,40}$/.test(directive)) continue;
    violations.push({
      directive,
      blockedOrigin: blockedOriginOf(fields.blockedURL ?? fields['blocked-uri']),
    });
  }
  return violations;
}
