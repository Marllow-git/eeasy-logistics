import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { CensusSession } from '../../../observability/census-session';
import { censusFaultsEnabled } from '../../../observability/settings';

/** Census only (local and ci builds): the in-page session probe (WEB-2 plan 2.14). */
export default async function CensusSessionPage(props: PageProps<'/census-session'>) {
  await connection();
  if (!censusFaultsEnabled()) notFound();
  const { unsaved } = await props.searchParams;
  return <CensusSession unsaved={unsaved !== undefined} />;
}
