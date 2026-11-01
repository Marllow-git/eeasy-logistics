import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getTranslations } from 'next-intl/server';

export default async function MerchantHomePage() {
  const [t, nav] = await Promise.all([getTranslations('common'), getTranslations('nav')]);
  return <PageHeader title={nav('home')} description={t('placeholder.merchant')} />;
}
