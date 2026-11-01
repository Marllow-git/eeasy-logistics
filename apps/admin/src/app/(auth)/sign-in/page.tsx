import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getTranslations } from 'next-intl/server';

export default async function SignInPage() {
  const [auth, t] = await Promise.all([getTranslations('auth'), getTranslations('platform')]);
  return <PageHeader title={auth('sign_in.title')} description={t('placeholder.sign_in')} />;
}
