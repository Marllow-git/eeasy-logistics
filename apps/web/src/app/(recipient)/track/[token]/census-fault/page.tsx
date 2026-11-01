import { CensusFault } from '../../../../../observability/census-fault';

/**
 * Census only (local and ci builds): the recipient error page inside its frame, under a token
 * path, so the census proves the token never reaches an error report (PLAT-14 2.9).
 */
export default function RecipientCensusFaultPage(props: PageProps<'/track/[token]/census-fault'>) {
  return <CensusFault searchParams={props.searchParams} />;
}
