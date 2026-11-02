'use client';

import { Card, CardContent } from '@eeasy-logistics/ui/components/card';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import dynamic from 'next/dynamic';
import Link from 'next/link';

// The new-site page (WEB-3 plan 2.8): the same form as a site's, empty, sent to `createSite`; on
// success the browser goes to the new site with a "created" notice. Gated on `core.sites.manage`
// by its layout. The form loads with `next/dynamic`.

const SiteForm = dynamic(() => import('./site-form').then((module) => module.SiteForm), {
  loading: () => <Skeleton className="h-96 w-full" />,
});

export function NewSite({ siteLimit }: { siteLimit: number | undefined }) {
  const t = useTranslations('settings.sites');
  return (
    <>
      <Link
        href="/settings/sites"
        className="mb-3 inline-block text-sm text-muted-foreground hover:underline"
      >
        {t('back')}
      </Link>
      <PageHeader title={t('new_title')} description={t('new_description')} />
      <Card>
        <CardContent className="pt-6">
          <SiteForm manage siteLimit={siteLimit} />
        </CardContent>
      </Card>
    </>
  );
}
