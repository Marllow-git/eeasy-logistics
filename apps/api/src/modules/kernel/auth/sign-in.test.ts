import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '../errors/api-exception.js';
import type {
  IdentityStore,
  IdentityTransaction,
  MembershipRow,
  UserRow,
} from '../platform/identity.repository.js';
import type { Principal } from './principal.js';
import type { RequestFacts } from './request-facts.js';
import type { SessionService } from './sessions.js';
import { StaffSignIn } from './sign-in.js';

// PLAT-13 adversary L-2: a sign-in racing a suspension. The membership is read while its account is
// active; the suspension commits before the session's refresh row is written, so its revocation
// cannot see that row. The start re-reads the account's status after the row and refuses (the
// transaction rolls back) when the account no longer admits sign-in.

vi.mock('./me.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  featuresOf: () => Promise.resolve([]),
}));

const accountId = '019a0000-0000-7000-8000-0000000000a1';
const user: UserRow = {
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
const membership: MembershipRow = {
  id: '019a0000-0000-7000-8000-0000000000b1',
  userId: user.id,
  accountId,
  roles: ['owner'],
  siteIds: [],
  status: 'active',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  account: {
    id: accountId,
    name: 'Acme',
    status: 'active',
    secondFactorRequired: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
};
const principal: Principal = {
  kind: 'staff',
  userId: user.id,
  accountId: '019a0000-0000-7000-8000-0000000000a2',
  membershipId: '019a0000-0000-7000-8000-0000000000b2',
  roles: ['owner'],
  sites: [],
  scopes: '',
  tokenVersion: 1,
  amr: ['pwd'],
};
const facts: RequestFacts = {
  ip: null,
  userAgent: null,
  cookieHeader: undefined,
  requestId: 'req',
  clientRequestId: null,
  principal,
};

/** A store whose account status is `active` when the membership is read and `later` after. */
function signIn(later: string) {
  const calls: string[] = [];
  const tx = {
    users: { find: () => Promise.resolve(user) },
    memberships: {
      findOfUser: () => {
        calls.push('membership');
        return Promise.resolve(membership);
      },
    },
    accounts: {
      lockStatus: () => {
        calls.push('status');
        return Promise.resolve(later);
      },
    },
  } as unknown as IdentityTransaction;
  const store: IdentityStore = { run: (fn) => fn(tx) };
  const sessions = {
    store,
    endCurrent: () => Promise.resolve(),
    start: () => {
      calls.push('refresh row');
      return Promise.resolve({
        accessToken: 'at',
        accessTtlSeconds: 900,
        refreshToken: 'rt',
        refreshTtlSeconds: 3600,
      });
    },
  } as unknown as SessionService;
  const staff = new StaffSignIn({
    sessions,
    passwords: { verify: vi.fn(), hash: vi.fn(), dummyHash: '' },
    breached: { has: () => false },
    resolver: { grantsOf: () => new Map() },
    audit: { record: () => Promise.resolve() },
    limiter: undefined,
    emailKey: Buffer.alloc(32),
  });
  return { staff, calls };
}

const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'started',
    (error: unknown) => (error instanceof ApiException ? error.code : String(error)),
  );

describe('a session start racing a suspension (adversary L-2)', () => {
  it('refuses with account_suspended when the status changed after the membership was read', async () => {
    const { staff, calls } = signIn('suspended');
    expect(await outcome(staff.switchAccount(principal, membership.id, facts))).toBe(
      'account_suspended',
    );
    expect(calls).toEqual(['membership', 'refresh row', 'status']);
  });

  it('refuses a closed account the same way', async () => {
    const { staff } = signIn('closed');
    expect(await outcome(staff.switchAccount(principal, membership.id, facts))).toBe(
      'account_suspended',
    );
  });

  it('starts the session when the account is still active', async () => {
    const { staff, calls } = signIn('active');
    expect(await outcome(staff.switchAccount(principal, membership.id, facts))).toBe('started');
    expect(calls).toEqual(['membership', 'refresh row', 'status']);
  });
});
