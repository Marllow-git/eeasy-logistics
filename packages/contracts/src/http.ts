// The fetcher every generated client calls (PLAT-15 plan 2.4, document 3 §3 and §4).
//
// Orval imports `apiFetch` as its mutator. The base URL and the fetch implementation are not module
// state: the caller builds a `Fetcher` with `createFetcher` (the browser with a same-origin base
// URL, a server component with `API_INTERNAL_URL` from packages/config and the forwarded cookie, the
// driver app with its API host) and passes it on each call as `{ fetcher }`, so concurrent server
// requests never share headers. Nothing here reads the environment, retries or refreshes; the
// single-flight refresh of web §3.2 wraps this fetcher (WEB-1).
import type { ErrorCode } from '../generated/unions.ts';

/** Codes the server can send (`errors.md`), plus the client's own for a body that is not an `Error`. */
export type ApiErrorCode = ErrorCode | 'unexpected_response';

/** A non-2xx answer, parsed from the `Error` body (document 3 §4). Branch on `code`, never `message`. */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | undefined;
  /** `request_id` from the body, else the response's `X-Request-Id` header. */
  readonly requestId: string | undefined;
  readonly headers: Headers;

  constructor(init: {
    status: number;
    code: ApiErrorCode;
    message: string;
    details?: Record<string, unknown> | undefined;
    requestId?: string | undefined;
    headers: Headers;
  }) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.headers = init.headers;
  }
}

export type Locale = 'ar' | 'en';

export interface FetcherOptions {
  /** API origin plus nothing else (`https://app.example.sa`, or `''` for same-origin in the browser). */
  baseUrl: string;
  /** The fetch to use; the platform's by default. Tests and server code pass their own. */
  fetch?: typeof globalThis.fetch;
  /** Sent as `Accept-Language` on every call; the server falls back to the account's locale. */
  locale?: Locale | (() => Locale | undefined);
  /** Extra headers on every call, such as the forwarded cookie of a server component. */
  headers?: HeadersInit | (() => HeadersInit);
  /**
   * `X-EL-Client: web` on every non-GET (README §1, ADR-0032). True by default; the driver app,
   * which is not a web client, passes false.
   */
  webClient?: boolean;
  /** Generates the per-call `X-Request-Id`; `defaultRequestId` (Web Crypto) by default. */
  requestId?: () => string;
}

/** A configured transport. Pass it to a generated call as `{ fetcher }`. */
export type Fetcher = (path: string, init: RequestInit) => Promise<Response>;

/**
 * A UUID v4 for `X-Request-Id`: `crypto.randomUUID` where it exists, else built from
 * `crypto.getRandomValues` (RFC 9562 §5.4). Throws when the platform has neither.
 */
export function defaultRequestId(): string {
  const crypto = globalThis.crypto as Partial<Crypto> | undefined;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new Error(
      'No crypto.randomUUID or crypto.getRandomValues here: pass the requestId option to createFetcher.',
    );
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Builds the transport the generated clients call through `apiFetch`. */
export function createFetcher(options: FetcherOptions): Fetcher {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const webClient = options.webClient ?? true;
  const newRequestId = options.requestId ?? defaultRequestId;

  return (path, init) => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const headers = new Headers(
      typeof options.headers === 'function' ? options.headers() : options.headers,
    );
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));

    const locale = typeof options.locale === 'function' ? options.locale() : options.locale;
    if (locale !== undefined && !headers.has('accept-language')) {
      headers.set('Accept-Language', locale);
    }
    if (!headers.has('x-request-id')) headers.set('X-Request-Id', newRequestId());
    const method = (init.method ?? 'GET').toUpperCase();
    if (webClient && method !== 'GET') headers.set('X-EL-Client', 'web');

    return doFetch(`${baseUrl}${path}`, { ...init, method, headers });
  };
}

/** Per-call options of every generated function: the request init plus the fetcher to use. */
export type RequestOptions = RequestInit & { fetcher?: Fetcher };

/** Shape the generated fetch client expects back (`includeHttpResponseReturnType`). */
interface HttpResponse {
  data: unknown;
  status: number;
  headers: Headers;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205 || response.status === 304) {
    return undefined;
  }
  const text = await response.text();
  if (text === '') return undefined;
  const type = response.headers.get('content-type') ?? '';
  if (/[/+]json\b/i.test(type)) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toApiError(response: Response, body: unknown): ApiError {
  const headerRequestId = response.headers.get('x-request-id') ?? undefined;
  if (isRecord(body) && typeof body.code === 'string' && typeof body.message === 'string') {
    return new ApiError({
      status: response.status,
      // The server's code is trusted to be in errors.md; the contract tests fail it otherwise.
      code: body.code as ErrorCode,
      message: body.message,
      details: isRecord(body.details) ? body.details : undefined,
      requestId: typeof body.request_id === 'string' ? body.request_id : headerRequestId,
      headers: response.headers,
    });
  }
  return new ApiError({
    status: response.status,
    code: 'unexpected_response',
    message: `HTTP ${response.status} without an Error body`,
    requestId: headerRequestId,
    headers: response.headers,
  });
}

/**
 * Orval's mutator. Returns `{ data, status, headers }` for a 2xx and throws `ApiError` otherwise;
 * a network failure rejects with the platform's error unchanged.
 */
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { fetcher, ...init } = options;
  if (fetcher === undefined) {
    throw new TypeError(
      'Pass { fetcher: createFetcher(...) } to every generated call (packages/contracts README).',
    );
  }
  const response = await fetcher(path, init);
  const body = await readBody(response);
  if (!response.ok) throw toApiError(response, body);
  const result: HttpResponse = { data: body, status: response.status, headers: response.headers };
  return result as T;
}

// ---------------------------------------------------------------------------------------------
// The browser's session fetcher (web §3.2, §3.4; ADR-0032; WEB-2 plan 2.4, 2.8).

/** The two browser session surfaces, each on its own web application (ADR-0038). */
export type SessionSurface = 'staff' | 'platform';

/** The session doors per surface, as the contracts spell them (`refreshSession`, `logout`, …). */
export const sessionPaths = {
  staff: {
    refresh: '/v1/staff/auth/refresh',
    logout: '/v1/staff/auth/logout',
    doors: '/v1/staff/auth/',
    authenticatedDoors: ['/v1/staff/auth/switch-account'],
  },
  platform: {
    refresh: '/v1/platform/auth/refresh',
    logout: '/v1/platform/auth/logout',
    doors: '/v1/platform/auth/',
    authenticatedDoors: [],
  },
} as const satisfies Record<
  SessionSurface,
  { refresh: string; logout: string; doors: string; authenticatedDoors: readonly string[] }
>;

/** The Web Locks name of the refresh per surface: one refresh per browser (web §3.2, §3.5). */
export const refreshLockNames = {
  staff: 'el-staff-refresh',
  platform: 'el-platform-refresh',
} as const satisfies Record<SessionSurface, string>;

/** Why the page's session ended (`onSessionEnded`). */
export type SessionEndReason = 'token_invalid' | 'refresh_refused' | 'account_suspended';

/** The part of the Web Locks API the fetcher uses (a test passes its own). */
export interface RefreshLocks {
  request<T>(
    name: string,
    options: { ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<T>,
  ): Promise<T>;
}

export interface SessionFetcherOptions extends Omit<FetcherOptions, 'webClient' | 'baseUrl'> {
  surface: SessionSurface;
  /** Same-origin by default (`''`): the API is on the page's origin (ADR-0032). */
  baseUrl?: string;
  /** `el-staff-refresh` or `el-platform-refresh` by default. */
  lockName?: string;
  /**
   * The session ended: a refused refresh, a token the API no longer accepts, a suspended account.
   * Resolve `true` once the user signed in again (the re-sign-in dialog), and the failed request is
   * sent once more with its original `Idempotency-Key`; anything else returns the failure.
   */
  onSessionEnded?: (reason: SessionEndReason) => boolean | void | Promise<boolean | void>;
  /** `navigator.locks` by default; without it a module-level promise keeps one refresh per tab. */
  locks?: RefreshLocks | null;
  /** UUID v7 by default. */
  idempotencyKey?: () => string;
}

/** A UUID v7 (RFC 9562 §5.7) for `Idempotency-Key`: time-ordered, 74 random bits. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const time = BigInt(now);
  for (let index = 0; index < 6; index++) {
    bytes[index] = Number((time >> BigInt(8 * (5 - index))) & 0xffn);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The `code` of a 401 body, read from a clone so the caller still gets the response. */
async function unauthorizedCode(response: Response): Promise<string | undefined> {
  if (response.status !== 401) return undefined;
  const body = await readBody(response.clone()).catch(() => undefined);
  return isRecord(body) && typeof body.code === 'string' ? body.code : undefined;
}

/**
 * A 401 that means the page has no session any more: a token the API refuses (`token_invalid`), or
 * no credential at all (`unauthenticated`: the cookies were cleared by a refused refresh, maybe in
 * another tab).
 */
const sessionGone = (code: string | undefined) =>
  code === 'token_invalid' || code === 'unauthenticated';

type RefreshOutcome = 'refreshed' | 'refused' | 'suspended' | 'failed';

/** The in-flight refresh of this tab when Web Locks are missing (none we support; guarded). */
const tabRefresh = new Map<string, Promise<RefreshOutcome>>();

function defaultLocks(): RefreshLocks | null {
  const locks = (globalThis.navigator as { locks?: RefreshLocks } | undefined)?.locks;
  return locks !== undefined && typeof locks.request === 'function' ? locks : null;
}

/**
 * The fetcher of a browser page: `createFetcher` plus the session rules of web §3.2 to §3.4.
 * Every call is same-origin with the cookies (`credentials: 'same-origin'`); every non-GET carries
 * `X-EL-Client: web` and an `Idempotency-Key` (UUID v7, unless the caller set one) that a retry
 * keeps. A `401 token_expired` from an authenticated operation refreshes the session once per
 * browser through the Web Locks API (`lockName`): the lock holder calls the surface's refresh, and
 * a request that waited for the lock first retries itself (another tab may have refreshed), then
 * refreshes only if it still gets `token_expired`. The original request is retried once. A
 * `401 token_invalid` or `unauthenticated` (the cookies are gone) or a refused refresh calls
 * `onSessionEnded`, once per request; concurrent requests share the one dialog the app shows. The session doors themselves
 * (sign-in, refresh, …), whose 401 codes speak of their own tokens, never refresh.
 */
export function createSessionFetcher(options: SessionFetcherOptions): Fetcher {
  const paths = sessionPaths[options.surface];
  const baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
  const lockName = options.lockName ?? refreshLockNames[options.surface];
  const newKey = options.idempotencyKey ?? (() => uuidv7());
  // Cast: React Native's `fetch` has two overloads and `Parameters` takes the narrower one, so the
  // driver app's typecheck (which compiles this file) refuses the plain arrow (DRV-1 §8.1).
  const doFetch = ((...args: Parameters<typeof globalThis.fetch>) =>
    (options.fetch ?? globalThis.fetch)(...args)) as typeof globalThis.fetch;
  const base = createFetcher({ ...options, baseUrl, fetch: doFetch, webClient: true });
  const send: Fetcher = (path, init) => base(path, { ...init, credentials: 'same-origin' });

  async function refresh(): Promise<RefreshOutcome> {
    let response: Response;
    try {
      response = await send(paths.refresh, { method: 'POST' });
    } catch {
      return 'failed';
    }
    if (response.ok) return 'refreshed';
    if (response.status === 401) return 'refused';
    if (response.status === 403) {
      const body = await readBody(response).catch(() => undefined);
      if (isRecord(body) && body.code === 'account_suspended') return 'suspended';
    }
    return 'failed';
  }

  /** Runs `work` under the browser-wide lock; `waited` says whether another holder came first. */
  async function underLock<T>(work: (waited: boolean) => Promise<T>): Promise<T> {
    const locks = options.locks === undefined ? defaultLocks() : options.locks;
    if (locks === null) {
      const running = tabRefresh.get(lockName);
      if (running !== undefined) {
        await running.catch(() => undefined);
        return work(true);
      }
      let done!: (outcome: RefreshOutcome) => void;
      tabRefresh.set(lockName, new Promise<RefreshOutcome>((resolve) => (done = resolve)));
      try {
        return await work(false);
      } finally {
        tabRefresh.delete(lockName);
        done('refreshed');
      }
    }
    const immediate = await locks.request(lockName, { ifAvailable: true }, async (lock) =>
      lock === null ? undefined : { value: await work(false) },
    );
    if (immediate !== undefined) return immediate.value;
    return locks.request(lockName, {}, () => work(true));
  }

  async function ended(reason: SessionEndReason): Promise<boolean> {
    return (await options.onSessionEnded?.(reason)) === true;
  }

  return async (path, init) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    if (method !== 'GET' && method !== 'HEAD' && !headers.has('idempotency-key')) {
      headers.set('Idempotency-Key', newKey());
    }
    const request = { ...init, method, headers };
    const response = await send(path, request);
    const isDoor =
      path.startsWith(paths.doors) &&
      !(paths.authenticatedDoors as readonly string[]).some((door) => path.startsWith(door));
    if (response.status !== 401 || isDoor) return response;

    const code = await unauthorizedCode(response);
    if (sessionGone(code)) {
      return (await ended('token_invalid')) ? send(path, request) : response;
    }
    if (code !== 'token_expired') return response;

    const outcome = await underLock(async (waited): Promise<Response | RefreshOutcome> => {
      if (waited) {
        // Another holder may have refreshed: try once with the cookies the browser has now.
        const retried = await send(path, request);
        if ((await unauthorizedCode(retried)) !== 'token_expired') return retried;
      }
      return refresh();
    });
    if (outcome instanceof Response) {
      if (!sessionGone(await unauthorizedCode(outcome))) return outcome;
      return (await ended('token_invalid')) ? send(path, request) : outcome;
    }
    if (outcome === 'refreshed') return send(path, request);
    if (outcome === 'failed') return response;
    const resumed = await ended(outcome === 'suspended' ? 'account_suspended' : 'refresh_refused');
    return resumed ? send(path, request) : response;
  };
}

/** Error type of the generated TanStack Query hooks; Orval passes the error body type, unused here. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type ErrorType<_Body> = ApiError;
/** Request body type of the generated clients, unchanged. */
export type BodyType<Body> = Body;
