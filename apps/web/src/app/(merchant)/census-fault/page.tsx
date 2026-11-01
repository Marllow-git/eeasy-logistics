import { CensusFault } from '../../../observability/census-fault';

/** Census only (local and ci builds): the merchant error page inside the shell (PLAT-14 2.9). */
export default function MerchantCensusFaultPage(props: PageProps<'/census-fault'>) {
  return <CensusFault searchParams={props.searchParams} />;
}
