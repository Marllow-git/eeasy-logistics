'use client';

import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import dynamic from 'next/dynamic';

// The audit log page (WEB-3 plan 2.9): the header, the notice of what the log keeps (Gumloop's
// place above the table), and the table, loaded with `next/dynamic` (server-rendered from the
// hydrated first page). Read-only: there is no write control on this page for anyone.

const AuditTable = dynamic(() => import('./audit-table').then((module) => module.AuditTable), {
  loading: () => <Skeleton className="h-64 w-full" />,
});

export function AuditScreen({
  title,
  actors,
}: {
  title: string;
  actors: Readonly<Record<string, string>>;
}) {
  const t = useTranslations('settings.audit');
  return (
    <>
      <PageHeader title={title} description={t('description')} />
      <p role="note" className="mb-4 rounded-md border border-border bg-muted px-4 py-3 text-sm">
        {t('notice')}
      </p>
      <AuditTable actors={actors} />
    </>
  );
}
