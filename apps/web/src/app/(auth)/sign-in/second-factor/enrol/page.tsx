import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { getTranslations } from 'next-intl/server';
import { EnrolAtSignIn } from '../../../../../auth/enrol-at-sign-in';

/** `/sign-in/second-factor/enrol` (WEB-2 plan 2.7): a required factor enrolled at sign-in (N2). */
export default async function EnrolPage() {
  const t = await getTranslations('auth.enrol');
  return (
    <AuthCard title={t('title')} description={t('description')}>
      <EnrolAtSignIn />
    </AuthCard>
  );
}
