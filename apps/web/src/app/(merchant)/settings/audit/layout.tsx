import type { ReactNode } from 'react';
import { requirePermission } from '../../../../server/authorization';

/** `core.audit.read` opens the audit log (web §4, §8; WEB-3 plan 2.2, 2.9). */
export default async function AuditLayout({ children }: { children: ReactNode }) {
  await requirePermission('/settings/audit');
  return children;
}
