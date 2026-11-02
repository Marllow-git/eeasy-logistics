import { hooks } from '@eeasy-logistics/contracts/staff';
import { definedParams } from '../lists';

// The query keys of the sites screens, shared by the server pages (prefetch) and the client.

/** The first element of every sites list key: invalidating it refreshes every list view. */
export const siteQueryRoot = '/v1/staff/sites';

/** The URL parameters of the sites list (web §2.4). */
export const siteListKeys = ['status', 'kind', 'sort'] as const;

/** The list's sort when the URL names none: by the name in the reader's language (plan 2.8). */
export const defaultSiteSort = (locale: string) => (locale === 'en' ? 'name_en' : 'name_ar');

/** The query key of a sites list: the operation's own, with the URL's parameters and the sort. */
export function sitesListKey(params: Partial<Record<string, string | undefined>>, locale: string) {
  return hooks.getListSitesQueryKey({
    ...definedParams(params),
    sort: params.sort ?? defaultSiteSort(locale),
  });
}
