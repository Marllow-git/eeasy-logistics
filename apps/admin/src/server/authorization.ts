import 'server-only';
import { forbidden } from 'next/navigation';
import { routeOf, routeOpen, type ConsolePath } from '../routes';
import { getPlatformSession } from './session';

/**
 * The server gate of a console segment (web §4; WEB-4 plan 2.1, WEB-3's mechanism), called by its
 * `layout.tsx` before anything renders: a staff member without the route's read permission gets
 * the "no access" page with status 403 (`forbidden()`, rendered by `(platform)/forbidden.tsx`
 * inside the shell). The session is the layout's own `platformGetMe` (React `cache()`), so the gate
 * costs no second call. The API refuses anyway: this only keeps a page from asking for data its
 * reader may not read.
 */
export async function requirePermission(path: ConsolePath): Promise<void> {
  const me = await getPlatformSession();
  if (!routeOpen(routeOf(path), me)) forbidden();
}
