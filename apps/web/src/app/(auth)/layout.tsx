import type { ReactNode } from 'react';
import { RootHtml } from '../../root-html';

export { generateMetadata } from '../../root-html';

/** Sign-in and invitation pages before a session (web §1). Its own root layout (web §1.2). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <RootHtml>{children}</RootHtml>;
}
