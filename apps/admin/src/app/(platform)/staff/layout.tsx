import type { ReactNode } from 'react';
import { requirePermission } from '../../../server/authorization';

/** Platform staff open to `platform.staff.manage` (WEB-4 plan 2.9). */
export default async function StaffLayout({ children }: { children: ReactNode }) {
  await requirePermission('/staff');
  return children;
}
