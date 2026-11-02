import type { ReactNode } from 'react';
import { requirePermission } from '../../../../server/authorization';

/** `core.members.read` opens the members and each member (web §4, §8; WEB-3 plan 2.2, 2.7). */
export default async function MembersLayout({ children }: { children: ReactNode }) {
  await requirePermission('/settings/members');
  return children;
}
