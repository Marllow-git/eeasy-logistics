import type { ReactNode } from 'react';
import { RootHtml } from '../../root-html';

export { generateMetadata } from '../../root-html';

/**
 * Platform console at the admin hostname's root (web §1; no /platform segment, ADR-0038). Its own
 * root layout (web §1.2).
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <RootHtml>{children}</RootHtml>;
}
