import type { ReactNode } from 'react';
import { requirePermission } from '../../../../server/authorization';

/** The provisioning form is a write screen: `platform.accounts.provision` (WEB-4 plan 2.3). */
export default async function ProvisionLayout({ children }: { children: ReactNode }) {
  await requirePermission('/accounts/new');
  return children;
}
