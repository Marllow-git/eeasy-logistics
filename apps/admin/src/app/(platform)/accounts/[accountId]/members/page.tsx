import { MembersTab } from '../../../../../accounts/members-tab';
import { requireGrant } from '../../../../../server/authorization';

/** The account's Members tab (WEB-4 plan 2.7): `platform.tenants.read`, read under the door. */
export default async function AccountMembersPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  await requireGrant('platform.tenants.read');
  const { accountId } = await params;
  return <MembersTab accountId={accountId.toLowerCase()} />;
}
