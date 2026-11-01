import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// The signing envelope of the Eeasy WhatsApp engine's internal API (ADR-0041; PLAT-9 plan 2A.1,
// 2A.2; engine contract §2): six `X-Eeasy-*` headers and an HMAC-SHA256 over an eight-line
// canonical string that carries the CLAIMED body hash, so a receiver can refuse an unauthenticated
// request from its headers alone, before it reads a body byte. Both directions use it: our commands
// to the engine (command secret) and the engine's callbacks to us (callback secret).

/** The engine's single command door (contract §1). */
export const engineCommandPath = '/internal/v1/commands';
/** Our callback door; the engine posts to this compiled path on its configured base (contract §1). */
export const engineCallbackPath = '/internal/whatsapp/v1/callbacks';
/** The engine's own service identity on callbacks (contract §2.1, direction B). */
export const engineServiceIdentity = 'eeasy-whatsapp-engine';
/** Both doors refuse a body above 256 KiB (contract §2.7). */
export const maxEngineBodyBytes = 262_144;
/** Accepted clock skew of `X-Eeasy-Timestamp`, either way (contract §2.4). */
export const freshnessSeconds = 60;

export const noncePattern = /^[0-9a-f]{32}$/;
export const bodyHashPattern = /^[0-9a-f]{64}$/;
const signaturePattern = /^v1=[0-9a-f]{64}$/;
/** RFC 3339 UTC with second precision and a `Z` (contract §2.1). */
const wireInstantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export interface CanonicalParts {
  readonly method: string;
  readonly path: string;
  readonly service: string;
  readonly keyId: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly bodySha256: string;
}

/** Contract §2.2: eight lines joined by one `\n`, no trailing newline. */
export function canonicalString(parts: CanonicalParts): string {
  return [
    'v1',
    parts.method.toUpperCase(),
    parts.path,
    parts.service,
    parts.keyId,
    parts.timestamp,
    parts.nonce,
    parts.bodySha256,
  ].join('\n');
}

/** `v1=<64 lowercase hex>`: HMAC-SHA256 of the canonical string (contract §2.1). */
export function signCanonical(canonical: string, secret: string): string {
  return `v1=${createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')}`;
}

/** SHA-256 of the raw body bytes, lowercase hex. */
export function bodySha256(raw: Buffer | string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** 32 lowercase hex characters from a CSPRNG, single use (contract §2.5). */
export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

/** `2026-11-01T10:00:00Z`. */
export function wireInstant(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/**
 * The epoch milliseconds of a strict wire instant (`Z`, second precision), or undefined: an offset,
 * fractional seconds, or a component that does not round-trip (`2026-02-30T…`) is refused.
 */
export function parseWireInstant(value: unknown): number | undefined {
  if (typeof value !== 'string' || !wireInstantPattern.test(value)) return undefined;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || wireInstant(ms) !== value) return undefined;
  return ms;
}

/** Contract §2.4: within ±60 s of the receiver's clock. */
export function isFresh(timestamp: string, nowMs: number): boolean {
  const ms = parseWireInstant(timestamp);
  return ms !== undefined && Math.abs(nowMs - ms) <= freshnessSeconds * 1000;
}

/**
 * Contract §2.3 step 6: the provided signature equals the expected one, compared in constant time.
 * The shape is checked first (a fixed length), so the comparison never depends on the input length.
 */
export function signatureMatches(expected: string, provided: string): boolean {
  if (!signaturePattern.test(provided) || !signaturePattern.test(expected)) return false;
  return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
}

export interface SigningKey {
  readonly service: string;
  readonly keyId: string;
  readonly secret: string;
}

/** The six `X-Eeasy-*` headers of one request; a fresh nonce and timestamp every time. */
export function signedHeaders(
  key: SigningKey,
  method: string,
  path: string,
  raw: Buffer | string,
  nowMs: number = Date.now(),
): Record<string, string> {
  const timestamp = wireInstant(nowMs);
  const nonce = newNonce();
  const hash = bodySha256(raw);
  const signature = signCanonical(
    canonicalString({
      method,
      path,
      service: key.service,
      keyId: key.keyId,
      timestamp,
      nonce,
      bodySha256: hash,
    }),
    key.secret,
  );
  return {
    'x-eeasy-service': key.service,
    'x-eeasy-key-id': key.keyId,
    'x-eeasy-timestamp': timestamp,
    'x-eeasy-nonce': nonce,
    'x-eeasy-body-sha256': hash,
    'x-eeasy-signature': signature,
  };
}
