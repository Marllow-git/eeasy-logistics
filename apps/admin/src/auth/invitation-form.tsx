'use client';

import { ApiError } from '@eeasy-logistics/contracts/http';
import { client } from '@eeasy-logistics/contracts/platform';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import { PasswordField, passwordMinLength } from '@eeasy-logistics/ui/auth/password-field';
import { Button } from '@eeasy-logistics/ui/components/button';
import { Input } from '@eeasy-logistics/ui/components/input';
import { Label } from '@eeasy-logistics/ui/components/label';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { authFetcher, continueToTotp, stepStore } from './steps';

// `/invitations/[token]` of the console (WEB-2 plan 2.9; PLAT-11 2.9, 8.2 #39): a platform staff
// invitation from its mail. Name and password through `platformAcceptInvitation`, whose answer is
// a TOTP challenge: on to `/sign-in/totp` and its enrolment view. The link's token reaches the page
// in its path (the mail is the channel) and goes to the API in the body.

type LinkProblem = 'expired' | 'invalid';

function linkProblem(error: unknown): LinkProblem | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (error.code === 'token_expired') return 'expired';
  if (error.code === 'token_invalid') return 'invalid';
  return undefined;
}

/** The first field error code at `pointer` of a `validation_failed` answer. */
function fieldError(error: unknown, pointer: string): string | undefined {
  if (!(error instanceof ApiError) || error.code !== 'validation_failed') return undefined;
  const fields = error.details?.fields;
  if (!Array.isArray(fields)) return undefined;
  for (const field of fields as unknown[]) {
    if (typeof field !== 'object' || field === null) continue;
    const entry = field as { pointer?: unknown; code?: unknown };
    if (entry.pointer === pointer && typeof entry.code === 'string') return entry.code;
  }
  return undefined;
}

export function InvitationForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const message = useErrorMessage();
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
      const answer = await client.platformAcceptInvitation(
        { token, name: name.trim(), password },
        { fetcher: authFetcher() },
      );
      if (answer.status !== 200) throw new Error(`accept answered ${answer.status}`);
      continueToTotp(answer.data, (path) => router.push(path));
    } catch (failure) {
      const link = linkProblem(failure);
      if (link !== undefined) setProblem(link);
      const code = fieldError(failure, '/body/password');
      if (code === 'breached') setFieldErrors({ password: t('password.breached') });
      else if (code === 'too_short') setFieldErrors({ password: t('password.too_short') });
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
          {problem === 'expired' ? t('link.expired_description') : t('link.invalid_description')}
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
