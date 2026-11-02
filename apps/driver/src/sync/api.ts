import { createFetcher, type Fetcher, type Locale } from '@eeasy-logistics/contracts/http';
import type { Session } from './session';

// The driver app's transport (DRV-1 plan 2.4, 2.9) on `createFetcher` of packages/contracts: every
// request carries `X-App-Version`, `X-App-Platform` (the API's guard refuses a driver call without
// them, DEL-4 plan 8.2 #32), `Accept-Language` from the app language and an `X-Request-Id`; a
// call outside the anonymous auth doors carries the bearer access token. The answers that change the
// session are read here, once for every screen: `426` asks for an update, `401 token_expired`
// refreshes and retries once with the same headers (so a write keeps its `Idempotency-Key`),
// `401 device_revoked` and `401 token_invalid` end the session, `403 account_suspended` turns it
// read-only.

export interface DriverFetcherOptions {
  readonly baseUrl: string;
  readonly session: Session;
  readonly locale: () => Locale;
  readonly appVersion: string;
  readonly platform: 'ios' | 'android';
  readonly requestId: () => string;
  readonly fetch?: typeof globalThis.fetch;
}

/** The doors that take no bearer token (`security: []` in driver.yaml). */
const anonymousPaths = new Set([
  '/v1/driver/auth/otp/request',
  '/v1/driver/auth/otp/verify',
  '/v1/driver/auth/refresh',
]);

async function errorCode(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.clone().json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

export function createDriverFetcher(options: DriverFetcherOptions): Fetcher {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const { session } = options;

  const send = async (url: string, init: RequestInit, retried: boolean): Promise<Response> => {
    const path = url.startsWith(baseUrl) ? url.slice(baseUrl.length).split('?')[0]! : url;
    const authenticated = !anonymousPaths.has(path);
    const headers = new Headers(init.headers);
    if (authenticated) {
      const token = await session.getAccessToken();
      if (token !== undefined) headers.set('Authorization', `Bearer ${token}`);
    }
    const doFetch = options.fetch ?? globalThis.fetch;
    const response = await doFetch(url, { ...init, headers });
    if (response.ok) return response;

    const code = await errorCode(response);
    if (response.status === 426 || code === 'app_update_required') {
      session.markUpdateRequired();
    } else if (authenticated && response.status === 401) {
      if (code === 'token_expired' && !retried) {
        await session.refresh();
        return send(url, init, true);
      }
      if (code === 'device_revoked' || code === 'token_invalid') await session.end(code);
    } else if (code === 'account_suspended') {
      session.markSuspended();
    }
    return response;
  };

  return createFetcher({
    baseUrl,
    webClient: false,
    locale: options.locale,
    requestId: options.requestId,
    headers: () => ({
      'X-App-Version': options.appVersion,
      'X-App-Platform': options.platform,
    }),
    fetch: (input, init) =>
      send(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        init ?? {},
        false,
      ),
  });
}
