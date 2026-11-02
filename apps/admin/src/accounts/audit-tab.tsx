'use client';

import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import dynamic from 'next/dynamic';
import { useSupportReason } from '../support/support-reason';

// The account's Audit tab (WEB-4 plan 2.7): its log through the door with the tab's support reason
// (`platformListAccountAudit`, `platform.tenants.read`), in the console's audit table, which loads
// as its own chunk (shared with the platform audit page).

const AuditTable = dynamic(
  () => import('../audit/audit-table').then((module) => module.AuditTable),
  {
    loading: () => <Skeleton className="h-64 w-full" />,
  },
);

export function AuditTab({ accountId }: { accountId: string }) {
  const t = useTranslations('platform.audit');
  const { headers } = useSupportReason();
  return (
    <section aria-labelledby="account-audit-title" className="flex flex-col gap-3">
      <div>
        <h2 id="account-audit-title" className="text-lg font-semibold text-foreground">
          {t('account_title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('account_description')}</p>
      </div>
      <AuditTable scope={{ kind: 'account', accountId, headers }} />
    </section>
  );
}
