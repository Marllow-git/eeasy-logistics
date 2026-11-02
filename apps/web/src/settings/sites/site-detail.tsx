'use client';

import { hooks } from '@eeasy-logistics/contracts/staff';
import { useCan } from '@eeasy-logistics/ui/authz';
import { Button } from '@eeasy-logistics/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { useSessionFetcher } from '@eeasy-logistics/ui/session';
import { SiteKindChip, SiteStatusChip } from '@eeasy-logistics/ui/settings/status-chips';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useId, useState } from 'react';
import { ListError } from '../list-error';

// One site (WEB-3 plan 2.8; design references: Workable's inactive page with its single activate
// action, Deputy's site form): the state with "Deactivate" or "Activate" for `core.sites.manage`,
// a banner when the site is inactive, and the form (read-only for the others). Read on the server
// and hydrated (`getSite`); the form and the dialog load with `next/dynamic`.

const SiteForm = dynamic(() => import('./site-form').then((module) => module.SiteForm), {
  loading: () => <Skeleton className="h-96 w-full" />,
});
const SiteStateDialog = dynamic(
  () => import('./site-state-dialogs').then((module) => module.SiteStateDialog),
  { ssr: false },
);

export function SiteDetail({
  siteId,
  siteLimit,
  created,
}: {
  siteId: string;
  siteLimit: number | undefined;
  created: boolean;
}) {
  const t = useTranslations('settings.sites');
  const locale = useLocale();
  const fetcher = useSessionFetcher();
  const manage = useCan('core.sites.manage');
  const query = hooks.useGetSite(siteId, { request: { fetcher } });
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(created ? t('created') : null);
  const formId = useId();
  const site = query.data?.status === 200 ? query.data.data : undefined;

  if (site === undefined) {
    return query.isError ? (
      <ListError error={query.error} onRetry={() => void query.refetch()} />
    ) : (
      <Skeleton className="h-64 w-full" />
    );
  }

  const inactive = site.status === 'inactive';
  const name = locale === 'ar' ? site.name_ar : site.name_en;
  const other = locale === 'ar' ? site.name_en : site.name_ar;

  return (
    <>
      <Link
        href="/settings/sites"
        className="mb-3 inline-block text-sm text-muted-foreground hover:underline"
      >
        {t('back')}
      </Link>
      <PageHeader
        title={<span dir="auto">{name}</span>}
        description={
          <span lang={locale === 'ar' ? 'en' : 'ar'} dir={locale === 'ar' ? 'ltr' : 'rtl'}>
            {other}
          </span>
        }
        actions={
          manage ? (
            <Button variant={inactive ? 'primary' : 'danger'} onClick={() => setConfirming(true)}>
              {inactive ? t('activate.action') : t('deactivate.action')}
            </Button>
          ) : null
        }
      />
      <p role="status" className="mb-4 text-sm text-foreground empty:hidden">
        {notice}
      </p>
      {inactive ? (
        <p role="note" className="mb-6 rounded-md border border-border bg-muted px-4 py-3 text-sm">
          {t('state.inactive_banner')}
        </p>
      ) : null}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <SiteStatusChip status={site.status} />
        <SiteKindChip kind={site.kind} />
        {inactive ? null : (
          <span className="text-sm text-muted-foreground">{t('state.active_line')}</span>
        )}
      </div>
      <Card aria-labelledby={formId}>
        <CardHeader>
          <CardTitle id={formId}>{t('form.details_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <SiteForm site={site} manage={manage} siteLimit={siteLimit} />
        </CardContent>
      </Card>
      {confirming ? (
        <SiteStateDialog
          site={site}
          siteLimit={siteLimit}
          open
          onOpenChange={setConfirming}
          onDone={setNotice}
        />
      ) : null}
    </>
  );
}
