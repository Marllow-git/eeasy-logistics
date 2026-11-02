import type { ReactNode } from 'react';
import { requirePermission } from '../../../../server/authorization';

/** `core.account.read` opens the account settings (web §4, §8; WEB-3 plan 2.2, 2.6). */
export default async function AccountSettingsLayout({ children }: { children: ReactNode }) {
  await requirePermission('/settings/account');
  return children;
}
