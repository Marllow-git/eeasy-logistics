import type { AppEnv } from '@eeasy-logistics/config';
import { locales } from '@eeasy-logistics/i18n/templates';
import { ProviderFailure } from '../outbox/provider-failure.js';
import type {
  MessageSender,
  SendTemplateInput,
  SentMessage,
  TemplateStatus,
} from './message-sender.js';
import type { TemplateKey } from './templates.js';
import { messageTemplates, providerTemplateName, renderTemplate } from './templates.js';

// The WhatsApp stub adapter (PLAT-9 plan 2.1; integrations §2.4 "Stub", §9): sends to
// `tools/whatsapp-stub` over HTTP, which records every send so tests and the census can read the
// last code per phone (`GET /sent`). Local and ci only: it refuses to be built anywhere else, on
// top of the production refusal of `MESSAGING_PROVIDER=stub` (packages/config).

/** Integrations §2.4: every provider call times out after 5 s. */
export const providerTimeoutMs = 5_000;

export class StubRefused extends Error {
  constructor(appEnv: string) {
    super(`The WhatsApp stub is for local and ci only; ${appEnv} refuses it`);
    this.name = 'StubRefused';
  }
}

export interface StubSenderOptions {
  readonly appEnv: AppEnv;
  readonly url: string;
  readonly templateNamespace: string;
  readonly timeoutMs?: number;
  /** Extra request headers; tests pass the stub's `x-stub-fault` (integrations §9). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
}

/**
 * Maps a provider's HTTP answer to the outbox's failure kinds (ADR-0036): 429 is a rate limit
 * (retry after `Retry-After`, no attempt), 401 and 403 a revoked token (park), other 4xx a request
 * the provider will never accept (dead), 5xx an outage (retry, counts toward the breaker).
 */
export function httpFailure(status: number, retryAfter: string | null): ProviderFailure {
  if (status === 429) {
    const seconds = Number(retryAfter);
    return new ProviderFailure('rate_limited', 'provider rate limit', {
      status,
      ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterS: Math.ceil(seconds) } : {}),
    });
  }
  if (status === 401 || status === 403) {
    return new ProviderFailure('unauthorised', 'provider refused the credentials', { status });
  }
  if (status >= 400 && status < 500) {
    return new ProviderFailure('permanent', 'provider refused the request', { status });
  }
  return new ProviderFailure('transient', 'provider failed', { status });
}

export class StubMessageSender implements MessageSender {
  readonly channel = 'whatsapp' as const;
  readonly provider = 'stub';
  readonly #endpoint: string;
  readonly #namespace: string;
  readonly #timeoutMs: number;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetch: typeof fetch;

  constructor(options: StubSenderOptions) {
    if (options.appEnv !== 'local' && options.appEnv !== 'ci')
      throw new StubRefused(options.appEnv);
    this.#endpoint = new URL('/v1/messages', options.url).toString();
    this.#namespace = options.templateNamespace;
    this.#timeoutMs = options.timeoutMs ?? providerTimeoutMs;
    this.#headers = options.headers ?? {};
    this.#fetch = options.fetch ?? fetch;
  }

  async sendTemplate(input: SendTemplateInput): Promise<SentMessage> {
    if (messageTemplates[input.templateKey].channel !== 'whatsapp') {
      throw new ProviderFailure('permanent', 'not a WhatsApp template', { status: 'template' });
    }
    // Rendered here so a test reads exactly what the recipient would; refuses wrong parameters.
    const text = renderTemplate(input.templateKey, input.locale, input.params);
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.#headers },
        body: JSON.stringify({
          to: input.to,
          template: providerTemplateName(input.templateKey, this.#namespace),
          template_key: input.templateKey,
          locale: input.locale,
          params: input.params,
          text: text.body,
          client_reference: input.idempotencyKey,
        }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new ProviderFailure(
        'transient',
        timedOut ? 'provider timed out' : 'provider unreachable',
        {
          status: timedOut ? 'timeout' : 'network',
        },
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw httpFailure(response.status, response.headers.get('retry-after'));
    }
    const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
    if (typeof body?.id !== 'string' || body.id === '') {
      throw new ProviderFailure('transient', 'provider answered without a message id', {
        status: response.status,
      });
    }
    return { providerMessageId: body.id };
  }

  listTemplates(): Promise<readonly TemplateStatus[]> {
    const keys = (Object.keys(messageTemplates) as TemplateKey[]).filter(
      (key) => messageTemplates[key].channel === 'whatsapp',
    );
    return Promise.resolve(
      keys.flatMap((key) =>
        locales.map((locale) => ({
          key,
          locale,
          status: 'approved' as const,
          category: messageTemplates[key].category,
        })),
      ),
    );
  }
}
