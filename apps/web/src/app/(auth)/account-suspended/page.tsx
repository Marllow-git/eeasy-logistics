import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { getTranslations } from 'next-intl/server';
import { SignOutButton } from '../../../auth/token-forms';

/** `/account-suspended` (web §3.4; WEB-2 plan 2.8): the full-page notice, with sign-out. */
export default async function AccountSuspendedPage() {
  const t = await getTranslations('auth.session');
  return (
    <AuthCard title={t('suspended_title')} description={t('suspended_description')}>
      <SignOutButton />
    </AuthCard>
  );
}
