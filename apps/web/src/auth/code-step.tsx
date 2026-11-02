'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { CodeInput, codeLength } from '@eeasy-logistics/ui/auth/code-input';
import { retryAfterSeconds, useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import { ResendButton } from '@eeasy-logistics/ui/auth/resend-button';
import { Button } from '@eeasy-logistics/ui/components/button';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

/** The local resend cooldown (PLAT-9's 60 s per phone); `Retry-After` wins when it is later. */
export const resendCooldownMs = 60_000;
/** Wrong codes allowed per challenge (identity §3.1, errors.md `otp_invalid`). */
export const maxAttempts = 5;

/** When a resend is allowed after `error` (or a fresh send at `sentAt`). */
export function nextSendAt(sentAt: number, error?: unknown): number {
  const wait = retryAfterSeconds(error);
  return Math.max(sentAt + resendCooldownMs, wait === undefined ? 0 : Date.now() + wait * 1000);
}

export type CodeOutcome = 'done' | 'retry' | 'ended';

/**
 * Six-digit code entry with resend and the attempt limit (WEB-2 plan 2.7): a wrong code empties
 * the cells and shows the refusal; the fifth wrong code, an expired or used challenge, or a refused
 * step ends the flow with a way back to sign-in. `verify` throws the API's error or resolves when
 * the page moved on.
 */
export function CodeStep({
  verify,
  resend,
  availableAt,
  onRestart,
}: {
  verify: (code: string) => Promise<void>;
  resend: () => Promise<void>;
  availableAt: number | undefined;
  onRestart: () => void;
}) {
  const t = useTranslations('auth');
  const message = useErrorMessage();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [ended, setEnded] = useState<string | undefined>();
  const [wrong, setWrong] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    if (busy || value.length !== codeLength) return;
    setBusy(true);
    setError(undefined);
    try {
      await verify(value);
    } catch (failure) {
      setCode('');
      const code = failure instanceof ApiError ? failure.code : undefined;
      if (code === 'otp_invalid') {
        const count = wrong + 1;
        setWrong(count);
        if (count >= maxAttempts) setEnded(t('second_factor.exhausted'));
        else setError(message(failure));
      } else if (code === 'token_expired' || code === 'token_invalid') {
        setEnded(t('second_factor.expired'));
      } else {
        setError(message(failure));
      }
      setBusy(false);
    }
  };

  if (ended !== undefined) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-sm text-danger">
          {ended}
        </p>
        <Button asChild>
          <Link href="/sign-in" onClick={onRestart}>
            {t('second_factor.back')}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void submit(code);
      }}
      noValidate
    >
      <CodeInput
        value={code}
        onChange={setCode}
        onComplete={(value) => void submit(value)}
        error={error}
        disabled={busy}
        autoFocus
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ResendButton
          availableAt={availableAt}
          busy={busy}
          onResend={() => {
            setError(undefined);
            void resend().catch((failure: unknown) => setError(message(failure)));
          }}
        />
        <Link href="/sign-in" onClick={onRestart} className="text-sm font-semibold text-primary">
          {t('second_factor.back')}
        </Link>
      </div>
      <Button type="submit" disabled={busy || code.length !== codeLength}>
        {t('second_factor.submit')}
      </Button>
    </form>
  );
}
