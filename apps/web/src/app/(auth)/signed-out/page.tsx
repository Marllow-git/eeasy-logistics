import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { Button } from '@eeasy-logistics/ui/components/button';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

/** `/signed-out` (web §3.4; WEB-2 plan 2.7, 2.8): where a sign-out lands. */
export default async function SignedOutPage() {
  const t = await getTranslations('auth.signed_out');
  return (
    <AuthCard title={t('title')} description={t('description')}>
      <Button asChild>
        <Link href="/sign-in">{t('sign_in_again')}</Link>
      </Button>
    </AuthCard>
  );
}
