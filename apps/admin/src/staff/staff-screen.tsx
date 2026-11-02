'use client';

import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import dynamic from 'next/dynamic';

// The platform staff page (WEB-4 plan 2.9): the header and the list with its dialogs, loaded with
// `next/dynamic` so the route's first load stays inside the budget.

const StaffTable = dynamic(() => import('./staff-table').then((module) => module.StaffTable), {
  loading: () => <Skeleton className="h-64 w-full" />,
});

export function StaffScreen() {
  const t = useTranslations('platform');
  return (
    <>
      <PageHeader title={t('nav.staff')} description={t('staff.description')} />
      <StaffTable />
    </>
  );
}
