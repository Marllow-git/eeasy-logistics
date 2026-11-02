import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { getTranslations } from 'next-intl/server';
import { SelectAccount } from '../../../../auth/select-account';

/** `/sign-in/select-account` (WEB-2 plan 2.7): one of the user's accounts. */
export default async function SelectAccountPage() {
  const t = await getTranslations('auth.select_account');
  return (
    <AuthCard title={t('title')} description={t('description')}>
      <SelectAccount />
    </AuthCard>
  );
}
