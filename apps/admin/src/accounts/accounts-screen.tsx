'use client';

import { Can } from '@eeasy-logistics/ui/authz';
import { Button } from '@eeasy-logistics/ui/components/button';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';

// The accounts page (WEB-4 plan 2.3): the header with "Provision account" for
// `platform.accounts.provision` (hidden for the others), and the list, loaded with `next/dynamic`
// so the route's first load stays inside the budget (WEB-3 leg 2 ruling).

const AccountsTable = dynamic(
  () => import('./accounts-table').then((module) => module.AccountsTable),
  { loading: () => <Skeleton className="h-64 w-full" /> },
);

export function AccountsScreen() {
  const t = useTranslations('platform');
  return (
    <>
      <PageHeader
        title={t('nav.accounts')}
        description={t('accounts.description')}
        actions={
          <Can permission="platform.accounts.provision">
            <Button asChild>
              <Link href="/accounts/new">{t('accounts.provision')}</Link>
            </Button>
          </Can>
        }
      />
      <AccountsTable />
    </>
  );
}
