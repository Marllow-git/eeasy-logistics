import type { ReactNode } from 'react';
import { requirePermission } from '../../../server/authorization';

/** Rollout modes open to `platform.accounts.read`; the change is checked per control (2.6). */
export default async function RolloutLayout({ children }: { children: ReactNode }) {
  await requirePermission('/rollout');
  return children;
}
