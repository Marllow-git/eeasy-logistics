import { FlagsTab } from '../../../../../accounts/flags-tab';

/** The account's Modules tab (WEB-4 plan 2.6). */
export default async function AccountFlagsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  return <FlagsTab accountId={accountId.toLowerCase()} />;
}
