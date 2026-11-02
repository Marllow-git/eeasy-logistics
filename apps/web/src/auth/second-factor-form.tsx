'use client';

import { client } from '@eeasy-logistics/contracts/staff';
import { useErrorMessage } from '@eeasy-logistics/ui/auth/error-message';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { track } from '../analytics';
import { CodeStep, nextSendAt } from './code-step';
import { authFetcher, continueSignIn, stepStore, useStoredStep } from './steps';

/**
 * `/sign-in/second-factor` (WEB-2 plan 2.7; identity §3.1): the code goes to the phone stored on
 * the user, asked for once on arrival and again on "Resend"; the challenge comes from
 * `sessionStorage`, so a page opened without one goes back to sign-in.
 */
export function SecondFactorForm() {
  const router = useRouter();
  const message = useErrorMessage();
  const challenge = useStoredStep('challenge');
  const [availableAt, setAvailableAt] = useState<number | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const asked = useRef(false);

  useEffect(() => {
    if (challenge === undefined) {
      // After hydration only: a page opened without a sign-in in progress starts one.
      if (stepStore.challenge() === undefined) router.replace('/sign-in');
      return;
    }
    if (asked.current) return;
    asked.current = true;
    const sentAt = Date.now();
    track('auth.second_factor.requested', { surface: 'staff', purpose: 'sign_in' });
    client
      .requestSecondFactor({ challenge_id: challenge }, { fetcher: authFetcher() })
      .then(() => setAvailableAt(nextSendAt(sentAt)))
      .catch((failure: unknown) => {
        setAvailableAt(nextSendAt(sentAt, failure));
        setNotice(message(failure));
      });
  }, [challenge, router, message]);

  if (challenge === undefined) return null;

  return (
    <div className="flex flex-col gap-4">
      {notice === undefined ? null : (
        <p role="status" className="rounded-md border border-border bg-muted p-3 text-sm">
          {notice}
        </p>
      )}
      <CodeStep
        availableAt={availableAt}
        onRestart={stepStore.clear}
        resend={async () => {
          const sentAt = Date.now();
          track('auth.second_factor.requested', { surface: 'staff', purpose: 'resend' });
          try {
            await client.requestSecondFactor(
              { challenge_id: challenge },
              { fetcher: authFetcher() },
            );
            setNotice(undefined);
            setAvailableAt(nextSendAt(sentAt));
          } catch (failure) {
            setAvailableAt(nextSendAt(sentAt, failure));
            throw failure;
          }
        }}
        verify={async (code) => {
          const answer = await client.verifySecondFactor(
            { challenge_id: challenge, code },
            { fetcher: authFetcher() },
          );
          if (answer.status !== 200) throw new Error(`verify answered ${answer.status}`);
          stepStore.passedFactor();
          continueSignIn(answer.data, (path) => router.push(path));
        }}
      />
    </div>
  );
}
