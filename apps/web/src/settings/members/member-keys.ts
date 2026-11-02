import { hooks } from '@eeasy-logistics/contracts/staff';
import { definedParams } from '../lists';

// The query keys of the members screens, shared by the server pages (prefetch) and the client
// (read, invalidate); no 'use client', so the server can call them.

/** The first element of every members list key: invalidating it refreshes every list view. */
export const memberQueryRoot = '/v1/staff/members';

/** The URL parameters of the members list (web §2.4). */
export const memberListKeys = ['status', 'site_id', 'q', 'sort'] as const;

/** The query key of a members list: the operation's own, with the URL's parameters. */
export function membersListKey(params: Partial<Record<string, string | undefined>>) {
  return hooks.getListMembersQueryKey(definedParams(params));
}
