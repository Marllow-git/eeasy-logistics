import type { ReactNode } from 'react';
import { requirePermission } from '../../../../server/authorization';

/** `core.sites.read` opens the sites and each site (web §4, §8; WEB-3 plan 2.2, 2.8). */
export default async function SitesLayout({ children }: { children: ReactNode }) {
  await requirePermission('/settings/sites');
  return children;
}
