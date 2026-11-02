// What the settings lists share between the server page and the browser (web §2.4; WEB-3 plan
// 2.4): the page size and the list parameters read from the URL. The server prefetches the first
// page under the same query key the browser builds from the same parameters, so the hydrated page
// is the one the browser shows. No runtime imports, so server and client modules both use it.

/** Rows per page of every settings list (ADR-0029: "load more" for the next). */
export const listPageSize = 50;

export type SearchParams = Record<string, string | string[] | undefined>;

/** The list parameters `keys` of a page's `searchParams`, without the absent or empty ones. */
export function listParamsOf<Key extends string>(
  search: SearchParams,
  keys: readonly Key[],
): { [K in Key]?: string } {
  const params: { [K in Key]?: string } = {};
  for (const key of keys) {
    const raw = search[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value !== undefined && value !== '') params[key] = value;
  }
  return params;
}

/** The parameters a list hook reads, without the undefined ones (the key the server used). */
export function definedParams<Params extends Record<string, string | undefined>>(
  params: Params,
): { [K in keyof Params]?: string } {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
  ) as { [K in keyof Params]?: string };
}
