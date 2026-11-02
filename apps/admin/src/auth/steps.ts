'use client';

import { createSessionFetcher, type Fetcher } from '@eeasy-logistics/contracts/http';
import type { TotpChallenge } from '@eeasy-logistics/contracts/platform';
import { safeNextPath } from '@eeasy-logistics/ui/session/tokens';
import { useSyncExternalStore } from 'react';
import { track } from '../analytics';

// The console's sign-in steps between pages (WEB-2 plan 2.9): the password step or an accepted
// invitation answers a TOTP challenge, which travels to `/sign-in/totp` in `sessionStorage` (this
// tab only, gone when it closes), never in a URL, a log or an analytics event. The doors are called
// same-origin with the web client marker (`createSessionFetcher`; the doors never refresh).

const keys = {
  challenge: 'el_platform_challenge',
  enrol: 'el_platform_enrol',
  next: 'el_platform_next',
} as const;

let doorFetcher: Fetcher | undefined;

/** The fetcher of the console's sign-in doors. */
export function authFetcher(): Fetcher {
  doorFetcher ??= createSessionFetcher({
    surface: 'platform',
    locale: () => (document.documentElement.lang === 'en' ? 'en' : 'ar'),
  });
  return doorFetcher;
}

function read(key: string): string | undefined {
  try {
    return window.sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string | undefined): void {
  try {
    if (value === undefined) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Storage off: the flow restarts at sign-in, nothing worse.
  }
}

/** The TOTP step of a sign-in in progress. */
export interface TotpStep {
  readonly challenge: string;
  /** No TOTP yet: the enrolment view (QR, key, first code) instead of the code entry. */
  readonly enrol: boolean;
}

export const stepStore = {
  step: (): TotpStep | undefined => {
    const challenge = read(keys.challenge);
    return challenge === undefined ? undefined : { challenge, enrol: read(keys.enrol) === '1' };
  },
  next: () => safeNextPath(read(keys.next)),
  setNext: (next: string | undefined) => write(keys.next, safeNextPath(next)),
  /** The view switches to code entry (the user had TOTP after all: `409` on enrol). */
  setEnrolled: () => write(keys.enrol, undefined),
  /** Forgets every step token (a finished, abandoned or failed sign-in). */
  clear: () => {
    for (const key of Object.values(keys)) write(key, undefined);
  },
};

const noSubscription = () => () => undefined;

/**
 * The stored step for rendering, as `challenge` plus `:enrol` when enrolling (a string, so the
 * snapshot is stable): undefined on the server and during hydration, then the stored value.
 */
export function useStoredStep(): string | undefined {
  return useSyncExternalStore(
    noSubscription,
    () => {
      const step = stepStore.step();
      return step === undefined
        ? undefined
        : `${step.enrol ? 'enrol' : 'verify'}:${step.challenge}`;
    },
    () => undefined,
  );
}

/** Parses `useStoredStep()`'s value. */
export function parseStoredStep(value: string): TotpStep {
  const separator = value.indexOf(':');
  return { enrol: value.slice(0, separator) === 'enrol', challenge: value.slice(separator + 1) };
}

/** A challenge from the password step or an accepted invitation: on to `/sign-in/totp`. */
export function continueToTotp(answer: TotpChallenge, push: (path: string) => void): void {
  if (typeof answer.challenge_id !== 'string') {
    throw new Error('A console sign-in answer without a challenge');
  }
  write(keys.challenge, answer.challenge_id);
  write(keys.enrol, answer.totp_enrolment_required === true ? '1' : undefined);
  push('/sign-in/totp');
}

/** A session started: the stored `next` (or home) with a full load, so the layout sees the cookies. */
export function finishSignIn(enrolled: boolean): void {
  const target = stepStore.next() ?? '/';
  stepStore.clear();
  track('auth.sign_in.succeeded', { surface: 'platform', amr_count: 2, enrolled });
  window.location.assign(target);
}
