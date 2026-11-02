import 'server-only';
import { webServerConfig } from '@eeasy-logistics/config/web-server';
import { createFetcher, type Fetcher } from '@eeasy-logistics/contracts/http';
import { requestLocale } from '@eeasy-logistics/ui/shell';
import { cookies, headers } from 'next/headers';

// The server API client of apps/web (web §2.2; WEB-2 plan 2.5): server components call the API on
// the internal network (`API_INTERNAL_URL`) with the request's locale and request id, and forward
// the staff access cookie only: never the refresh cookie, never the platform's (it lives on the
// console's hostname), and nothing at all from a recipient page. No caching (`no-store`).
// `server-only` fails the build if a client component imports this; dependency-cruiser keeps it
// out of (recipient).

const staffAccessCookie = 'el_staff_at';

/** The fetcher a server component passes to a generated staff call as `{ fetcher }`. */
export async function staffServerFetcher(): Promise<Fetcher> {
  const { apiInternalUrl } = webServerConfig('web');
  if (apiInternalUrl === undefined) throw new Error('API_INTERNAL_URL is not set');
  const [jar, incoming, locale] = await Promise.all([cookies(), headers(), requestLocale()]);
  const access = jar.get(staffAccessCookie)?.value;
  const forwarded: Record<string, string> = {};
  if (access !== undefined && access !== '') forwarded.Cookie = `${staffAccessCookie}=${access}`;
  const requestId = incoming.get('x-request-id');
  if (requestId !== null) forwarded['X-Request-Id'] = requestId;
  return createFetcher({
    baseUrl: apiInternalUrl,
    locale,
    headers: forwarded,
    fetch: (url, init) => fetch(url, { ...init, cache: 'no-store' }),
  });
}
