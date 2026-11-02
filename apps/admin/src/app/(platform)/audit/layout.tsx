import type { ReactNode } from 'react';
import { requirePermission } from '../../../server/authorization';

/** The platform audit log opens to `platform.audit.read` (WEB-4 plan 2.11). */
export default async function AuditLayout({ children }: { children: ReactNode }) {
  await requirePermission('/audit');
  return children;
}
