import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { getTranslations } from 'next-intl/server';
import { PasswordResetConfirmForm } from '../../../../auth/token-forms';

/** `/password-reset/[token]` (web §1; WEB-2 plan 2.7): the new password from the mailed link. */
export default async function PasswordResetConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const [{ token }, t] = await Promise.all([params, getTranslations('auth.password_reset')]);
  return (
    <AuthCard title={t('confirm_title')} description={t('confirm_description')}>
      <PasswordResetConfirmForm token={token} />
    </AuthCard>
  );
}
