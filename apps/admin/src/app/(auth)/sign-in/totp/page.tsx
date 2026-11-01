import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getTranslations } from 'next-intl/server';

/** The second step of platform sign-in (web §1); WEB-2 builds the form. */
export default async function TotpPage() {
  const t = await getTranslations('platform');
  return <PageHeader title={t('sign_in.totp_title')} description={t('placeholder.totp')} />;
}
