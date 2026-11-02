import type { Secret } from '@eeasy-logistics/config';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { withPortSpan } from '../telemetry/port-span.js';
import type {
  PushCallContext,
  PushMessage,
  PushReceipt,
  PushSender,
  PushTicket,
} from './push-sender.js';
import { maxPushBatch, maxReceiptIds, providerErrorName } from './push-sender.js';

// The Expo push service adapter (INT-4 plan 2.2; integrations §2.5). Three JSON calls, no SDK
// (Expo Push HTTP API, read 2026-11-02): `POST /--/api/v2/push/send` with up to 100 messages,
// `POST /--/api/v2/push/getReceipts` with up to 1,000 ids, both with the access token as a bearer
// token when enhanced push security is on. 429 is `rate_limited` at `Retry-After`; 5xx, a network
// error or the 5 s timeout `transient`; 401 and 403 `unauthorised`; any other 4xx (a malformed
// body, `PUSH_TOO_MANY_*`) `permanent`, which Expo says never succeeds on a retry. Neither the
// tokens nor the texts reach a span, a log or an error message.

export const sendPath = '/--/api/v2/push/send';
export const receiptsPath = '/--/api/v2/push/getReceipts';
/** Integrations §2.5: 5 s per batch. */
export const pushTimeoutMs = 5_000;
/** A 429 without a usable `Retry-After` waits this long (plan 2.2). */
export const defaultRetryAfterS = 10;
/** Answers longer than this are not read: 100 tickets or 1,000 receipts fit many times over. */
const maxAnswerBytes = 1024 * 1024;

export interface ExpoPushSenderOptions {
  /** `EXPO_PUSH_URL`: `https://exp.host`, or a local server in tests. */
  readonly baseUrl: string;
  /** `EXPO_ACCESS_TOKEN`; without it no `authorization` header is sent. */
  readonly accessToken?: Secret | undefined;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
  /** For an HTTP-date `Retry-After`. */
  readonly now?: () => Date;
}

/** The request body of one message (the Expo message format). */
function wireMessage(message: PushMessage): Record<string, unknown> {
  return {
    to: message.to,
    title: message.title,
    body: message.body,
    data: message.data,
    ttl: message.ttlSeconds,
    ...(message.collapseId === undefined ? {} : { collapseId: message.collapseId }),
    channelId: message.channelId,
    priority: message.priority,
    sound: message.sound ? 'default' : null,
  };
}

/** Seconds from a `Retry-After` header (delta seconds or an HTTP date), else the default. */
export function retryAfterSeconds(header: string | null, now: Date): number {
  if (header === null) return defaultRetryAfterS;
  const value = header.trim();
  if (/^\d{1,9}$/.test(value)) return Math.max(1, Number(value));
  const at = Date.parse(value);
  if (Number.isNaN(at)) return defaultRetryAfterS;
  return Math.max(1, Math.ceil((at - now.getTime()) / 1000));
}

/** The request-level error code of a failed call (`errors[0].code`), when it is a plain code. */
function errorCodeOf(answer: unknown): string | undefined {
  const errors = (answer as { errors?: unknown } | null)?.errors;
  const code = Array.isArray(errors) ? (errors[0] as { code?: unknown } | null)?.code : undefined;
  return typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : undefined;
}

/** The failure of a non-2xx answer (integrations §4.2; Expo: never retry a 400). */
export function expoFailure(status: number, answer: unknown, retryAfter: number): ProviderFailure {
  const code = errorCodeOf(answer) ?? status;
  if (status === 429) {
    return new ProviderFailure('rate_limited', 'the push service is rate limiting', {
      status: code,
      retryAfterS: retryAfter,
    });
  }
  if (status >= 500) {
    return new ProviderFailure('transient', 'the push service failed', { status: code });
  }
  if (status === 401 || status === 403) {
    return new ProviderFailure('unauthorised', 'the push service refused our access token', {
      status: code,
    });
  }
  return new ProviderFailure('permanent', 'the push service refused the request', {
    status: code,
  });
}

export class ExpoPushSender implements PushSender {
  readonly provider = 'expo' as const;
  readonly #base: string;
  readonly #token: Secret | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(options: ExpoPushSenderOptions) {
    this.#base = options.baseUrl.replace(/\/+$/, '');
    this.#token = options.accessToken;
    this.#timeoutMs = options.timeoutMs ?? pushTimeoutMs;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async send(messages: readonly PushMessage[], call: PushCallContext = {}): Promise<PushTicket[]> {
    if (messages.length === 0) return [];
    if (messages.length > maxPushBatch) {
      throw new ProviderFailure('permanent', `at most ${maxPushBatch} messages per request`, {
        status: 'PUSH_TOO_MANY_NOTIFICATIONS',
      });
    }
    const answer = await this.#post('send', sendPath, messages.map(wireMessage), call);
    const data = (answer as { data?: unknown } | null)?.data;
    if (!Array.isArray(data) || data.length !== messages.length) {
      throw new ProviderFailure('transient', 'the push service answered without one ticket each', {
        status: 'BAD_RESPONSE',
      });
    }
    return data.map((entry: unknown, index): PushTicket => {
      const ticket = entry as { status?: unknown; id?: unknown; details?: { error?: unknown } };
      if (ticket?.status === 'ok' && typeof ticket.id === 'string' && ticket.id !== '') {
        return { index, status: 'ok', id: ticket.id.slice(0, 128) };
      }
      return { index, status: 'error', error: providerErrorName(ticket?.details?.error) };
    });
  }

  async receipts(ids: readonly string[]): Promise<PushReceipt[]> {
    if (ids.length === 0) return [];
    if (ids.length > maxReceiptIds) {
      throw new ProviderFailure('permanent', `at most ${maxReceiptIds} ids per request`, {
        status: 'PUSH_TOO_MANY_RECEIPTS',
      });
    }
    const answer = await this.#post('receipts', receiptsPath, { ids }, {});
    const data = (answer as { data?: unknown } | null)?.data;
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new ProviderFailure('transient', 'the push service answered without receipts', {
        status: 'BAD_RESPONSE',
      });
    }
    const receipts: PushReceipt[] = [];
    for (const id of new Set(ids)) {
      if (!Object.hasOwn(data, id)) continue;
      const receipt = (data as Record<string, unknown>)[id] as {
        status?: unknown;
        details?: { error?: unknown };
      } | null;
      if (receipt?.status === 'ok') receipts.push({ id, status: 'ok' });
      else if (receipt?.status === 'error') {
        receipts.push({ id, status: 'error', error: providerErrorName(receipt.details?.error) });
      }
    }
    return receipts;
  }

  /** One POST under its port span; the parsed answer of a 2xx, else the mapped failure. */
  #post(
    method: 'send' | 'receipts',
    path: string,
    body: unknown,
    call: PushCallContext,
  ): Promise<unknown> {
    return withPortSpan(
      {
        port: 'push_sender',
        method,
        provider: this.provider,
        ...(call.accountId === undefined ? {} : { accountId: call.accountId }),
        ...(call.outboxRowId === undefined ? {} : { outboxRowId: call.outboxRowId }),
        ...(call.attempt === undefined ? {} : { attempt: call.attempt }),
      },
      async (span) => {
        let response: Response;
        let text: string;
        try {
          response = await this.#fetch(`${this.#base}${path}`, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'accept-encoding': 'gzip, deflate',
              'content-type': 'application/json',
              ...(this.#token === undefined
                ? {}
                : { authorization: `Bearer ${this.#token.reveal()}` }),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.#timeoutMs),
          });
          text = await response.text();
        } catch (error) {
          const timedOut = error instanceof Error && error.name === 'TimeoutError';
          throw new ProviderFailure(
            'transient',
            timedOut ? 'the push service timed out' : 'the push service is unreachable',
            { status: timedOut ? 'TIMEOUT' : 'NETWORK' },
          );
        }
        span.setHttpStatus(response.status);
        let answer: unknown = null;
        if (text.length <= maxAnswerBytes) {
          try {
            answer = JSON.parse(text);
          } catch {
            answer = null;
          }
        }
        if (!response.ok) {
          const retryAfter = retryAfterSeconds(response.headers.get('retry-after'), this.#now());
          throw expoFailure(response.status, answer, retryAfter);
        }
        return answer;
      },
    );
  }
}
