import type { ReactNode } from 'react';
import { requirePermission } from '../../../server/authorization';

/** `platform.accounts.read` opens the list, each account and its tabs (WEB-4 plan 2.1, 2.3). */
export default async function AccountsLayout({ children }: { children: ReactNode }) {
  await requirePermission('/accounts');
  return children;
}
