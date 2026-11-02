import { platformCookie, staffCookie } from './principal.js';

// Session cookies (PLAT-11 plan 2.5; ADR-0032, ADR-0038; research note §4.5, §5): one access and
// one refresh cookie per surface, all `HttpOnly; Secure; SameSite=Lax; Path=/`, host-only (no
// `Domain`). The access names are the contracts' security schemes; the refresh cookie keeps
// `Path=/` because the web middleware refreshes on a navigation to any path (ADR-0032). `Secure` is
// always set: browsers accept it on `http://localhost`.

export type CookieSurface = 'staff' | 'platform';

export const sessionCookieNames: Readonly<
  Record<CookieSurface, { readonly access: string; readonly refresh: string }>
> = Object.freeze({
  staff: Object.freeze({ access: staffCookie, refresh: 'el_staff_rt' }),
  platform: Object.freeze({ access: platformCookie, refresh: 'el_platform_rt' }),
});

/** Cookie values this API writes: base64url tokens and JWTs, nothing that needs quoting. */
const valuePattern = /^[A-Za-z0-9._-]*$/;

/** One `Set-Cookie` value with the session attributes. */
export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  if (!valuePattern.test(value)) throw new Error(`Refusing to write cookie ${name}: bad value`);
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds));
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export interface IssuedSession {
  readonly accessToken: string;
  readonly accessTtlSeconds: number;
  readonly refreshToken: string;
  /** Seconds until the refresh row expires (its `expires_at`). */
  readonly refreshTtlSeconds: number;
}

/** The two cookies of a started or rotated session. */
export function sessionCookies(surface: CookieSurface, session: IssuedSession): string[] {
  const names = sessionCookieNames[surface];
  return [
    serializeCookie(names.access, session.accessToken, session.accessTtlSeconds),
    serializeCookie(names.refresh, session.refreshToken, session.refreshTtlSeconds),
  ];
}

/** Both cookies cleared (`Max-Age=0`): logout and every refused refresh. */
export function clearedSessionCookies(surface: CookieSurface): string[] {
  const names = sessionCookieNames[surface];
  return [serializeCookie(names.access, '', 0), serializeCookie(names.refresh, '', 0)];
}
