'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { client } from '@eeasy-logistics/contracts/platform';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import { PasswordField } from '@eeasy-logistics/ui/auth/password-field';
import { Button } from '@eeasy-logistics/ui/components/button';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authFetcher, continueToTotp, stepStore } from './steps';

// `/totp/enrol/[token]` of the console (WEB-4 plan 2.10; PLAT-13 2.9 and adversary M-2): the
// one-time link a super admin's `platformResetStaffTotp` mails. The password and the link's token
// go to `platformRedeemEnrolmentLink`, whose answer is a TOTP challenge: on to `/sign-in/totp`
// and WEB-2's enrolment view (QR code, key, first code), which starts the session. A spent or
// unknown link and an expired one end on full-page notices (an expired one says to ask for a new
// reset); a wrong password stays on the form (five end the link, PLAT-13).

type LinkProblem = 'expired' | 'invalid';

export function RelinkForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const message = useErrorMessage();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<LinkProblem | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || password === '') return;
    setBusy(true);
    setError(undefined);
    try {
      stepStore.clear();
      const answer = await client.platformRedeemEnrolmentLink(
        { token, password },
        { fetcher: authFetcher() },
      );
      if (answer.status !== 200) throw new Error(`redeem answered ${answer.status}`);
      // The link exists to enrol a new authenticator: the enrolment view, whatever the flag says.
      continueToTotp({ ...answer.data, totp_enrolment_required: true }, (path) =>
        router.push(path),
      );
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : undefined;
      if (code === 'token_expired') setProblem('expired');
      else if (code === 'token_invalid') setProblem('invalid');
      else setError(message(failure));
      setBusy(false);
    }
  };

  if (problem !== undefined) {
    return (
      <div className="flex flex-col gap-4" data-link-problem={problem}>
        <h2 className="text-lg font-semibold">
          {problem === 'expired' ? t('link.expired_title') : t('link.invalid_title')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {problem === 'expired' ? t('totp.relink_expired') : t('link.invalid_description')}
        </p>
        <Button asChild variant="secondary">
          <Link href="/sign-in">{t('back_to_sign_in')}</Link>
        </Button>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
      <PasswordField
        label={t('fields.password')}
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy || password === ''}>
        {t('totp.relink_submit')}
      </Button>
    </form>
  );
}
