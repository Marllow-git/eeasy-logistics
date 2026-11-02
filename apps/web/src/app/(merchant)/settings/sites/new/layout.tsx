import type { ReactNode } from 'react';
import { requirePermission } from '../../../../../server/authorization';

/** The new-site form is a write screen: `core.sites.manage` opens it (WEB-3 plan 2.2, 2.8). */
export default async function NewSiteLayout({ children }: { children: ReactNode }) {
  await requirePermission('/settings/sites/new');
  return children;
}
