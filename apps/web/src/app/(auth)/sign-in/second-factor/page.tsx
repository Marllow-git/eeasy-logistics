import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { getTranslations } from 'next-intl/server';
import { SecondFactorForm } from '../../../../auth/second-factor-form';

/** `/sign-in/second-factor` (web §1, §3.4; WEB-2 plan 2.7): the phone code of a sign-in. */
export default async function SecondFactorPage() {
  const t = await getTranslations('auth.second_factor');
  return (
    <AuthCard title={t('title')} description={t('description')}>
      <SecondFactorForm />
    </AuthCard>
  );
}
