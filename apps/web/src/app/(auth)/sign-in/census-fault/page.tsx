import { CensusFault } from '../../../../observability/census-fault';

/** Census only (local and ci builds): the auth error page inside its frame (PLAT-14 2.9). */
export default function AuthCensusFaultPage(props: PageProps<'/sign-in/census-fault'>) {
  return <CensusFault searchParams={props.searchParams} />;
}
