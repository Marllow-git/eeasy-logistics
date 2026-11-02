// The date filters of the console's lists (WEB-4 plan 2.8, 2.11; WEB-3's audit-keys rule): the
// URL holds calendar days (`YYYY-MM-DD`) as the reader picks them; the call sends instants at
// Riyadh midnight, `created_to` the day after (the API's upper bound is exclusive), so "to"
// includes its whole day. A malformed value is left out. No runtime imports: `node --test` runs it.

const day = /^\d{4}-\d{2}-\d{2}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` is a whole UUID (the API's id filters). */
export const isUuid = (value: string | undefined): value is string =>
  value !== undefined && uuid.test(value);

/** Midnight in Riyadh (UTC+3, no daylight saving) of `date`, `days` later. */
function riyadhMidnight(date: string, days = 0): string {
  const at = new Date(`${date}T00:00:00+03:00`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString();
}

/** `created_from` and `created_to` of the URL's days, as the list operations take them. */
export function createdRange(params: {
  readonly created_from?: string | undefined;
  readonly created_to?: string | undefined;
}): { created_from?: string; created_to?: string } {
  const range: { created_from?: string; created_to?: string } = {};
  if (params.created_from !== undefined && day.test(params.created_from)) {
    range.created_from = riyadhMidnight(params.created_from);
  }
  if (params.created_to !== undefined && day.test(params.created_to)) {
    range.created_to = riyadhMidnight(params.created_to, 1);
  }
  return range;
}

/** The URL's parameters without the absent ones (a query key, a call). */
export function definedParams<T extends Record<string, string | undefined>>(
  params: T,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
