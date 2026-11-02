import { Button } from '@eeasy-logistics/ui/components/button';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/**
 * The console's "no access" page (web §4; WEB-4 plan 2.1): a segment layout's `requirePermission`
 * calls `forbidden()` and Next renders this inside the shell with status 403.
 */
export default async function NoAccess() {
  const t = await getTranslations('platform.no_access');
  return (
    <PageHeader
      title={t('title')}
      description={t('description')}
      actions={
        <Button asChild variant="secondary">
          <Link href="/">{t('home')}</Link>
        </Button>
      }
    />
  );
}
