'use client';

import { ApiError, type Fetcher } from '@eeasy-logistics/contracts/http';
import { client, type LoginResponse, type Me } from '@eeasy-logistics/contracts/staff';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import type { ReauthOutcome, Reauthentication } from '@eeasy-logistics/ui/auth/re-sign-in-dialog';
import { useTranslations } from '@eeasy-logistics/ui/intl';
import { SessionProvider } from '@eeasy-logistics/ui/session';
import { useCallback, type ReactNode } from 'react';
import { track } from '../analytics';

/**
 * The staff steps of the re-sign-in dialog (web §3.4, WEB-2 plan 2.8): the password through
 * `login` for the user on the page, the phone code when the API asks for one, and the account the
 * page was on when `login` answers a selection.
 */
export function staffReauthentication(
  fetcher: Fetcher,
  me: Me,
  messages: { error: (error: unknown) => string; fullSignIn: string },
): Reauthentication {
  let challengeId: string | undefined;
  const membershipId = me.membership?.id;

  const askForCode = async (challenge: string): Promise<ReauthOutcome> => {
    challengeId = challenge;
    await client.requestSecondFactor({ challenge_id: challenge }, { fetcher });
    return { kind: 'code' };
  };

  const next = async (answer: LoginResponse): Promise<ReauthOutcome> => {
    if (answer.me !== undefined && answer.me !== null) return { kind: 'done' };
    if (answer.second_factor_required === true && typeof answer.challenge_id === 'string') {
      return askForCode(answer.challenge_id);
    }
    if (
      answer.account_selection_required === true &&
      typeof answer.selection_token === 'string' &&
      membershipId !== undefined
    ) {
      try {
        await client.selectAccount(
          { selection_token: answer.selection_token, membership_id: membershipId },
          { fetcher },
        );
        return { kind: 'done' };
      } catch (error) {
        const challenge = error instanceof ApiError ? error.details?.challenge_id : undefined;
        if (typeof challenge === 'string') return askForCode(challenge);
        throw error;
      }
    }
    // Enrolment, or an account no longer offered: only a full sign-in can continue.
    return { kind: 'error', message: messages.fullSignIn };
  };

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
        const answer = await client.login({ email, password }, { fetcher });
        return next(answer.data as LoginResponse);
      }),
    code: (code) =>
      attempt(async () => {
        if (challengeId === undefined) throw new Error('no challenge');
        const answer = await client.verifySecondFactor(
          { challenge_id: challengeId, code },
          { fetcher },
        );
        return next(answer.data as LoginResponse);
      }),
  };
}

/** The (merchant) session provider with the staff steps and the `auth.session.ended` event. */
export function StaffSession({ me, children }: { me: Me; children: ReactNode }) {
  const error = useErrorMessage();
  const t = useTranslations('auth.session');
  const fullSignIn = t('full_sign_in');
  const reauthentication = useCallback(
    (fetcher: Fetcher, current: Me) =>
      staffReauthentication(fetcher, current, { error, fullSignIn }),
    [error, fullSignIn],
  );
  return (
    <SessionProvider
      me={me}
      surface="staff"
      reauthentication={reauthentication}
      onSessionEnded={(reason) => track('auth.session.ended', { reason })}
    >
      {children}
    </SessionProvider>
  );
}
