import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '../errors/api-exception.js';
import type {
  IdentityStore,
  IdentityTransaction,
  UserRow,
} from '../platform/identity.repository.js';
import { PlatformSignIn } from './platform-sign-in.js';
import type { RequestFacts } from './request-facts.js';
import type { SessionService } from './sessions.js';

// PLAT-11 adversary L-2: `platformLogin` does the same database work for an unknown email as for a
// known one (the user lookup, then the staff lookup), so the single password verification is the
// only cost that differs.

const known: UserRow = {
  id: '019a0000-0000-7000-8000-000000000001',
  name: 'Huda',
  email: 'huda@example.test',
  phone: null,
  locale: 'en',
  passwordHash: '$argon2id$stored',
  tokenVersion: 1,
  secondFactorEnabled: false,
  secondFactorPhone: null,
  disabled: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const facts: RequestFacts = {
  ip: null,
  userAgent: null,
  cookieHeader: undefined,
  requestId: 'req',
  clientRequestId: null,
  principal: undefined,
};

function signIn() {
  const findStaff = vi.fn(() => Promise.resolve(undefined));
  const verify = vi.fn(() => Promise.resolve({ ok: false, needsRehash: false }));
  const tx = {
    users: {
      findByEmail: (email: string) => Promise.resolve(email === known.email ? known : undefined),
    },
    platformStaff: { find: findStaff },
  } as unknown as IdentityTransaction;
  const store: IdentityStore = { run: (fn) => fn(tx) };
  const platform = new PlatformSignIn({
    sessions: { store } as unknown as SessionService,
    passwords: { verify, hash: () => Promise.resolve(''), dummyHash: '$argon2id$dummy' },
    breached: { has: () => false },
    resolver: undefined,
    audit: { record: () => Promise.resolve() },
    limiter: undefined,
    emailRef: (email) => `email:${email}`,
    cipher: null,
    totpIssuer: 'Eeasy',
  });
  return { platform, findStaff, verify };
}

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof ApiException ? error.code : 'other'),
  );

describe('platformLogin lookups (adversary L-2)', () => {
  it('looks up the staff row once whether or not a user has the email', async () => {
    const unknown = signIn();
    expect(
      await refusal(unknown.platform.login({ email: 'nobody@example.test', password: 'x' }, facts)),
    ).toBe('invalid_credentials');
    expect(unknown.findStaff).toHaveBeenCalledTimes(1);
    expect(unknown.verify).toHaveBeenCalledTimes(1);

    const user = signIn();
    expect(
      await refusal(user.platform.login({ email: known.email ?? '', password: 'x' }, facts)),
    ).toBe('invalid_credentials');
    expect(user.findStaff).toHaveBeenCalledTimes(1);
    expect(user.findStaff).toHaveBeenCalledWith(known.id);
    expect(user.verify).toHaveBeenCalledTimes(1);
  });
});
