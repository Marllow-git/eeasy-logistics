'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { client } from '@eeasy-logistics/contracts/platform';
import { AuthCard } from '@eeasy-logistics/ui/auth/auth-card';
import { CodeInput, codeLength } from '@eeasy-logistics/ui/auth/code-input';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import { ManualKey, secretFromOtpauth } from '@eeasy-logistics/ui/auth/manual-key';
import { QrCode } from '@eeasy-logistics/ui/auth/qr-code';
import { Button } from '@eeasy-logistics/ui/components/button';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { authFetcher, finishSignIn, parseStoredStep, stepStore, useStoredStep } from './steps';

// `/sign-in/totp` (WEB-2 plan 2.9; identity §3.3): the second step of every console sign-in. With
// TOTP enrolled, the code entry (`platformVerifyTotp`); on first use (`totp_enrolment_required`),
// the enrolment view (the Vimeo, Mercury and Airwallex references): `platformEnrolTotp` once, the
// otpauth URI as a QR code and its secret as a manual key, then the first code
// (`platformConfirmTotp`) starts the session. The URI and the secret live in this component's
// memory only: never in a URL, `sessionStorage`, a log line or an analytics event.

/** Wrong codes allowed per challenge (PLAT-11 2.9, `otp_invalid`). */
const maxAttempts = 5;

/** The code entry with the attempt limit; `submit` throws the API's error or moves the page on. */
function CodeForm({
  submit,
  submitLabel,
  onEnded,
}: {
  submit: (code: string) => Promise<void>;
  submitLabel: string;
  onEnded: (reason: 'exhausted' | 'expired') => void;
}) {
  const message = useErrorMessage();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [wrong, setWrong] = useState(0);
  const [busy, setBusy] = useState(false);

  const send = async (value: string) => {
    if (busy || value.length !== codeLength) return;
    setBusy(true);
    setError(undefined);
    try {
      await submit(value);
    } catch (failure) {
      setCode('');
      const errorCode = failure instanceof ApiError ? failure.code : undefined;
      if (errorCode === 'otp_invalid') {
        const count = wrong + 1;
        setWrong(count);
        if (count >= maxAttempts) onEnded('exhausted');
        else setError(message(failure));
      } else if (errorCode === 'token_expired' || errorCode === 'token_invalid') {
        onEnded('expired');
      } else {
        setError(message(failure));
      }
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void send(code);
      }}
      noValidate
    >
      <CodeInput
        value={code}
        onChange={setCode}
        onComplete={(value) => void send(value)}
        error={error}
        disabled={busy}
        autoFocus
      />
      <Button type="submit" disabled={busy || code.length !== codeLength}>
        {submitLabel}
      </Button>
    </form>
  );
}

function BackToSignIn() {
  const t = useTranslations('auth');
  return (
    <Link
      href="/sign-in"
      onClick={stepStore.clear}
      className="self-center text-sm font-semibold text-primary"
    >
      {t('back_to_sign_in')}
    </Link>
  );
}

function Ended({ reason }: { reason: 'exhausted' | 'expired' }) {
  const t = useTranslations('auth');
  return (
    <div className="flex flex-col gap-4">
      <p role="alert" className="text-sm text-danger">
        {reason === 'exhausted' ? t('totp.exhausted') : t('second_factor.expired')}
      </p>
      <Button asChild>
        <Link href="/sign-in" onClick={stepStore.clear}>
          {t('back_to_sign_in')}
        </Link>
      </Button>
    </div>
  );
}

/** TOTP enrolled: the code the app shows. */
function Verify({ challenge }: { challenge: string }) {
  const t = useTranslations('auth');
  const [ended, setEnded] = useState<'exhausted' | 'expired' | undefined>();
  return (
    <AuthCard title={t('totp.title')} description={t('totp.description')}>
      {ended === undefined ? (
        <>
          <CodeForm
            submitLabel={t('totp.submit')}
            onEnded={setEnded}
            submit={async (code) => {
              const answer = await client.platformVerifyTotp(
                { challenge_id: challenge, code },
                { fetcher: authFetcher() },
              );
              if (answer.status !== 200) throw new Error(`verify answered ${answer.status}`);
              finishSignIn(false);
            }}
          />
          <BackToSignIn />
        </>
      ) : (
        <Ended reason={ended} />
      )}
    </AuthCard>
  );
}

/** First use: the QR code and the key, then the first code. */
function Enrol({ challenge, onEnrolled }: { challenge: string; onEnrolled: () => void }) {
  const t = useTranslations('auth');
  const message = useErrorMessage();
  const [uri, setUri] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | undefined>();
  const [ended, setEnded] = useState<'exhausted' | 'expired' | undefined>();
  const asked = useRef(false);

  useEffect(() => {
    // Once per challenge: a second enrol would replace the pending secret (PLAT-11 8.2 #37) and
    // leave an app holding the first one.
    if (asked.current) return;
    asked.current = true;
    client
      .platformEnrolTotp({ challenge_id: challenge }, { fetcher: authFetcher() })
      .then((answer) => {
        const value = answer.status === 200 ? answer.data.otpauth_uri : undefined;
        if (typeof value !== 'string' || secretFromOtpauth(value) === undefined) {
          throw new Error('An enrolment answer without a usable otpauth URI');
        }
        setUri(value);
      })
      .catch((failure: unknown) => {
        const code = failure instanceof ApiError ? failure.code : undefined;
        if (code === 'second_factor_already_enrolled') onEnrolled();
        else if (code === 'token_expired' || code === 'token_invalid') setEnded('expired');
        else setProblem(message(failure));
      });
  }, [challenge, message, onEnrolled]);

  const secret = uri === undefined ? undefined : secretFromOtpauth(uri);
  let body: ReactNode;
  if (ended !== undefined) body = <Ended reason={ended} />;
  else if (problem !== undefined) {
    body = (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
        <BackToSignIn />
      </div>
    );
  } else if (uri === undefined || secret === undefined) {
    body = (
      <p role="status" className="text-sm text-muted-foreground">
        {t('totp.preparing')}
      </p>
    );
  } else {
    body = (
      <>
        <ol className="flex flex-col gap-4 text-sm text-foreground">
          <li className="flex gap-3">
            <span aria-hidden className="font-semibold text-muted-foreground">
              1
            </span>
            <span>{t('totp.step_install')}</span>
          </li>
          <li className="flex flex-col gap-3">
            <span className="flex gap-3">
              <span aria-hidden className="font-semibold text-muted-foreground">
                2
              </span>
              <span>{t('totp.step_scan')}</span>
            </span>
            <QrCode value={uri} label={t('totp.qr_label')} className="self-center" />
            <ManualKey secret={secret} />
          </li>
          <li className="flex gap-3">
            <span aria-hidden className="font-semibold text-muted-foreground">
              3
            </span>
            <span>{t('totp.step_code')}</span>
          </li>
        </ol>
        <CodeForm
          submitLabel={t('totp.confirm')}
          onEnded={setEnded}
          submit={async (code) => {
            const answer = await client.platformConfirmTotp(
              { challenge_id: challenge, code },
              { fetcher: authFetcher() },
            );
            if (answer.status !== 200) throw new Error(`confirm answered ${answer.status}`);
            finishSignIn(true);
          }}
        />
        <BackToSignIn />
      </>
    );
  }

  return (
    <AuthCard title={t('totp.enrol_title')} description={t('totp.enrol_description')}>
      {body}
    </AuthCard>
  );
}

/** The step stored by the password page or the invitation; without one, back to sign-in. */
export function TotpDoor() {
  const router = useRouter();
  const stored = useStoredStep();
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    // After hydration only: a page opened without a sign-in in progress starts one.
    if (stored === undefined && stepStore.step() === undefined) router.replace('/sign-in');
  }, [stored, router]);

  if (stored === undefined) return null;
  const step = parseStoredStep(stored);
  if (step.enrol && !enrolled) {
    return (
      <Enrol
        challenge={step.challenge}
        onEnrolled={() => {
          stepStore.setEnrolled();
          setEnrolled(true);
        }}
      />
    );
  }
  return <Verify challenge={step.challenge} />;
}
