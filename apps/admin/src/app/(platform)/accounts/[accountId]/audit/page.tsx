import { AuditTab } from '../../../../../accounts/audit-tab';
import { requireGrant } from '../../../../../server/authorization';

/** The account's Audit tab (WEB-4 plan 2.7): `platform.tenants.read`, read under the door. */
export default async function AccountAuditPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  await requireGrant('platform.tenants.read');
  const { accountId } = await params;
  return <AuditTab accountId={accountId.toLowerCase()} />;
}
