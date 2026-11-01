import { Secret } from '@eeasy-logistics/config';
import { describe, expect, it } from 'vitest';
import { AccessTokenVerifier } from '../src/modules/kernel/auth/access-token.js';
import {
  PrincipalResolver,
  bearerToken,
  cookieValue,
  platformCookie,
  staffCookie,
} from '../src/modules/kernel/auth/principal.js';
import type { TokenSurface } from '../src/modules/kernel/auth/surfaces.js';
import { surfaceOf } from '../src/modules/kernel/auth/surfaces.js';
import { ApiException } from '../src/modules/kernel/errors/api-exception.js';
import { signAccessToken, testSigningKey } from './support/access-tokens.js';

// PLAT-6 item B: access-token verification (plan 2.3) and the per-surface principal resolver
// (plan 2.4), without HTTP. Tokens come from the test-only signer with a random key per run.

const signing = testSigningKey();
const verifier = new AccessTokenVerifier({
  signingKeyId: signing.keyId,
  signingKey: new Secret(signing.key),
});
const resolver = new PrincipalResolver(verifier);

/** The error code a promise rejects with, or `resolved`. */
async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof ApiException ? error.code : `unexpected ${String(error)}`;
  }
}

describe('AccessTokenVerifier', () => {
  it.each(['staff', 'platform', 'driver'] as const)('accepts a valid %s token', async (surface) => {
    const claims = await verifier.verify(await signAccessToken(signing, surface), surface);
    expect(claims.aud).toBe(surface);
  });

  it('refuses a forged signature', async () => {
    const forged = await signAccessToken(testSigningKey(signing.keyId), 'staff');
    expect(await codeOf(verifier.verify(forged, 'staff'))).toBe('unauthenticated');
  });

  it('refuses a token whose payload was edited after signing', async () => {
    const [header, , signature] = (await signAccessToken(signing, 'staff')).split('.');
    const payload = Buffer.from(JSON.stringify({ acc: 'another' })).toString('base64url');
    expect(await codeOf(verifier.verify(`${header}.${payload}.${signature}`, 'staff'))).toBe(
      'unauthenticated',
    );
  });

  it('requires typ at+jwt in the header (adversary L-1)', async () => {
    const without = await signAccessToken(signing, 'staff', { typ: null });
    const other = await signAccessToken(signing, 'staff', { typ: 'JWT' });
    expect(await codeOf(verifier.verify(without, 'staff'))).toBe('unauthenticated');
    expect(await codeOf(verifier.verify(other, 'staff'))).toBe('unauthenticated');
  });

  it('bounds iat (adversary L-1): future beyond 60 s refused, older than the lifetime expired', async () => {
    const now = Math.floor(Date.now() / 1000);
    const future = await signAccessToken(signing, 'staff', { claims: { iat: now + 120 } });
    const skewed = await signAccessToken(signing, 'staff', { claims: { iat: now + 30 } });
    const ancient = await signAccessToken(signing, 'staff', {
      claims: { iat: now - 900 - 61 },
      expiresIn: 3600,
    });
    expect(await codeOf(verifier.verify(future, 'staff'))).toBe('unauthenticated');
    expect(await codeOf(verifier.verify(skewed, 'staff'))).toBe('resolved');
    expect(await codeOf(verifier.verify(ancient, 'staff'))).toBe('token_expired');
    const short = new AccessTokenVerifier({
      signingKeyId: signing.keyId,
      signingKey: new Secret(signing.key),
      accessTokenTtlSeconds: 60,
    });
    const minutes = await signAccessToken(signing, 'staff', { claims: { iat: now - 200 } });
    expect(await codeOf(short.verify(minutes, 'staff'))).toBe('token_expired');
  });

  it('answers token_expired for a genuine expired token of the surface', async () => {
    const expired = await signAccessToken(signing, 'staff', { expiresIn: -5 });
    expect(await codeOf(verifier.verify(expired, 'staff'))).toBe('token_expired');
  });

  it('answers unauthenticated for an expired token of another surface', async () => {
    const expired = await signAccessToken(signing, 'driver', { expiresIn: -5 });
    expect(await codeOf(verifier.verify(expired, 'staff'))).toBe('unauthenticated');
  });

  it.each([
    ['driver', 'staff'],
    ['staff', 'platform'],
    ['platform', 'staff'],
    ['staff', 'driver'],
  ] as const)('refuses a %s token on the %s surface', async (issued, used) => {
    const token = await signAccessToken(signing, issued);
    expect(await codeOf(verifier.verify(token, used))).toBe('unauthenticated');
  });

  it('refuses another key id, another algorithm and another issuer', async () => {
    const otherKid = await signAccessToken(signing, 'staff', { keyId: 'old-key' });
    const otherAlg = await signAccessToken(signing, 'staff', { algorithm: 'HS512' });
    const otherIss = await signAccessToken(signing, 'staff', { claims: { iss: 'someone-else' } });
    for (const token of [otherKid, otherAlg, otherIss]) {
      expect(await codeOf(verifier.verify(token, 'staff'))).toBe('unauthenticated');
    }
  });

  it('refuses an unsigned token (alg none)', async () => {
    const [, payload] = (await signAccessToken(signing, 'staff')).split('.');
    const header = Buffer.from('{"alg":"none","kid":"test-key-1"}').toString('base64url');
    expect(await codeOf(verifier.verify(`${header}.${payload}.`, 'staff'))).toBe('unauthenticated');
  });

  it.each(['sub', 'acc', 'mem', 'roles', 'scopes', 'sites', 'ver', 'exp', 'iat'])(
    'refuses a staff token without %s',
    async (claim) => {
      const token = await signAccessToken(signing, 'staff', { omit: [claim] });
      expect(await codeOf(verifier.verify(token, 'staff'))).toBe('unauthenticated');
    },
  );

  it.each<[TokenSurface, Record<string, unknown>]>([
    ['staff', { acc: 'not-a-uuid' }],
    ['staff', { acc: null }],
    ['driver', { dev: null }],
    ['platform', { acc: '0192f1a4-0000-7000-8000-000000000001' }],
    ['staff', { ver: -1 }],
    ['staff', { sites: ['nope'] }],
  ])('refuses a %s token with malformed claims %o', async (surface, claims) => {
    const token = await signAccessToken(signing, surface, { claims });
    expect(await codeOf(verifier.verify(token, surface))).toBe('unauthenticated');
  });

  it('refuses everything when no key is configured', async () => {
    const unconfigured = new AccessTokenVerifier({
      signingKeyId: undefined,
      signingKey: undefined,
    });
    expect(unconfigured.configured).toBe(false);
    const token = await signAccessToken(signing, 'staff');
    expect(await codeOf(unconfigured.verify(token, 'staff'))).toBe('unauthenticated');
  });
});

describe('PrincipalResolver (credential per surface)', () => {
  it('reads the staff token from the el_staff_at cookie only', async () => {
    const token = await signAccessToken(signing, 'staff');
    const principal = await resolver.resolve('staff', {
      cookie: `theme=dark; ${staffCookie}=${token}; other=1`,
    });
    expect(principal.kind).toBe('staff');
    expect(await codeOf(resolver.resolve('staff', { authorization: `Bearer ${token}` }))).toBe(
      'unauthenticated',
    );
    expect(await codeOf(resolver.resolve('staff', { cookie: `${platformCookie}=${token}` }))).toBe(
      'unauthenticated',
    );
  });

  it('reads the platform token from the el_platform_at cookie only', async () => {
    const token = await signAccessToken(signing, 'platform');
    const principal = await resolver.resolve('platform', { cookie: `${platformCookie}=${token}` });
    expect(principal).toMatchObject({ kind: 'platform' });
    expect(principal).not.toHaveProperty('accountId');
    expect(await codeOf(resolver.resolve('platform', { authorization: `Bearer ${token}` }))).toBe(
      'unauthenticated',
    );
  });

  it('reads the driver token from the bearer header only', async () => {
    const token = await signAccessToken(signing, 'driver');
    const principal = await resolver.resolve('driver', { authorization: `Bearer ${token}` });
    expect(principal.kind).toBe('driver');
    expect(principal.kind === 'driver' && principal.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await codeOf(resolver.resolve('driver', { cookie: `${staffCookie}=${token}` }))).toBe(
      'unauthenticated',
    );
  });

  it('takes the account, membership and user from the token claims', async () => {
    const token = await signAccessToken(signing, 'staff');
    const [, payload = ''] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<
      string,
      string
    >;
    const principal = await resolver.resolve('staff', { cookie: `${staffCookie}=${token}` });
    expect(principal).toMatchObject({
      accountId: claims.acc,
      membershipId: claims.mem,
      userId: claims.sub,
    });
  });

  it.each(['recipient', 'public'] as const)('answers 401 on the %s surface', async (surface) => {
    const token = await signAccessToken(signing, 'staff');
    const headers = {
      cookie: `${staffCookie}=${token}`,
      authorization: `Bearer ${token}`,
      'x-recipient-token': token,
      'x-api-key': token,
    };
    expect(await codeOf(resolver.resolve(surface, headers))).toBe('unauthenticated');
  });

  it('answers 401 without any credential', async () => {
    for (const surface of ['staff', 'platform', 'driver'] as const) {
      expect(await codeOf(resolver.resolve(surface, {}))).toBe('unauthenticated');
    }
  });
});

describe('duplicated credential cookies (adversary L-2)', () => {
  it.each(['staff', 'platform'] as const)(
    'answers 401 on %s with the cookie twice',
    async (surface) => {
      const token = await signAccessToken(signing, surface);
      const name = surface === 'staff' ? staffCookie : platformCookie;
      const header = `${name}=${token}; other=1; ${name}=${token}`;
      expect(await codeOf(resolver.resolve(surface, { cookie: header }))).toBe('unauthenticated');
      expect(await codeOf(resolver.resolve(surface, { cookie: `${name}=${token}` }))).toBe(
        'resolved',
      );
    },
  );
});

describe('credential parsing', () => {
  it('parses cookies and bearer headers strictly', () => {
    expect(cookieValue('a=1; el_staff_at=x.y.z', 'el_staff_at')).toBe('x.y.z');
    expect(cookieValue('xel_staff_at=x.y.z', 'el_staff_at')).toBeUndefined();
    expect(cookieValue('el_staff_at=', 'el_staff_at')).toBeUndefined();
    // Adversary L-2: a duplicated credential cookie is no credential, whichever comes first.
    expect(cookieValue('el_staff_at=a.b.c; el_staff_at=x.y.z', 'el_staff_at')).toBeUndefined();
    expect(
      cookieValue('el_platform_at=a; x=1; el_platform_at=a', 'el_platform_at'),
    ).toBeUndefined();
    expect(bearerToken('Bearer a.b.c')).toBe('a.b.c');
    expect(bearerToken('bearer a.b.c')).toBeUndefined();
    expect(bearerToken('Bearer a.b c')).toBeUndefined();
  });

  it.each([
    ['/v1/staff/orders', 'staff'],
    ['/v1/platform', 'platform'],
    ['/v1/driver/runs/1', 'driver'],
    ['/v1/recipient/x', 'recipient'],
    ['/v1/public/orders', 'public'],
    ['/v1/staffing', undefined],
    ['/health', undefined],
    ['/v2/staff/orders', undefined],
  ])('surfaceOf(%s) is %s', (path, surface) => {
    expect(surfaceOf(path)).toBe(surface);
  });
});
