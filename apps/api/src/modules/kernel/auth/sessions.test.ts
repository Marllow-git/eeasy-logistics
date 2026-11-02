import type { CredentialsCipher } from '@eeasy-logistics/config';
import { describe, expect, it, vi } from 'vitest';
import type {
  IdentityStore,
  IdentityTransaction,
  RefreshState,
} from '../platform/identity.repository.js';
import type { RequestFacts } from './request-facts.js';
import { refreshVerdict, SessionService, userAgentHash } from './sessions.js';
import { opaqueToken, tokenHash } from './tokens.js';

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
    driver: null,
    ...overrides,
  };
}

interface Presented {
  readonly surface: 'staff' | 'platform' | 'driver';
  readonly userAgentHash: Buffer | null;
  readonly deviceId?: string;
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

  it('still says account_suspended for a family the suspension revoked (PLAT-13 plan 2.7)', () => {
    const membership = row().membership!;
    const suspended = { ...membership, accountStatus: 'suspended' as const };
    const refused = { kind: 'refuse', code: 'account_suspended' };
    expect(verdict(row({ revoked: true, membership: suspended }))).toEqual(refused);
    expect(verdict(row({ revoked: true, usedAt: seconds(-100), membership: suspended }))).toEqual(
      refused,
    );
    // Only for the member's own live membership, and never across surfaces.
    const invalid = { kind: 'refuse', code: 'token_invalid' };
    expect(
      verdict(row({ revoked: true, membership: { ...suspended, status: 'revoked' } })),
    ).toEqual(invalid);
    expect(
      verdict(row({ revoked: true, membership: suspended }), {
        surface: 'platform',
        userAgentHash: agent,
      }),
    ).toEqual(invalid);
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

  describe('a driver row (DEL-4 plan 2.8)', () => {
    const device = { appDeviceId: 'app-device-1', revoked: false };
    const driverRow = (overrides: Partial<RefreshState> = {}) =>
      row({
        surface: 'driver',
        deviceId: '019a0000-0000-7000-8000-000000000006',
        amr: ['otp'],
        driver: { status: 'active', device },
        ...overrides,
      });
    const presented = {
      surface: 'driver' as const,
      userAgentHash: agent,
      deviceId: 'app-device-1',
    };

    it('rotates when the app names the row device, the device is live and the driver active', () => {
      expect(verdict(driverRow(), presented)).toEqual({ kind: 'rotate' });
    });

    it('refuses another device id, or none, as token_invalid', () => {
      expect(verdict(driverRow(), { ...presented, deviceId: 'app-device-2' })).toEqual({
        kind: 'refuse',
        code: 'token_invalid',
      });
      expect(verdict(driverRow(), { surface: 'driver', userAgentHash: agent })).toEqual({
        kind: 'refuse',
        code: 'token_invalid',
      });
    });

    it('answers device_revoked for a revoked or vanished device, after the row revocation and reuse (adversary L-2)', () => {
      const revoked = { status: 'active' as const, device: { ...device, revoked: true } };
      expect(verdict(driverRow({ driver: revoked }), presented)).toEqual({
        kind: 'device_revoked',
      });
      expect(verdict(driverRow({ driver: revoked, revoked: true }), presented)).toEqual({
        kind: 'refuse',
        code: 'token_invalid',
      });
      const used = driverRow({ driver: revoked });
      expect(
        verdict({ ...used, usedAt: new Date(used.now.getTime() - 3_600_000) }, presented),
      ).toEqual({ kind: 'reuse' });
      expect(verdict(driverRow({ driver: { status: null, device: null } }), presented)).toEqual({
        kind: 'device_revoked',
      });
    });

    it('refuses a suspended or archived driver as token_invalid, a suspended account as 403', () => {
      for (const status of ['suspended', 'archived'] as const) {
        expect(verdict(driverRow({ driver: { status, device } }), presented)).toEqual({
          kind: 'refuse',
          code: 'token_invalid',
        });
      }
      const suspended = driverRow();
      expect(
        verdict(
          {
            ...suspended,
            membership: suspended.membership && {
              ...suspended.membership,
              accountStatus: 'suspended',
            },
          },
          presented,
        ),
      ).toEqual({ kind: 'refuse', code: 'account_suspended' });
    });

    it('keeps the reuse rule: a used row outside the grace is a reuse', () => {
      expect(verdict(driverRow({ usedAt: seconds(-120) }), presented)).toEqual({ kind: 'reuse' });
    });
  });
});

describe('SessionService.refresh inside the grace (adversary L-1)', () => {
  // The presented row was used 1 s ago (inside the grace, same agent); its kept successor is
  // answered again only while that successor is itself unused.
  const presented = opaqueToken();
  const successor = opaqueToken();
  const quiet = { log: () => undefined, warn: () => undefined };

  function service(successorRow: RefreshState) {
    const rows = new Map<string, RefreshState>([
      [tokenHash(presented).toString('hex'), row({ usedAt: seconds(-1) })],
      [tokenHash(successor).toString('hex'), successorRow],
    ]);
    const revokeFamily = vi.fn(() => Promise.resolve());
    const tx = {
      refreshTokens: {
        lockByHash: (hash: Buffer) => Promise.resolve(rows.get(hash.toString('hex'))),
        revokeFamily,
      },
    } as unknown as IdentityTransaction;
    const store: IdentityStore = { run: (fn) => fn(tx) };
    const cipher = { decrypt: () => successor } as unknown as CredentialsCipher;
    const sessions = new SessionService({
      issuer: { sign: () => Promise.resolve('access'), ttlSeconds: 900 },
      cipher,
      store,
      audit: { record: () => Promise.resolve() },
      settings: {
        staffRefreshTtlSeconds: 2_592_000,
        platformIdleTtlSeconds: 43_200,
        refreshReuseGraceSeconds: 30,
      },
      logger: quiet,
    });
    return { sessions, revokeFamily };
  }

  const facts: RequestFacts = {
    ip: null,
    userAgent: 'Mozilla/5.0 test',
    cookieHeader: `el_staff_rt=${presented}`,
    requestId: 'req',
    clientRequestId: null,
    principal: undefined,
  };

  it('answers the unused successor again', async () => {
    const { sessions } = service(row({ id: '019a0000-0000-7000-8000-000000000009' }));
    const outcome = await sessions.refresh('staff', facts);
    expect(outcome).toMatchObject({ ok: true, session: { refreshToken: successor } });
  });

  it('refuses a successor that has rotated already, without revoking the family', async () => {
    const used = row({ id: '019a0000-0000-7000-8000-000000000009', usedAt: seconds(-0.5) });
    const { sessions, revokeFamily } = service(used);
    expect(await sessions.refresh('staff', facts)).toEqual({ ok: false, code: 'token_invalid' });
    expect(revokeFamily).not.toHaveBeenCalled();
  });
});
