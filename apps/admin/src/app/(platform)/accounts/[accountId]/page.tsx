import { AccountDetails } from '../../../../accounts/account-details';

/** The account's Details tab (WEB-4 plan 2.5). */
export default async function AccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  return <AccountDetails accountId={accountId.toLowerCase()} />;
}
