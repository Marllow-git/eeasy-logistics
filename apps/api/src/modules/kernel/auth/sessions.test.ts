import { describe, expect, it } from 'vitest';
import type { RefreshState } from '../platform/identity.repository.js';
import { refreshVerdict, userAgentHash } from './sessions.js';

// PLAT-11 plan 2.6, 2.16: the refresh state machine with a fake clock (the database's `now`).

const now = new Date('2026-11-02T10:00:00Z');
const seconds = (n: number) => new Date(now.getTime() + n * 1000);
const agent = userAgentHash('Mozilla/5.0 test');

function row(overrides: Partial<RefreshState> = {}): RefreshState {
  return {
    id: '019a0000-0000-7000-8000-000000000001',
    surface: 'staff',
    userId: '019a0000-0000-7000-8000-000000000002',
    membershipId: '019a0000-0000-7000-8000-000000000003',
    deviceId: null,
    familyId: '019a0000-0000-7000-8000-000000000004',
    tokenVersion: 1,
    amr: ['pwd'],
    userAgentHash: agent,
    successorCiphertext: Buffer.from('sealed'),
    expiresAt: seconds(3600),
    usedAt: null,
    revoked: false,
    now,
    user: { tokenVersion: 1, disabled: false },
    membership: {
      status: 'active',
      accountId: '019a0000-0000-7000-8000-000000000005',
      accountStatus: 'active',
      roles: ['owner'],
      siteIds: [],
    },
    platformStaff: null,
    ...overrides,
  };
}

interface Presented {
  readonly surface: 'staff' | 'platform';
  readonly userAgentHash: Buffer | null;
}
const staff: Presented = { surface: 'staff', userAgentHash: agent };
const verdict = (state: RefreshState, request: Presented = staff, grace = 30) =>
  refreshVerdict(state, request, grace);

describe('refreshVerdict', () => {
  it('rotates a live row', () => {
    expect(verdict(row())).toEqual({ kind: 'rotate' });
  });

  it('answers the same successor for a used row inside the grace, same family and agent', () => {
    expect(verdict(row({ usedAt: seconds(-30) }))).toEqual({ kind: 'grace' });
    expect(verdict(row({ usedAt: seconds(-1) }))).toEqual({ kind: 'grace' });
  });

  it('treats a used row outside the grace as reuse', () => {
    expect(verdict(row({ usedAt: seconds(-31) }))).toEqual({ kind: 'reuse' });
  });

  it('treats a used row from another agent, or with no successor kept, as reuse', () => {
    const other = { surface: 'staff' as const, userAgentHash: userAgentHash('curl/8') };
    expect(verdict(row({ usedAt: seconds(-1) }), other)).toEqual({ kind: 'reuse' });
    expect(
      verdict(row({ usedAt: seconds(-1) }), { surface: 'staff', userAgentHash: null }),
    ).toEqual({ kind: 'reuse' });
    expect(verdict(row({ usedAt: seconds(-1), successorCiphertext: null }))).toEqual({
      kind: 'reuse',
    });
    expect(
      verdict(row({ usedAt: seconds(-1), userAgentHash: null }), {
        surface: 'staff',
        userAgentHash: null,
      }),
    ).toEqual({ kind: 'grace' });
  });

  it('has no grace when it is configured to 0', () => {
    expect(verdict(row({ usedAt: seconds(-1) }), staff, 0)).toEqual({ kind: 'reuse' });
  });

  it('refuses a revoked row or another surface as token_invalid, used or not', () => {
    const invalid = { kind: 'refuse', code: 'token_invalid' };
    expect(verdict(row({ revoked: true }))).toEqual(invalid);
    expect(verdict(row({ revoked: true, usedAt: seconds(-100) }))).toEqual(invalid);
    expect(verdict(row(), { surface: 'platform', userAgentHash: agent })).toEqual(invalid);
  });

  it('answers token_expired for an expired live row', () => {
    expect(verdict(row({ expiresAt: now }))).toEqual({ kind: 'refuse', code: 'token_expired' });
  });

  it('refuses when the token version moved, the user is disabled or the membership ended', () => {
    const invalid = { kind: 'refuse', code: 'token_invalid' };
    expect(verdict(row({ user: { tokenVersion: 2, disabled: false } }))).toEqual(invalid);
    expect(verdict(row({ user: { tokenVersion: 1, disabled: true } }))).toEqual(invalid);
    const revoked = { ...row().membership!, status: 'revoked' as const };
    expect(verdict(row({ membership: revoked }))).toEqual(invalid);
    expect(verdict(row({ membership: null }))).toEqual(invalid);
    // A used row inside the grace is refused too: no successor after a reset.
    expect(
      verdict(row({ usedAt: seconds(-1), user: { tokenVersion: 2, disabled: false } })),
    ).toEqual(invalid);
  });

  it('answers 403 account_suspended for a suspended account and 401 for a closed one', () => {
    const membership = row().membership!;
    expect(verdict(row({ membership: { ...membership, accountStatus: 'suspended' } }))).toEqual({
      kind: 'refuse',
      code: 'account_suspended',
    });
    expect(verdict(row({ membership: { ...membership, accountStatus: 'closed' } }))).toEqual({
      kind: 'refuse',
      code: 'token_invalid',
    });
  });

  it('checks the platform staff row on the platform surface', () => {
    const platform = {
      surface: 'platform' as const,
      membershipId: null,
      membership: null,
      platformStaff: { role: 'admin' as const, revoked: false },
    };
    const request = { surface: 'platform' as const, userAgentHash: agent };
    expect(verdict(row(platform), request)).toEqual({ kind: 'rotate' });
    expect(
      verdict(row({ ...platform, platformStaff: { role: 'admin', revoked: true } }), request),
    ).toEqual({ kind: 'refuse', code: 'token_invalid' });
    expect(verdict(row({ ...platform, platformStaff: null }), request)).toEqual({
      kind: 'refuse',
      code: 'token_invalid',
    });
  });

  it('ends a platform session after 12 hours idle: the row expires 12 h after its last rotation', () => {
    // Item G: a platform row's `expires_at` is its rotation time plus the idle TTL (sliding), so
    // the fake clock 12 h after the last rotation finds it expired, and a second earlier still live.
    const platform = {
      surface: 'platform' as const,
      membershipId: null,
      membership: null,
      platformStaff: { role: 'super_admin' as const, revoked: false },
    };
    const request = { surface: 'platform' as const, userAgentHash: agent };
    const rotatedAt = now.getTime();
    const idle = 43_200 * 1000;
    const at = (ms: number) =>
      row({ ...platform, expiresAt: new Date(rotatedAt + idle), now: new Date(ms) });
    expect(verdict(at(rotatedAt + idle - 1000), request)).toEqual({ kind: 'rotate' });
    expect(verdict(at(rotatedAt + idle), request)).toEqual({
      kind: 'refuse',
      code: 'token_expired',
    });
  });
});
