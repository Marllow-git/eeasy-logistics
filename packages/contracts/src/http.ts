// The fetcher every generated client calls (PLAT-15 plan 2.4, document 3 §3 and §4).
//
// Orval imports `apiFetch` as its mutator. The base URL and the fetch implementation are not module
// state: the caller builds a `Fetcher` with `createFetcher` (the browser with a same-origin base
// URL, a server component with `API_INTERNAL_URL` from packages/config and the forwarded cookie, the
// driver app with its API host) and passes it on each call as `{ fetcher }`, so concurrent server
// requests never share headers. Nothing here reads the environment, retries or refreshes; the
// single-flight refresh of web §3.2 wraps this fetcher (WEB-1).
/** Codes the server can send (`errors.md`), plus the client's own for a body that is not an `Error`. */
export type ApiErrorCode = string;

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
  /** Generates the per-call `X-Request-Id`; `crypto.randomUUID` by default (React Native passes its own). */
  requestId?: () => string;
}

/** A configured transport. Pass it to a generated call as `{ fetcher }`. */
export type Fetcher = (path: string, init: RequestInit) => Promise<Response>;

const readMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Builds the transport the generated clients call through `apiFetch`. */
export function createFetcher(options: FetcherOptions): Fetcher {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const webClient = options.webClient ?? true;
  const newRequestId = options.requestId ?? (() => globalThis.crypto.randomUUID());

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
    if (webClient && !readMethods.has(method)) headers.set('X-EL-Client', 'web');

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
      code: body.code,
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

/** Error type of the generated TanStack Query hooks; Orval passes the error body type, unused here. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type ErrorType<_Body> = ApiError;
/** Request body type of the generated clients, unchanged. */
export type BodyType<Body> = Body;
