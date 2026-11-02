import 'server-only';
import { forbidden, notFound } from 'next/navigation';
import { featureVisible, routeOf, routeOpen, type MerchantPath } from '../routes';
import { getStaffSession } from './session';

/**
 * The server gate of a merchant segment (web §4; WEB-3 plan 2.2), called by its `layout.tsx`
 * before anything renders: a module the account does not see answers `notFound()`, a member
 * without the route's read permission gets the "no access" page with status 403 (`forbidden()`,
 * rendered by `(merchant)/forbidden.tsx` inside the shell). The session comes from the layout's
 * own `getMe` (React `cache()`), so the gate costs no second call. The API refuses anyway: this
 * only keeps a page from asking for data its reader may not read.
 */
export async function requirePermission(path: MerchantPath): Promise<void> {
  const route = routeOf(path);
  const me = await getStaffSession();
  if (!featureVisible(route, me)) notFound();
  if (!routeOpen(route, me)) forbidden();
}
