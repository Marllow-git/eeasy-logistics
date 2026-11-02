'use client';

import { ApiError, createSessionFetcher, type Fetcher } from '@eeasy-logistics/contracts/http';
import type { LoginResponse, LoginResponseMembershipsItem } from '@eeasy-logistics/contracts/staff';
import { safeNextPath } from '@eeasy-logistics/ui/session/tokens';
import { useSyncExternalStore } from 'react';
import { track } from '../analytics';

// The sign-in steps between pages (WEB-2 plan 2.7): what one door answers decides the next page,
// and the step's token travels in `sessionStorage` (this tab only, gone when it closes), never in
// a URL, a log or an analytics event. The doors are called same-origin with the web client marker
// (`createSessionFetcher`; the doors themselves never refresh).

const keys = {
  challenge: 'el_auth_challenge',
  enrolment: 'el_auth_enrolment',
  selection: 'el_auth_selection',
  next: 'el_auth_next',
  factors: 'el_auth_factors',
} as const;

let doorFetcher: Fetcher | undefined;

/** The fetcher of the sign-in doors. */
export function authFetcher(): Fetcher {
  doorFetcher ??= createSessionFetcher({
    surface: 'staff',
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

export interface Selection {
  readonly token: string;
  readonly memberships: readonly LoginResponseMembershipsItem[];
}

export const stepStore = {
  challenge: () => read(keys.challenge),
  enrolment: () => read(keys.enrolment),
  selection: (): Selection | undefined => {
    const raw = read(keys.selection);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as Selection;
    } catch {
      return undefined;
    }
  },
  next: () => safeNextPath(read(keys.next)),
  setNext: (next: string | undefined) => write(keys.next, safeNextPath(next)),
  setChallenge: (challenge: string) => write(keys.challenge, challenge),
  setEnrolment: (token: string) => write(keys.enrolment, token),
  /** Factors passed so far in this sign-in (password, then the code): `amr` length for analytics. */
  passedFactor: () => write(keys.factors, String(Number(read(keys.factors) ?? '1') + 1)),
  /** Forgets every step token (a finished, abandoned or failed sign-in). */
  clear: () => {
    for (const key of Object.values(keys)) write(key, undefined);
  },
};

const noSubscription = () => () => undefined;

/**
 * A stored step token for rendering: undefined on the server and during hydration, then the
 * stored value (sessionStorage does not change under a page, so nothing to subscribe to).
 */
export function useStoredStep(step: 'challenge' | 'enrolment' | 'selection'): string | undefined {
  return useSyncExternalStore(
    noSubscription,
    () => read(keys[step]),
    () => undefined,
  );
}

/** Where a finished sign-in goes: the stored `next`, else home. */
function landing(): string {
  return stepStore.next() ?? '/';
}

/** The next page of a sign-in for a door's answer; a session ends the flow with a full load. */
export function continueSignIn(answer: LoginResponse, push: (path: string) => void): void {
  if (answer.me !== undefined && answer.me !== null) {
    const factors = Number(read(keys.factors) ?? '1');
    const target = landing();
    stepStore.clear();
    track('auth.sign_in.succeeded', { surface: 'staff', amr_count: factors });
    // A full load, so the (merchant) layout renders with the new cookies.
    window.location.assign(target);
    return;
  }
  if (answer.second_factor_required === true && typeof answer.challenge_id === 'string') {
    stepStore.setChallenge(answer.challenge_id);
    push('/sign-in/second-factor');
    return;
  }
  if (answer.enrolment_required === true && typeof answer.enrolment_token === 'string') {
    stepStore.setEnrolment(answer.enrolment_token);
    push('/sign-in/second-factor/enrol');
    return;
  }
  if (answer.account_selection_required === true && typeof answer.selection_token === 'string') {
    write(
      keys.selection,
      JSON.stringify({ token: answer.selection_token, memberships: answer.memberships ?? [] }),
    );
    push('/sign-in/select-account');
    return;
  }
  throw new Error('An answer of the sign-in doors that names no next step');
}

/**
 * A `401 second_factor_required` from `selectAccount` or `acceptInvitation` (PLAT-11 8.2 #21) as
 * the `LoginResponse` it stands for, or undefined for any other error.
 */
export function factorRequired(error: unknown): LoginResponse | undefined {
  if (!(error instanceof ApiError) || error.code !== 'second_factor_required') return undefined;
  const challenge = error.details?.challenge_id;
  const enrolment = error.details?.enrolment_token;
  if (typeof challenge === 'string')
    return { second_factor_required: true, challenge_id: challenge };
  if (typeof enrolment === 'string')
    return { enrolment_required: true, enrolment_token: enrolment };
  return undefined;
}

/** The `code` of the first field error at `pointer` in a `validation_failed` answer. */
export function fieldError(error: unknown, pointer: string): string | undefined {
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
