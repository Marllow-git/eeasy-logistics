import type { ReactNode } from 'react';
import { RootHtml } from '../../root-html';

export { generateMetadata } from '../../root-html';

/** Merchant staff area (web §1). Its own root layout: nothing leaks between groups (web §1.2). */
export default function MerchantLayout({ children }: { children: ReactNode }) {
  return <RootHtml>{children}</RootHtml>;
}
