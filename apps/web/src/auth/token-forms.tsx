'use client';

import { ApiError, createSessionFetcher } from '@eeasy-logistics/contracts/http';
import { client } from '@eeasy-logistics/contracts/staff';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import { PasswordField, passwordMinLength } from '@eeasy-logistics/ui/auth/password-field';
import { Button } from '@eeasy-logistics/ui/components/button';
import { Input } from '@eeasy-logistics/ui/components/input';
import { Label } from '@eeasy-logistics/ui/components/label';
import { useLocale, useTranslations } from '@eeasy-logistics/ui/intl';
import { sessionNavigation, signedOutPath } from '@eeasy-logistics/ui/session';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { EnrolFlow } from './enrol-flow';
import { authFetcher, continueSignIn, factorRequired, fieldError, stepStore } from './steps';

// The emailed-link doors (WEB-2 plan 2.7): invitation, password reset, re-enrolment. The link's
// token reaches the page in its path (the mail is the channel) and goes to the API in the body;
// an expired or used link shows its own page with the way back.

type LinkProblem = 'expired' | 'invalid';

function linkProblem(error: unknown): LinkProblem | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === 'token_expired') return 'expired';
  if (error.code === 'token_invalid') return 'invalid';
  return undefined;
}

/** The page shown for an expired or used link. */
export function LinkProblemNotice({
  problem,
  action,
}: {
  problem: LinkProblem;
  action?: ReactNode;
}) {
  const t = useTranslations('auth');
  return (
    <div className="flex flex-col gap-4" data-link-problem={problem}>
      <h2 className="text-lg font-semibold">
        {problem === 'expired' ? t('link.expired_title') : t('link.invalid_title')}
      </h2>
      <p className="text-sm text-muted-foreground">
        {problem === 'expired' ? t('link.expired_description') : t('link.invalid_description')}
      </p>
      {action}
      <Button asChild variant="secondary">
        <Link href="/sign-in">{t('back_to_sign_in')}</Link>
      </Button>
    </div>
  );
}

/** The password error to show: the API's refusal by field code, else the local length rule. */
function usePasswordError() {
  const t = useTranslations('auth.password');
  return (error: unknown): string | undefined => {
    const code = fieldError(error, '/body/password');
    if (code === 'breached') return t('breached');
    if (code === 'too_short') return t('too_short');
    return undefined;
  };
}

/** `/invitations/[token]`: name and password, then a session or the factor step. */
export function InvitationForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const message = useErrorMessage();
  const passwordError = usePasswordError();
  const router = useRouter();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; password?: string }>({});
  const [problem, setProblem] = useState<LinkProblem | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const local = {
      name: name.trim() === '' ? t('invitation.name_required') : undefined,
      password: [...password].length < passwordMinLength ? t('password.too_short') : undefined,
    };
    setFieldErrors(local);
    if (local.name !== undefined || local.password !== undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      stepStore.clear();
      const answer = await client.acceptInvitation(
        { token, name: name.trim(), password, locale },
        { fetcher: authFetcher() },
      );
      if (answer.status !== 200) throw new Error(`accept answered ${answer.status}`);
      continueSignIn({ me: answer.data }, (path) => router.push(path));
    } catch (failure) {
      const factor = factorRequired(failure);
      if (factor !== undefined) {
        continueSignIn(factor, (path) => router.push(path));
        return;
      }
      const link = linkProblem(failure);
      if (link !== undefined) setProblem(link);
      const forPassword = passwordError(failure);
      if (forPassword !== undefined) setFieldErrors({ password: forPassword });
      else setError(message(failure));
      setBusy(false);
    }
  };

  if (problem !== undefined) return <LinkProblemNotice problem={problem} />;
  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="invitation-name">{t('invitation.name')}</Label>
        <Input
          id="invitation-name"
          autoComplete="name"
          dir="auto"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={fieldErrors.name === undefined ? undefined : true}
          aria-describedby={fieldErrors.name === undefined ? undefined : 'invitation-name-error'}
        />
        {fieldErrors.name === undefined ? null : (
          <p id="invitation-name-error" role="alert" className="text-sm text-danger">
            {fieldErrors.name}
          </p>
        )}
      </div>
      <PasswordField
        label={t('fields.password')}
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
      />
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {t('invitation.submit')}
      </Button>
    </form>
  );
}

/** `/password-reset`: the email; always the same notice after (the door always answers 202). */
export function PasswordResetRequestForm() {
  const t = useTranslations('auth');
  const message = useErrorMessage();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || email.trim() === '') return;
    setBusy(true);
    setError(undefined);
    try {
      await client.requestPasswordReset({ email: email.trim() }, { fetcher: authFetcher() });
      setSent(true);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="flex flex-col gap-4" data-step="sent">
        <h2 className="text-lg font-semibold">{t('password_reset.sent_title')}</h2>
        <p role="status" className="text-sm text-muted-foreground">
          {t('password_reset.sent_description')}
        </p>
        <Button asChild variant="secondary">
          <Link href="/sign-in">{t('back_to_sign_in')}</Link>
        </Button>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reset-email">{t('sign_in.email')}</Label>
        <Input
          id="reset-email"
          type="email"
          inputMode="email"
          autoComplete="username"
          dir="ltr"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || email.trim() === ''}>
        {t('password_reset.request_submit')}
      </Button>
      <Link href="/sign-in" className="self-center text-sm font-semibold text-primary">
        {t('back_to_sign_in')}
      </Link>
    </form>
  );
}

/** `/password-reset/[token]`: the new password; then sign in again. */
export function PasswordResetConfirmForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const message = useErrorMessage();
  const passwordError = usePasswordError();
  const [password, setPassword] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<LinkProblem | undefined>();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if ([...password].length < passwordMinLength) {
      setFieldError(t('password.too_short'));
      return;
    }
    setBusy(true);
    setFieldError(undefined);
    setError(undefined);
    try {
      await client.confirmPasswordReset({ token, password }, { fetcher: authFetcher() });
      setDone(true);
    } catch (failure) {
      const link = linkProblem(failure);
      if (link !== undefined) setProblem(link);
      const forPassword = passwordError(failure);
      if (forPassword !== undefined) setFieldError(forPassword);
      else setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  if (problem !== undefined) {
    return (
      <LinkProblemNotice
        problem={problem}
        action={
          <Button asChild>
            <Link href="/password-reset">{t('password_reset.request_submit')}</Link>
          </Button>
        }
      />
    );
  }
  if (done) {
    return (
      <div className="flex flex-col gap-4" data-step="done">
        <h2 className="text-lg font-semibold">{t('password_reset.done_title')}</h2>
        <p role="status" className="text-sm text-muted-foreground">
          {t('password_reset.done_description')}
        </p>
        <Button asChild>
          <Link href="/sign-in">{t('sign_in.submit')}</Link>
        </Button>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      <PasswordField
        label={t('password.new')}
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldError}
      />
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy}>
        {t('password_reset.confirm_submit')}
      </Button>
    </form>
  );
}

/** `/second-factor/enrol/[token]` (PLAT-11 8.2 #34, #35): the password, then the enrolment. */
export function EnrolLinkForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const message = useErrorMessage();
  const [password, setPassword] = useState('');
  const [enrolment, setEnrolment] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<LinkProblem | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || password === '') return;
    setBusy(true);
    setError(undefined);
    try {
      const answer = await client.redeemEnrolmentLink(
        { link_token: token, password },
        { fetcher: authFetcher() },
      );
      if (answer.status !== 200 || typeof answer.data.enrolment_token !== 'string') {
        throw new Error(`redeem answered ${answer.status}`);
      }
      setEnrolment(answer.data.enrolment_token);
    } catch (failure) {
      const link = linkProblem(failure);
      if (link !== undefined) setProblem(link);
      else setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  if (problem !== undefined) return <LinkProblemNotice problem={problem} />;
  if (enrolment !== undefined) return <EnrolFlow enrolmentToken={enrolment} />;
  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      <PasswordField
        label={t('fields.password')}
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={error}
      />
      <Button type="submit" disabled={busy || password === ''}>
        {t('enrol_link.submit')}
      </Button>
    </form>
  );
}

/** The suspended notice's sign-out: `logout`, then the signed-out page. */
export function SignOutButton() {
  const t = useTranslations('auth.session');
  const [busy, setBusy] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        const fetcher = createSessionFetcher({ surface: 'staff' });
        void client
          .logout({ fetcher })
          .catch(() => undefined)
          .finally(() => {
            window.sessionStorage.clear();
            sessionNavigation.assign(signedOutPath);
          });
      }}
    >
      {busy ? t('signing_out') : t('sign_out')}
    </Button>
  );
}
