import type { FieldProblem } from '../errors/api-exception.js';
import { canonicalJson } from '../idempotency/request-hash.js';

// Account settings (PLAT-12 plan 2.3; components.yaml `AccountSettings`; domain model D-3, D-7,
// D-14, W-15, W-16). `core_accounts.settings` holds the keys a merchant has set, under the
// contract's own names; every read applies the defaults below. A change is a PATCH merge: a key
// sent replaces the stored value, a key not sent keeps it. The contract's schema has already
// checked each field's shape; these are the rules it cannot say.

/** A settings document under the contract's names (`intake_rule`, `max_attempts`, ...). */
export type SettingsDocument = Readonly<Record<string, unknown>>;

/** What an account that set nothing reads (plan 2.3: the contract's defaults and the plan's). */
export const accountSettingsDefaults: SettingsDocument = Object.freeze({
  intake_rule: 'receive_as_pending',
  max_attempts: 3,
  proof_policy: Object.freeze({ delivery: [], cod: [] }),
  reason_codes: [],
  auto_dispatch: Object.freeze({ enabled: false }),
  second_factor_required: false,
  allowed_cod_methods: ['cash'],
  embed_origins: [],
  offline_window_hours: 12,
});

/** Objects whose own defaults apply key by key (a stored `auto_dispatch` without `enabled`). */
const nestedDefaults = ['proof_policy', 'auto_dispatch'] as const;

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The stored settings over the defaults; a malformed document reads as the defaults alone. */
export function effectiveSettings(stored: unknown): Record<string, unknown> {
  const document = objectOf(stored) ?? {};
  const settings: Record<string, unknown> = { ...accountSettingsDefaults, ...document };
  for (const key of nestedDefaults) {
    settings[key] = { ...objectOf(accountSettingsDefaults[key]), ...objectOf(document[key]) };
  }
  return settings;
}

export const maxReasonCodes = 100;
const reasonCodePattern = /^[a-z0-9_]{2,40}$/;
const maxLabelLength = 80;
/** CR, LF, NEL, LINE SEPARATOR, PARAGRAPH SEPARATOR: a label stays on one line. */
const lineBreak = new RegExp(`[\r\n${String.fromCodePoint(0x85, 0x2028, 0x2029)}]`);

function labelProblem(pointer: string, value: unknown): FieldProblem | undefined {
  if (typeof value !== 'string') return { pointer, code: 'invalid' };
  const length = Array.from(value).length;
  if (length === 0) return { pointer, code: 'too_short' };
  if (length > maxLabelLength) return { pointer, code: 'too_long' };
  if (lineBreak.test(value)) return { pointer, code: 'invalid' };
  return undefined;
}

/**
 * The rules of plan 2.3 beyond the contract's schema, for the fields of `patch`: at most 100 reason
 * codes, each code `^[a-z0-9_]{2,40}$` and unique, each label 1 to 80 characters on one line;
 * `allowed_cod_methods` holds `cash` only until ADR-0017's owner gate (code `owner_gate`).
 */
export function settingsProblems(patch: SettingsDocument): FieldProblem[] {
  const problems: FieldProblem[] = [];
  const reasonCodes = patch.reason_codes;
  if (Array.isArray(reasonCodes)) {
    if (reasonCodes.length > maxReasonCodes) {
      problems.push({ pointer: '/body/reason_codes', code: 'invalid' });
    }
    const seen = new Set<string>();
    reasonCodes.forEach((entry: unknown, index) => {
      const at = `/body/reason_codes/${index}`;
      const reason = objectOf(entry) ?? {};
      const code = reason.code;
      if (typeof code !== 'string' || !reasonCodePattern.test(code) || seen.has(code)) {
        problems.push({ pointer: `${at}/code`, code: 'invalid' });
      }
      if (typeof code === 'string') seen.add(code);
      for (const label of ['label_ar', 'label_en'] as const) {
        const problem = labelProblem(`${at}/${label}`, reason[label]);
        if (problem !== undefined) problems.push(problem);
      }
    });
  }
  const codMethods = patch.allowed_cod_methods;
  // Digital COD methods wait for the owner gate of ADR-0017; until then only cash is accepted.
  if (Array.isArray(codMethods) && codMethods.some((method) => method !== 'cash')) {
    problems.push({ pointer: '/body/allowed_cod_methods', code: 'owner_gate' });
  }
  return problems;
}

/** A settings change: the document to store and the audit's before and after. */
export interface SettingsChange {
  /** The stored document after the merge (only keys ever set, no defaults). */
  readonly stored: Record<string, unknown>;
  /** The keys whose effective value changed; empty when the patch changes nothing. */
  readonly changed: readonly string[];
  /** Effective values of the changed keys before and after (K-7; identity and tenancy §6). */
  readonly before: Record<string, unknown>;
  readonly after: Record<string, unknown>;
}

/**
 * Merges the `sent` fields of `patch` over `stored` (plan 2.3). A field the client did not send is
 * ignored even when `patch` holds a value for it: the contract's schema fills its defaults.
 */
export function mergeSettings(
  stored: unknown,
  patch: SettingsDocument,
  sent: readonly string[],
): SettingsChange {
  const current = objectOf(stored) ?? {};
  const merged: Record<string, unknown> = { ...current };
  for (const key of sent) {
    if (Object.hasOwn(patch, key)) merged[key] = patch[key];
  }
  const was = effectiveSettings(current);
  const will = effectiveSettings(merged);
  const changed = sent.filter(
    (key) => Object.hasOwn(patch, key) && canonicalJson(was[key]) !== canonicalJson(will[key]),
  );
  return {
    stored: merged,
    changed,
    before: Object.fromEntries(changed.map((key) => [key, was[key] ?? null])),
    after: Object.fromEntries(changed.map((key) => [key, will[key] ?? null])),
  };
}
