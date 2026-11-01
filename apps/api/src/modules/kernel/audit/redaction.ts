// Redaction of audit documents (PLAT-7 plan 2.5; identity and tenancy §7: "before and after JSON
// (redacted of secrets)"). Applied to `before`, `after` and `reason` before anything is stored:
// secrets never reach core_audit_log, which no one can correct afterwards (append-only).

/** Keys whose value is replaced at any depth. Matched anywhere in the key, case-insensitive. */
export const secretKeyPattern =
  /(password|secret|token|pin|otp|api_key|key_id|ciphertext|authorization|cookie)/i;
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
      return capString(value);
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
      if (secretKeyPattern.test(key)) {
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
 * `value` as JSON fit for the audit log: every key matching `secretKeyPattern` replaced by
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
  return value === null || value === undefined ? null : capString(value);
}
