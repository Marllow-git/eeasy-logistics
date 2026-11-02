import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { safeNextPath } from '@eeasy-logistics/ui/session/tokens';
import { getTranslations } from 'next-intl/server';
import { SignInForm } from '../../../auth/sign-in-form';

/**
 * `/sign-in` (web §1, §3.4; WEB-2 plan 2.7). `next` is kept only as a same-origin relative path;
 * `reason=ended` shows that the session ended (the proxy has cleared its cookies).
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, t] = await Promise.all([searchParams, getTranslations('auth')]);
  const next = safeNextPath(typeof params.next === 'string' ? params.next : undefined);
  const ended = params.reason === 'ended';
  return (
    <AuthCard
      title={t('sign_in.title')}
      description={
        ended ? (
          <p role="status" className="rounded-md border border-border bg-muted p-3 text-foreground">
            {t('session.ended_notice')}
          </p>
        ) : (
          t('sign_in.description')
        )
      }
    >
      <SignInForm next={next} />
    </AuthCard>
  );
}
