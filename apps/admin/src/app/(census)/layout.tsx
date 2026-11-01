import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { censusFaultsEnabled } from '../../observability/settings';

/**
 * Census only (PLAT-14 plan 2.9): a root layout that fails on purpose in local and ci builds, so
 * the census reaches `global-error.tsx`. Elsewhere it is an empty document whose page is a 404.
 */
export default async function CensusLayout({ children }: { children: ReactNode }) {
  await connection();
  if (censusFaultsEnabled()) {
    throw new Error('Census fault: a root layout failed on purpose for +966501234567');
  }
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
