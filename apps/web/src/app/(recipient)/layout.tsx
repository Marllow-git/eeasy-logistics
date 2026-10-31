import type { ReactNode } from 'react';
import { RootHtml } from '../../root-html';

export { generateMetadata } from '../../root-html';

/** Recipient pages, no account (web §1). Its own root layout (web §1.2). */
export default function RecipientLayout({ children }: { children: ReactNode }) {
  return <RootHtml>{children}</RootHtml>;
}
