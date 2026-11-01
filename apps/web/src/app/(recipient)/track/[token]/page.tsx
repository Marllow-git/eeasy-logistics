import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getTranslations } from 'next-intl/server';

export default async function TrackPage() {
  const [t, recipient] = await Promise.all([
    getTranslations('common'),
    getTranslations('recipient'),
  ]);
  return <PageHeader title={recipient('track.title')} description={t('placeholder.recipient')} />;
}
