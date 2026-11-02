import { staffServerFetcher } from '../../../../../server/api';
import { getStaffSession } from '../../../../../server/session';
import { siteLimit } from '../../../../../server/settings';
import { NewSite } from '../../../../../settings/sites/new-site';

/** A new site (WEB-3 plan 2.8): the empty form, and the account's site limit for its refusal. */
export default async function NewSitePage() {
  const [fetcher, me] = await Promise.all([staffServerFetcher(), getStaffSession()]);
  return <NewSite siteLimit={await siteLimit(fetcher, me.permissions)} />;
}
