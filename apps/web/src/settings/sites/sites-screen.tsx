'use client';

import { Can } from '@eeasy-logistics/ui/authz';
import { Button } from '@eeasy-logistics/ui/components/button';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';

// The sites page (WEB-3 plan 2.8): the header with "New site" for `core.sites.manage` (hidden for
// the others), and the list, loaded with `next/dynamic` (server-rendered from the hydrated page).

const SitesTable = dynamic(() => import('./sites-table').then((module) => module.SitesTable), {
  loading: () => <Skeleton className="h-64 w-full" />,
});

export function SitesScreen({ title }: { title: string }) {
  const t = useTranslations('settings.sites');
  return (
    <>
      <PageHeader
        title={title}
        description={t('description')}
        actions={
          <Can permission="core.sites.manage">
            <Button asChild>
              <Link href="/settings/sites/new">{t('new')}</Link>
            </Button>
          </Can>
        }
      />
      <SitesTable />
    </>
  );
}
