import type { Site } from '@eeasy-logistics/contracts/staff';

// The account's sites as the members screens offer them (a filter, the invite's and the edit's
// site choices): the id, both names and the state, read once on the server (`listSites`) and
// handed to the client as plain data (react `server-serialization`).

export interface SiteOption {
  readonly id: string;
  readonly name_ar: string;
  readonly name_en: string;
  readonly status: string | undefined;
}

/** The fields a site option keeps. */
export function siteOptionOf(site: Site): SiteOption {
  return { id: site.id, name_ar: site.name_ar, name_en: site.name_en, status: site.status };
}

/** The site's name in `locale`, the other language when that one is empty. */
export function siteName(site: Pick<SiteOption, 'name_ar' | 'name_en'>, locale: string): string {
  return (locale === 'ar' ? site.name_ar : site.name_en) || site.name_ar || site.name_en;
}
