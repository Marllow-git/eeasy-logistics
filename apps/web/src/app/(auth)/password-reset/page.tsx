import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { getTranslations } from 'next-intl/server';
import { PasswordResetRequestForm } from '../../../auth/token-forms';

/** `/password-reset` (web §1; WEB-2 plan 2.7): ask for a reset link. */
export default async function PasswordResetPage() {
  const t = await getTranslations('auth.password_reset');
  return (
    <AuthCard title={t('request_title')} description={t('request_description')}>
      <PasswordResetRequestForm />
    </AuthCard>
  );
}
