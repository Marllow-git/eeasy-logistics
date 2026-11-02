import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { getTranslations } from 'next-intl/server';
import { InvitationForm } from '../../../../auth/invitation-form';

/** `/invitations/[token]` (web §1; WEB-2 plan 2.9): accept a platform staff invitation. */
export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, t] = await Promise.all([params, getTranslations('auth')]);
  return (
    <AuthCard title={t('invitation.title')} description={t('totp.invitation_description')}>
      <InvitationForm token={token} />
    </AuthCard>
  );
}
