'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '../components/button/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/dialog/dialog';
import { useTranslations } from '../intl';
import { CodeInput, codeLength } from './code-input';
import { PasswordField } from './password-field';

/** What one step of signing in again came to. */
export type ReauthOutcome =
  | { readonly kind: 'done' }
  /** The API asks for the second factor (staff phone code, platform TOTP). */
  | { readonly kind: 'code' }
  /** Refused: the message to show (from the `errors` catalogue). */
  | { readonly kind: 'error'; readonly message: string };

/** The surface's sign-in steps for the user already on the page (the app supplies them). */
export interface Reauthentication {
  password(password: string): Promise<ReauthOutcome>;
  code(code: string): Promise<ReauthOutcome>;
}

export interface ReSignInDialogProps {
  open: boolean;
  /** The steps; `done` closes the dialog through `onSignedIn`. */
  reauthentication: Reauthentication;
  onSignedIn: () => void;
  /** The user closed the dialog without signing in. */
  onDismiss: () => void;
  /** "Sign in with another account": a full sign-in, the page's state given up. */
  onOtherAccount: () => void;
  /** The code step's line (`auth.session.dialog_code_description` by default). */
  codeDescription?: string;
}

/**
 * The session-ended dialog for a page with unsaved state (web §3.4; WEB-2 plan 2.8; the Employment
 * Hero and Rocket Money references): over the dimmed page, the password, then the code when the
 * API asks for it; the page and its state stay under it, and the failed request is retried once the
 * user is back (the session fetcher does that with its original `Idempotency-Key`).
 */
export function ReSignInDialog({
  open,
  reauthentication,
  onSignedIn,
  onDismiss,
  onOtherAccount,
  codeDescription,
}: ReSignInDialogProps) {
  const t = useTranslations('auth');
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const settle = (outcome: ReauthOutcome) => {
    if (outcome.kind === 'done') {
      setStep('password');
      setPassword('');
      setCode('');
      setError(undefined);
      onSignedIn();
    } else if (outcome.kind === 'code') {
      setStep('code');
      setError(undefined);
    } else {
      setError(outcome.message);
      if (step === 'code') setCode('');
    }
  };

  const run = async (work: () => Promise<ReauthOutcome>) => {
    setBusy(true);
    try {
      settle(await work());
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    if (password === '' || busy) return;
    void run(() => reauthentication.password(password));
  };
  const submitCode = (value: string) => {
    if (value.length !== codeLength || busy) return;
    void run(() => reauthentication.code(value));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      <DialogContent>
        <DialogTitle>{t('session.dialog_title')}</DialogTitle>
        <DialogDescription>
          {step === 'password'
            ? t('session.dialog_description')
            : (codeDescription ?? t('session.dialog_code_description'))}
        </DialogDescription>
        {step === 'password' ? (
          <form className="flex flex-col gap-4" onSubmit={submitPassword} noValidate>
            <PasswordField
              label={t('fields.password')}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={error}
              disabled={busy}
              required
            />
            <Button type="submit" disabled={busy || password === ''}>
              {t('session.dialog_submit')}
            </Button>
          </form>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitCode(code);
            }}
            noValidate
          >
            <CodeInput
              value={code}
              onChange={setCode}
              onComplete={submitCode}
              error={error}
              disabled={busy}
              autoFocus
            />
            <Button type="submit" disabled={busy || code.length !== codeLength}>
              {t('session.dialog_verify')}
            </Button>
          </form>
        )}
        <Button type="button" variant="ghost" onClick={onOtherAccount}>
          {t('session.dialog_other_user')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
