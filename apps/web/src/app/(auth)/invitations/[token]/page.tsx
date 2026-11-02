import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { getTranslations } from 'next-intl/server';
import { InvitationForm } from '../../../../auth/token-forms';

/** `/invitations/[token]` (web §1; WEB-2 plan 2.7): accept a staff invitation from its mail. */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, t] = await Promise.all([params, getTranslations('auth.invitation')]);
  return (
    <AuthCard title={t('title')} description={t('description')}>
      <InvitationForm token={token} />
    </AuthCard>
  );
}
