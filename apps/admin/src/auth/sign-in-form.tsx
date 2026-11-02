'use client';

import { client } from '@eeasy-logistics/contracts/platform';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import { PasswordField } from '@eeasy-logistics/ui/auth/password-field';
import { Button } from '@eeasy-logistics/ui/components/button';
import { Input } from '@eeasy-logistics/ui/components/input';
import { Label } from '@eeasy-logistics/ui/components/label';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { track } from '../analytics';
import { authFetcher, continueToTotp, stepStore } from './steps';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The console's email and password (WEB-2 plan 2.9, the rules of 2.7): one message for wrong
 * credentials, the wait from `Retry-After` when rate-limited; the answer is always a TOTP
 * challenge (code entry, or the enrolment view on first use). `next` was validated on the server
 * (same-origin relative path) and is kept for the last step. No password reset here: platform
 * staff are reset by a super admin (identity §3.3).
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
    // A new sign-in starts clean: no challenge of an earlier attempt survives.
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
    track('auth.sign_in.started', { surface: 'platform' });
    try {
      const answer = await client.platformLogin(
        { email: address, password },
        { fetcher: authFetcher() },
      );
      if (answer.status !== 200) throw new Error(`platformLogin answered ${answer.status}`);
      continueToTotp(answer.data, (path) => router.push(path));
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
