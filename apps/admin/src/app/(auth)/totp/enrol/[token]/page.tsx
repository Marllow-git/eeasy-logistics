import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { getTranslations } from 'next-intl/server';
import { RelinkForm } from '../../../../../auth/relink-form';

/**
 * `/totp/enrol/[token]` (web §1; WEB-4 plan 2.10): the re-enrolment link a TOTP reset mails
 * (`PUBLIC_ADMIN_URL/totp/enrol/<token>`, PLAT-13 2.9): the password, then the enrolment view.
 */
export default async function RelinkPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, t] = await Promise.all([params, getTranslations('auth')]);
  return (
    <AuthCard title={t('totp.relink_title')} description={t('totp.relink_description')}>
      <RelinkForm token={token} />
    </AuthCard>
  );
}
