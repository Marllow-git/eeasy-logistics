// The before-and-after of a console audit entry (WEB-4 plan 2.7, 2.11; WEB-3's disclosure rule:
// the keys whose value changed, each value printed for a person, not as raw JSON where a scalar
// will do). WEB-3's `audit-diff.ts` lives in apps/web and formats the merchant's settings shapes;
// the console's entries are platform shapes (status, role, mode, counts, ids), so this is the
// small duplicate the plan allows (2.7), with no runtime imports so `node --test` runs it.

export type AuditValues = Record<string, unknown> | null | undefined;

export interface ChangedField {
  readonly key: string;
  readonly before: unknown;
  readonly after: unknown;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The keys of `before` and `after` whose values differ, in the order they first appear. */
export function changedFields(before: AuditValues, after: AuditValues): ChangedField[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys
    .map((key) => ({ key, before: before?.[key], after: after?.[key] }))
    .filter((field) => !same(field.before, field.after));
}

export interface AuditFormat {
  readonly number: (value: number) => string;
  readonly boolean: (value: boolean) => string;
  readonly none: string;
  readonly separator: string;
}

/** One value as a person reads it: scalars as words and numbers, a list joined, a record as JSON. */
export function auditValue(value: unknown, format: AuditFormat): string {
  if (value === null || value === undefined || value === '') return format.none;
  if (typeof value === 'boolean') return format.boolean(value);
  if (typeof value === 'number') return format.number(value);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.length === 0
      ? format.none
      : value.map((item) => auditValue(item, format)).join(format.separator);
  }
  return JSON.stringify(value);
}

/** The catalogue key of an audit action (`core.account.suspended` → `core_account_suspended`). */
export function actionKey(action: string | undefined): string {
  return (action ?? '').replaceAll('.', '_');
}
