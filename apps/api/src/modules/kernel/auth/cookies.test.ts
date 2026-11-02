import { describe, expect, it } from 'vitest';
import {
  clearedSessionCookies,
  serializeCookie,
  sessionCookieNames,
  sessionCookies,
} from './cookies.js';

// PLAT-11 plan 2.5, 2.16: cookie names and serialisation.

describe('session cookies', () => {
  it('names the access cookies as the contracts do and the refresh cookies per surface', () => {
    expect(sessionCookieNames).toEqual({
      staff: { access: 'el_staff_at', refresh: 'el_staff_rt' },
      platform: { access: 'el_platform_at', refresh: 'el_platform_rt' },
    });
  });

  it('writes HttpOnly, Secure, SameSite=Lax, Path=/ and no Domain', () => {
    const cookie = serializeCookie('el_staff_at', 'a.b-c_d', 900);
    expect(cookie).toBe('el_staff_at=a.b-c_d; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax');
    expect(cookie).not.toMatch(/domain/i);
  });

  it('sets the access and refresh lifetimes as Max-Age', () => {
    expect(
      sessionCookies('platform', {
        accessToken: 'jwt',
        accessTtlSeconds: 900,
        refreshToken: 'opaque',
        refreshTtlSeconds: 43_200,
      }),
    ).toEqual([
      'el_platform_at=jwt; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax',
      'el_platform_rt=opaque; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax',
    ]);
  });

  it('clears both cookies with Max-Age=0', () => {
    expect(clearedSessionCookies('staff')).toEqual([
      'el_staff_at=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      'el_staff_rt=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    ]);
  });

  it('refuses a value that would need quoting or could add an attribute', () => {
    expect(() => serializeCookie('el_staff_at', 'a; Domain=evil.test', 900)).toThrow();
    expect(() => serializeCookie('el_staff_at', 'a\r\nSet-Cookie: x=1', 900)).toThrow();
  });
});
