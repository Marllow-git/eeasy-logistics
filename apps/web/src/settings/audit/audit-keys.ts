import type { ListAuditLogParams } from '@eeasy-logistics/contracts/staff';
import { hooks } from '@eeasy-logistics/contracts/staff';
import { definedParams } from '../lists';

// The audit log's URL parameters and query key (web §2.4; WEB-3 plan 2.9), shared by the server
// page and the client. The dates in the URL are calendar days (`YYYY-MM-DD`) as the reader picks
// them; the call sends instants at Riyadh midnight, `created_to` the day after (the API's upper
// bound is exclusive), so "to" includes its whole day.

export const auditListKeys = [
  'created_from',
  'created_to',
  'target_type',
  'target_id',
  'actor_id',
] as const;

const day = /^\d{4}-\d{2}-\d{2}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` is a whole UUID (the API's `actor_id` format). */
export const isUuid = (value: string) => uuid.test(value);

/** Midnight in Riyadh (UTC+3, no daylight saving) of `date`, `days` later. */
function riyadhMidnight(date: string, days = 0): string {
  const at = new Date(`${date}T00:00:00+03:00`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString();
}

/** The `listAuditLog` query of the URL's parameters; a malformed value is left out. */
export function auditQuery(
  params: Partial<Record<string, string | undefined>>,
): ListAuditLogParams {
  const query: ListAuditLogParams = {};
  if (params.created_from && day.test(params.created_from)) {
    query.created_from = riyadhMidnight(params.created_from);
  }
  if (params.created_to && day.test(params.created_to)) {
    query.created_to = riyadhMidnight(params.created_to, 1);
  }
  if (params.target_type) query.target_type = params.target_type;
  if (params.target_id) query.target_id = params.target_id;
  if (params.actor_id && isUuid(params.actor_id)) query.actor_id = params.actor_id;
  return query;
}

/** The query key of an audit list: the operation's own, with the URL's parameters. */
export function auditListKey(params: Partial<Record<string, string | undefined>>) {
  return hooks.getListAuditLogQueryKey(definedParams(params));
}
