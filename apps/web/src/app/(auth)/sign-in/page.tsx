import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getTranslations } from 'next-intl/server';

export default async function SignInPage() {
  const [t, auth] = await Promise.all([getTranslations('common'), getTranslations('auth')]);
  return <PageHeader title={auth('sign_in.title')} description={t('placeholder.auth')} />;
}
