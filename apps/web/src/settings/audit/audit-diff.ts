// The before-and-after of an audit entry (web §8 "Audit log"; WEB-3 plan 2.9): the keys whose
// value changed, each value printed for a person, never as raw JSON for a shape the screens know
// (roles, site kinds, statuses, opening hours, a point, reason codes, lists of ids). Pure and free
// of runtime imports so `node --test` runs it; the page hands in the locale's formatters and labels.

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

/** What the page supplies: the locale's number and date formats, labels, and how lists join. */
export interface AuditFormat {
  readonly number: (value: number) => string;
  readonly dateTime: (iso: string) => string;
  readonly boolean: (value: boolean) => string;
  /** The label of an enum value under a field (`roles` → `owner` → "Owner"), if there is one. */
  readonly enumLabel: (key: string, value: string) => string | undefined;
  /** A weekday's name, 0 for Sunday. */
  readonly weekday: (day: number) => string;
  readonly none: string;
  readonly separator: string;
}

const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function scalar(key: string, value: unknown, format: AuditFormat): string {
  if (value === null || value === undefined || value === '') return format.none;
  if (typeof value === 'boolean') return format.boolean(value);
  if (typeof value === 'number') return format.number(value);
  if (typeof value === 'string') {
    if (isoInstant.test(value)) return format.dateTime(value);
    return format.enumLabel(key, value) ?? value;
  }
  return JSON.stringify(value);
}

/** One value of field `key`, as a person reads it. */
export function auditValue(key: string, value: unknown, format: AuditFormat): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return format.none;
    return value.map((item) => auditItem(key, item, format)).join(format.separator);
  }
  if (isRecord(value)) {
    if (typeof value.lat === 'number' && typeof value.lng === 'number') {
      return `${format.number(value.lat)}, ${format.number(value.lng)}`;
    }
    return Object.entries(value)
      .map(
        ([inner, item]) =>
          `${format.enumLabel('fields', inner) ?? inner}: ${auditValue(inner, item, format)}`,
      )
      .join('; ');
  }
  return scalar(key, value, format);
}

function auditItem(key: string, item: unknown, format: AuditFormat): string {
  if (isRecord(item)) {
    // An opening window (sites) or a reason code (account settings).
    if (typeof item.weekday === 'number' && typeof item.opens === 'string') {
      const closes = typeof item.closes === 'string' ? item.closes : '';
      return `${format.weekday(item.weekday)} ${item.opens}–${closes}`;
    }
    if (typeof item.code === 'string') {
      const label = typeof item.label_ar === 'string' || typeof item.label_en === 'string';
      return label
        ? `${item.code} (${[item.label_ar, item.label_en].filter(Boolean).join(' / ')})`
        : item.code;
    }
    return auditValue(key, item, format);
  }
  return scalar(key, item, format);
}
