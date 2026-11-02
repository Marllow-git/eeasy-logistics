import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { getTranslations } from 'next-intl/server';
import { EnrolLinkForm } from '../../../../../auth/token-forms';

/**
 * `/second-factor/enrol/[token]` (PLAT-11 8.2 #34, #35; WEB-2 plan 2.7): the emailed re-enrolment
 * link after a member's factor was reset: the password, then the phone and its code.
 */
export default async function EnrolLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, t] = await Promise.all([params, getTranslations('auth.enrol_link')]);
  return (
    <AuthCard title={t('title')} description={t('description')}>
      <EnrolLinkForm token={token} />
    </AuthCard>
  );
}
