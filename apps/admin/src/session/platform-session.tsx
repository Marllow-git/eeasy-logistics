'use client';

import type { Fetcher } from '@eeasy-logistics/contracts/http';
import { client, type PlatformMe } from '@eeasy-logistics/contracts/platform';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import type { ReauthOutcome, Reauthentication } from '@eeasy-logistics/ui/auth/re-sign-in-dialog';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { SessionProvider } from '@eeasy-logistics/ui/session';
import { useCallback, type ReactNode } from 'react';
import { track } from '../analytics';

/**
 * The console's steps for the re-sign-in dialog (web §3.4; WEB-2 plan 2.8, 2.9): the password
 * through `platformLogin` for the user on the page, then always the TOTP code through
 * `platformVerifyTotp`. A user without TOTP (enrolment required) can only continue from the
 * sign-in page.
 */
export function platformReauthentication(
  fetcher: Fetcher,
  me: PlatformMe,
  messages: { error: (error: unknown) => string; fullSignIn: string },
): Reauthentication {
  let challengeId: string | undefined;

  const attempt = async (work: () => Promise<ReauthOutcome>): Promise<ReauthOutcome> => {
    try {
      return await work();
    } catch (error) {
      return { kind: 'error', message: messages.error(error) };
    }
  };

  return {
    password: (password) =>
      attempt(async () => {
        const email = me.user?.email;
        if (email === undefined || email === null) throw new Error('no email on the session');
        const answer = await client.platformLogin({ email, password }, { fetcher });
        if (answer.status !== 200) throw new Error(`platformLogin answered ${answer.status}`);
        if (answer.data.totp_enrolment_required === true) {
          return { kind: 'error', message: messages.fullSignIn };
        }
        if (typeof answer.data.challenge_id !== 'string') throw new Error('no challenge');
        challengeId = answer.data.challenge_id;
        return { kind: 'code' };
      }),
    code: (code) =>
      attempt(async () => {
        if (challengeId === undefined) throw new Error('no challenge');
        const answer = await client.platformVerifyTotp(
          { challenge_id: challengeId, code },
          { fetcher },
        );
        if (answer.status !== 200) throw new Error(`platformVerifyTotp answered ${answer.status}`);
        return { kind: 'done' };
      }),
  };
}

/** The (platform) session provider: the platform surface, its lock and the TOTP re-sign-in. */
export function PlatformSession({ me, children }: { me: PlatformMe; children: ReactNode }) {
  const error = useErrorMessage();
  const t = useTranslations('auth');
  const fullSignIn = t('session.full_sign_in');
  const reauthentication = useCallback(
    (fetcher: Fetcher, current: PlatformMe) =>
      platformReauthentication(fetcher, current, { error, fullSignIn }),
    [error, fullSignIn],
  );
  return (
    <SessionProvider
      me={me}
      surface="platform"
      reauthentication={reauthentication}
      codeDescription={t('totp.description')}
      onSessionEnded={(reason) => track('auth.session.ended', { reason })}
    >
      {children}
    </SessionProvider>
  );
}
