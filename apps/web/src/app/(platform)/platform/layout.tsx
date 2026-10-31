import type { ReactNode } from 'react';
import { RootHtml } from '../../../root-html';

export { generateMetadata } from '../../../root-html';

/** Platform staff area under /platform (web §1). Its own root layout (web §1.2). */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <RootHtml>{children}</RootHtml>;
}
