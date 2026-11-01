import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getTranslations } from 'next-intl/server';

export default async function PlatformHomePage() {
  const t = await getTranslations('platform');
  return <PageHeader title={t('nav.home')} description={t('placeholder.console')} />;
}
