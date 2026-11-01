// Redaction of audit documents (PLAT-7 plan 2.5; identity and tenancy §7: "before and after JSON
// (redacted of secrets)"). Applied to `before`, `after` and `reason` before anything is stored:
// secrets never reach core_audit_log, which no one can correct afterwards (append-only).

/**
 * Key tokens whose value is replaced at any depth (lead review round 1): a key is split into
 * tokens on `_`, `-`, `.` and camelCase boundaries, lower-cased, and redacted when any token is in
 * this set. Tokens, not substrings: `shipping_fee` stays (`pin` is not a token of it), while
 * `private_key`, `accessKey`, `signing-key` and `credentials` go. `key_id` and `idempotency_key`
 * are redacted too (harmless). Adversary M-2 extends the words and also compares the key with its
 * separators removed and each pair of adjacent tokens joined, so `api_key`, `apiKey`, `x-api-key`
 * and `apikey` all hit `apikey`.
 */
export const secretKeyTokens: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'secret',
  'secrets',
  'token',
  'tokens',
  'pin',
  'otp',
  'key',
  'keys',
  'ciphertext',
  'authorization',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  // Adversary M-2.
  'apikey',
  'keyid',
  'privatekey',
  'passcode',
  'session',
  'jwt',
  'bearer',
  'signature',
  'salt',
  'cvv',
  'iban',
]);

/** The lower-cased tokens of a key: split on `_`, `-`, `.` and camelCase (`APIKey` → api, key). */
export function keyTokens(key: string): string[] {
  return key
    .split(/[_\-.]+/)
    .flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+/g) ?? [])
    .map((token) => token.toLowerCase());
}

/**
 * Whether `key` names a secret: any token, any two adjacent tokens joined, or the whole key with
 * its separators removed is in `secretKeyTokens`.
 */
export function isSecretKey(key: string): boolean {
  const tokens = keyTokens(key);
  const candidates = [
    ...tokens,
    ...tokens.slice(1).map((token, index) => `${tokens[index] ?? ''}${token}`),
    tokens.join(''),
  ];
  return candidates.some((candidate) => secretKeyTokens.has(candidate));
}

/** A bearer credential or a JWT (three base64url parts, the header starting `eyJ`) (M-2). */
const bearerValue = /^bearer\s/i;
const jwtValue = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** Whether a string value is itself a credential, whatever its key. */
export function isSecretValue(value: string): boolean {
  const trimmed = value.trim();
  return bearerValue.test(trimmed) || jwtValue.test(trimmed);
}
export const redacted = '[redacted]';
export const maxStringLength = 2_000;
export const maxDocumentBytes = 32 * 1024;
/** Nesting kept; deeper values become `[too_deep]` (also ends any cycle). */
export const maxDepth = 32;

export type AuditJson =
  null | boolean | number | string | AuditJson[] | { readonly [key: string]: AuditJson };

/** A string cut to `maxStringLength` code points (never inside a surrogate pair). */
export function capString(value: string): string {
  if (value.length <= maxStringLength) return value;
  const points = Array.from(value);
  return points.length <= maxStringLength ? value : points.slice(0, maxStringLength).join('');
}

function redactValue(value: unknown, depth: number, seen: Set<object>): AuditJson | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case 'string':
      return isSecretValue(value) ? redacted : capString(value);
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
  if (depth >= maxDepth || seen.has(value)) return '[too_deep]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item: unknown) => redactValue(item, depth + 1, seen) ?? null);
    }
    // A plain record without a prototype; `__proto__` (an own property after JSON.parse) is dropped.
    const out = Object.create(null) as Record<string, AuditJson>;
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__') continue;
      if (isSecretKey(key)) {
        out[key] = redacted;
        continue;
      }
      const kept = redactValue(entry, depth + 1, seen);
      if (kept !== undefined) out[key] = kept;
    }
    return { ...out };
  } finally {
    seen.delete(value);
  }
}

/**
 * `value` as JSON fit for the audit log: every key naming a secret (`isSecretKey`) replaced by
 * `"[redacted]"` at any depth, strings capped at 2,000 characters, `__proto__` keys dropped, and the
 * whole document replaced by `{ truncated: true, bytes }` when its JSON exceeds 32 KB.
 */
export function redactForAudit(value: unknown): AuditJson {
  const clean = redactValue(value, 0, new Set()) ?? null;
  const bytes = Buffer.byteLength(JSON.stringify(clean), 'utf8');
  return bytes > maxDocumentBytes ? { truncated: true, bytes } : clean;
}

/** A free-text field (the support reason): capped, never a secret key to match. */
export function redactText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return isSecretValue(value) ? redacted : capString(value);
}
