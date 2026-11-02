'use client';

import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import dynamic from 'next/dynamic';

// The outbox page (WEB-4 plan 2.8): the header and the list, loaded with `next/dynamic` so the
// route's first load stays inside the budget (WEB-3 leg 2 ruling, as the accounts list).

const OutboxTable = dynamic(() => import('./outbox-table').then((module) => module.OutboxTable), {
  loading: () => <Skeleton className="h-64 w-full" />,
});

export function OutboxScreen() {
  const t = useTranslations('platform');
  return (
    <>
      <PageHeader title={t('nav.outbox')} description={t('outbox.description')} />
      <OutboxTable />
    </>
  );
}
