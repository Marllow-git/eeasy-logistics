import { Button } from '@eeasy-logistics/ui/components/button';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/**
 * The "no access" page of the merchant area (web §4; WEB-3 plan 2.2): a segment layout's
 * `requirePermission` calls `forbidden()` and Next renders this inside the shell with status 403.
 */
export default async function NoAccess() {
  const t = await getTranslations('common.no_access');
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
