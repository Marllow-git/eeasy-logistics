import 'server-only';
import { client, type Site } from '@eeasy-logistics/contracts/staff';
import type { Fetcher } from '@eeasy-logistics/contracts/http';
import { siteOptionOf, type SiteOption } from '../settings/site-options';

// Server reads the settings pages share (WEB-3 plan 2.7, 2.8).

/** The account's sites the session sees (site-scoped by the API), as plain options, by name. */
export async function siteOptions(fetcher: Fetcher, locale: 'ar' | 'en'): Promise<SiteOption[]> {
  const answer = await client.listSites({ limit: 200, sort: `name_${locale}` }, { fetcher });
  const page = answer.data as { data?: Site[] };
  return (page.data ?? []).map(siteOptionOf);
}
