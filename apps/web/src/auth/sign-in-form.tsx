'use client';

import { client } from '@eeasy-logistics/contracts/staff';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import { PasswordField } from '@eeasy-logistics/ui/auth/password-field';
import { Button } from '@eeasy-logistics/ui/components/button';
import { Input } from '@eeasy-logistics/ui/components/input';
import { Label } from '@eeasy-logistics/ui/components/label';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { track } from '../analytics';
import { authFetcher, continueSignIn, stepStore } from './steps';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Email and password (WEB-2 plan 2.7; the Hume and Retool references): one message for wrong
 * credentials, the wait from `Retry-After` when rate-limited; the answer decides the next step.
 * `next` was validated on the server (same-origin relative path) and is kept for the last step.
 */
export function SignInForm({ next }: { next: string | undefined }) {
  const t = useTranslations('auth');
  const message = useErrorMessage();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [emailError, setEmailError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A new sign-in starts clean: no step token of an earlier attempt survives.
    stepStore.clear();
    stepStore.setNext(next);
  }, [next]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const address = email.trim();
    if (!emailPattern.test(address)) {
      setEmailError(t('sign_in.invalid_email'));
      return;
    }
    setEmailError(undefined);
    setError(undefined);
    setBusy(true);
    track('auth.sign_in.started', { surface: 'staff' });
    try {
      const answer = await client.login({ email: address, password }, { fetcher: authFetcher() });
      if (answer.status !== 200) throw new Error(`login answered ${answer.status}`);
      continueSignIn(answer.data, (path) => router.push(path));
    } catch (failure) {
      setError(message(failure));
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="sign-in-email">{t('sign_in.email')}</Label>
        <Input
          id="sign-in-email"
          type="email"
          inputMode="email"
          autoComplete="username"
          dir="ltr"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={emailError === undefined ? undefined : true}
          aria-describedby={emailError === undefined ? undefined : 'sign-in-email-error'}
        />
        {emailError === undefined ? null : (
          <p id="sign-in-email-error" role="alert" className="text-sm text-danger">
            {emailError}
          </p>
        )}
      </div>
      <PasswordField
        label={t('fields.password')}
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Link
        href="/password-reset"
        className="-mt-2 self-end text-sm font-semibold text-primary underline-offset-4 hover:underline"
      >
        {t('sign_in.forgot_password')}
      </Link>
      {error === undefined ? null : (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger"
        >
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || password === '' || email === ''}>
        {busy ? t('sign_in.submitting') : t('sign_in.submit')}
      </Button>
    </form>
  );
}
