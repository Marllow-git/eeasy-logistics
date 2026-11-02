'use client';

import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import dynamic from 'next/dynamic';

// The platform audit log page (WEB-4 plan 2.11; Gumloop's notice of what the log holds): the
// header and the table with its filters, loaded as its own chunk (shared with the Audit tab).

const AuditTable = dynamic(() => import('./audit-table').then((module) => module.AuditTable), {
  loading: () => <Skeleton className="h-64 w-full" />,
});

export function AuditScreen() {
  const t = useTranslations('platform');
  return (
    <>
      <PageHeader title={t('nav.audit')} description={t('audit.description')} />
      <AuditTable scope={{ kind: 'platform' }} />
    </>
  );
}
