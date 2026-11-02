// Pure session helpers both web applications use (web §3.2, §3.4; WEB-2 plan 2.2, 2.7): the access
// cookie's expiry decoded without verification (the API verifies; the proxy only decides whether to
// refresh before the page asks), and the `next` parameter reduced to a same-origin relative path.
// No dependency: the proxy loads this on every request.

/** Seconds before expiry at which the proxy refreshes rather than send a token about to lapse. */
export const refreshMarginSeconds = 60;

function decodeBase64Url(segment: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return undefined;
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

/**
 * The `exp` claim (Unix seconds) of a compact JWT, or undefined when the value is not one. The
 * signature is not checked: a forged `exp` can only make the proxy refresh early or late, and the
 * API refuses a bad token either way.
 */
export function accessTokenExpiry(token: string | undefined): number | undefined {
  if (token === undefined || token.length > 4096) return undefined;
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  const json = decodeBase64Url(parts[1] ?? '');
  if (json === undefined) return undefined;
  try {
    const payload = JSON.parse(json) as unknown;
    if (typeof payload !== 'object' || payload === null) return undefined;
    const exp = (payload as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the access token is missing, unreadable or expires within the margin. */
export function accessTokenStale(
  token: string | undefined,
  nowSeconds: number,
  marginSeconds: number = refreshMarginSeconds,
): boolean {
  const exp = accessTokenExpiry(token);
  return exp === undefined || exp - nowSeconds <= marginSeconds;
}

const base = 'http://next.invalid';

/**
 * `value` as a same-origin relative path (path, query and fragment), or undefined. Only a value
 * that starts with one `/` and stays on the origin when resolved passes: `//host`, `/\host`,
 * schemes, control characters and backslashes are refused (open redirect, web §3.4). Paths of the
 * sign-in pages themselves are refused too, so a `next` never loops back to sign-in.
 */
export function safeNextPath(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    return undefined;
  }
  if (url.origin !== base) return undefined;
  if (url.pathname === '/sign-in' || url.pathname.startsWith('/sign-in/')) return undefined;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** `/sign-in?next=<path>[&reason=…]` for a page the user wanted. */
export function signInPath(next: string | undefined, reason?: 'ended'): string {
  const params = new URLSearchParams();
  const safe = safeNextPath(next);
  if (safe !== undefined && safe !== '/') params.set('next', safe);
  if (reason !== undefined) params.set('reason', reason);
  const query = params.toString();
  return query === '' ? '/sign-in' : `/sign-in?${query}`;
}
