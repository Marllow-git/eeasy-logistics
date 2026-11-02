import type { ReactNode } from 'react';
import { requirePermission } from '../../../server/authorization';

/** The outbox opens to `platform.outbox.read`; replays are checked per control (WEB-4 plan 2.8). */
export default async function OutboxLayout({ children }: { children: ReactNode }) {
  await requirePermission('/outbox');
  return children;
}
