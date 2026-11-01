import type { AppEnv } from '@eeasy-logistics/config';
import { isConfidentialUrl } from '@eeasy-logistics/config';
import { locales } from '@eeasy-logistics/i18n/templates';
import { ProviderFailure } from '../../outbox/provider-failure.js';
import { withPortSpan } from '../../telemetry/port-span.js';
import type {
  EngineRoute,
  MessageSender,
  SendTemplateInput,
  SentMessage,
  TemplateStatus,
} from '../message-sender.js';
import type { EngineMessageType, TemplateDefinition, TemplateKey } from '../templates.js';
import { messageTemplates, renderTemplate } from '../templates.js';
import type { SigningKey } from './envelope.js';
import { engineCommandPath, maxEngineBodyBytes, signedHeaders, wireInstant } from './envelope.js';

// The WhatsApp adapter (ADR-0041; PLAT-9 plan 2A.1): signed commands to the Eeasy WhatsApp engine's
// `POST /internal/v1/commands` (engine contract §2–§4). OTP goes as `message.send.verification`
// (priority 1, held 600 s, never suppression-checked), every other WhatsApp template as
// `message.send.text` (suppression-checked, held while the sender is away). The outbox row id is
// the engine's `eeasy_message_id` and idempotency key, so a retry with a fresh nonce is the same
// message; `checkFirst` asks `message.status` before a retry. The `stub` provider is the same
// adapter pointed at `tools/whatsapp-stub`, refused outside local and ci.

/** Integrations §2.4: every provider call times out after 5 s. */
export const providerTimeoutMs = 5_000;

/** The failure status of an engine that cannot be reached or answers 5xx (contract §2.3). */
export const engineUnavailable = 'ENGINE_UNAVAILABLE';

export class StubRefused extends Error {
  constructor(appEnv: string) {
    super(`The WhatsApp stub is for local and ci only; ${appEnv} refuses it`);
    this.name = 'StubRefused';
  }
}

/** Engine contract §6.2 and §6.3: the priority class and hold the engine re-derives per type. */
export const engineMessageTypes: Readonly<
  Record<EngineMessageType, { readonly priority: 1 | 2 | 3 | 4; readonly holdS: number }>
> = {
  verification: { priority: 1, holdS: 600 },
  shipment_issued: { priority: 2, holdS: 86_400 },
  digest_daily: { priority: 3, holdS: 21_600 },
  digest_weekly: { priority: 3, holdS: 86_400 },
  digest_monthly: { priority: 3, holdS: 86_400 },
  manual_custom: { priority: 4, holdS: 86_400 },
  connection_test: { priority: 4, holdS: 600 },
};

/** A payload string that starts like an absolute URL is refused by the engine (contract §4.9). */
const absoluteUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * The text the engine sends for a WhatsApp template: the body, then the footer on its own line.
 * The engine sends free text, so the copy-code button of a Cloud API template has no counterpart.
 */
export function whatsappText(
  key: TemplateKey,
  locale: SendTemplateInput['locale'],
  params: SendTemplateInput['params'],
): string {
  const rendered = renderTemplate(key, locale, params);
  return [rendered.body, rendered.footer]
    .filter((part) => part !== undefined && part !== '')
    .join('\n\n');
}

/** The envelope fields of contract §3, every one present (`null` where unused). */
export interface EngineEnvelope {
  readonly command: string;
  readonly eeasy_account_id: number;
  readonly eeasy_store_id: null;
  readonly sender_instance_id: string;
  readonly eeasy_message_id: string;
  readonly message_type: EngineMessageType | null;
  readonly priority_class: number | null;
  readonly expires_at: string | null;
  readonly idempotency_key: string | null;
  readonly payload: Record<string, unknown>;
}

/** The send command of a template (contract §4.8, §4.10); throws for a template with no type. */
export function sendCommand(
  input: SendTemplateInput,
  route: EngineRoute,
  nowMs: number,
): EngineEnvelope {
  const definition: TemplateDefinition = messageTemplates[input.templateKey];
  const type = definition.engineMessageType;
  if (definition.channel !== 'whatsapp' || type === undefined) {
    throw new ProviderFailure('permanent', 'not a WhatsApp template', { status: 'template' });
  }
  const { priority, holdS } = engineMessageTypes[type];
  const body = whatsappText(input.templateKey, input.locale, input.params);
  const common = { to_number: input.to, body, locale: input.locale, lane_key: input.to };
  const verification = type === 'verification';
  return {
    command: verification ? 'message.send.verification' : 'message.send.text',
    eeasy_account_id: route.engineAccountId,
    eeasy_store_id: null,
    sender_instance_id: route.senderInstanceId,
    eeasy_message_id: input.idempotencyKey,
    message_type: type,
    priority_class: priority,
    expires_at: wireInstant(nowMs + holdS * 1000),
    idempotency_key: input.idempotencyKey,
    payload: verification
      ? { ...common, suppression_check: false }
      : { ...common, suppression_check: true, availability_policy: 'hold' },
  };
}

interface EngineAnswer {
  readonly ok?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly retryable?: unknown };
}

/**
 * Maps a refused command to the outbox's failure kinds (ADR-0036; plan 2A.1): 401 (an auth class:
 * our key or secret is wrong) parks like a revoked token; 429 is a rate limit; 5xx is the engine
 * being unavailable (transient, counted by the breaker); any other refusal (422 schema or binding,
 * 409, 413) is dead with the engine's machine code, unless the engine marks it retryable.
 */
export function engineFailure(
  status: number,
  answer: EngineAnswer | null,
  retryAfter: string | null,
): ProviderFailure {
  const code = typeof answer?.error?.code === 'string' ? answer.error.code.slice(0, 64) : undefined;
  if (status === 401 || status === 403) {
    return new ProviderFailure('unauthorised', 'the engine refused our signature', {
      status: code ?? status,
    });
  }
  if (status === 429) {
    const seconds = Number(retryAfter);
    return new ProviderFailure('rate_limited', 'engine rate limit', {
      status: code ?? status,
      ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterS: Math.ceil(seconds) } : {}),
    });
  }
  if (status >= 500 || status === 0) {
    return new ProviderFailure('transient', 'the engine is unavailable', {
      status: code ?? engineUnavailable,
    });
  }
  if (answer?.error?.retryable === true) {
    return new ProviderFailure('transient', 'the engine asked for a retry', {
      status: code ?? status,
    });
  }
  return new ProviderFailure('permanent', 'the engine refused the command', {
    status: code ?? status,
  });
}

export interface EngineSenderOptions {
  /** `engine`, or `stub` for `tools/whatsapp-stub` (local and ci only). */
  readonly provider: 'engine' | 'stub';
  readonly appEnv: AppEnv;
  readonly baseUrl: string;
  readonly key: SigningKey;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** Extra request headers; tests pass the stub's `x-stub-fault` (integrations §9). */
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetch?: typeof fetch;
}

export class EngineMessageSender implements MessageSender {
  readonly channel = 'whatsapp' as const;
  readonly provider: 'engine' | 'stub';
  readonly #endpoint: string;
  readonly #key: SigningKey;
  readonly #timeoutMs: number;
  readonly #now: () => number;
  readonly #headers: Readonly<Record<string, string>>;
  readonly #fetch: typeof fetch;

  constructor(options: EngineSenderOptions) {
    if (options.provider === 'stub' && options.appEnv !== 'local' && options.appEnv !== 'ci') {
      throw new StubRefused(options.appEnv);
    }
    // Contract §2.8: HMAC gives no confidentiality, and every send carries a number (and an OTP).
    if (!isConfidentialUrl(options.baseUrl)) {
      throw new Error('The engine URL must be https unless it is a loopback host');
    }
    this.provider = options.provider;
    this.#endpoint = new URL(engineCommandPath, options.baseUrl).toString();
    this.#key = options.key;
    this.#timeoutMs = options.timeoutMs ?? providerTimeoutMs;
    this.#now = options.now ?? Date.now;
    this.#headers = options.headers ?? {};
    this.#fetch = options.fetch ?? fetch;
  }

  async sendTemplate(input: SendTemplateInput): Promise<SentMessage> {
    const route = input.route;
    if (route === undefined) {
      throw new ProviderFailure('permanent', 'no engine sender for this message', {
        status: 'no_route',
      });
    }
    if (input.checkFirst === true) {
      const known = await this.#status(input, route).catch(() => undefined);
      if (known !== undefined) return known;
    }
    const envelope = sendCommand(input, route, this.#now());
    const result = await this.#command(envelope, input);
    const state = typeof result.status === 'string' ? result.status : undefined;
    return {
      providerMessageId: input.idempotencyKey,
      ...(state === undefined ? {} : { providerState: state }),
    };
  }

  listTemplates(): Promise<readonly TemplateStatus[]> {
    // ADR-0041: the engine has no templates; the local registry is the list.
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

  /** `message.status` (contract §4.11): the engine's state of this id, or undefined if unknown. */
  async #status(input: SendTemplateInput, route: EngineRoute): Promise<SentMessage | undefined> {
    const result = await this.#command(
      {
        command: 'message.status',
        eeasy_account_id: route.engineAccountId,
        eeasy_store_id: null,
        sender_instance_id: route.senderInstanceId,
        eeasy_message_id: input.idempotencyKey,
        message_type: null,
        priority_class: null,
        expires_at: null,
        idempotency_key: null,
        payload: {},
      },
      input,
    );
    if (result.exists !== true) return undefined;
    const state = typeof result.status === 'string' ? result.status : undefined;
    // A message the engine already ended failed or expired is sent again under the same key; the
    // engine answers the duplicate with its stored state, so nothing leaves twice.
    if (state === 'failed' || state === 'expired') return undefined;
    return {
      providerMessageId: input.idempotencyKey,
      ...(state === undefined ? {} : { providerState: state }),
    };
  }

  async #command(
    envelope: EngineEnvelope,
    input: SendTemplateInput,
  ): Promise<Record<string, unknown>> {
    // Contract §4.9 rule 2, checked before anything leaves (as eeasynew's client does).
    for (const value of Object.values(envelope.payload)) {
      if (typeof value === 'string' && absoluteUrl.test(value.trim())) {
        throw new ProviderFailure('permanent', 'a payload may not carry an absolute URL', {
          status: 'PAYLOAD_URL_FORBIDDEN',
        });
      }
    }
    const raw = JSON.stringify(envelope);
    if (Buffer.byteLength(raw, 'utf8') > maxEngineBodyBytes) {
      throw new ProviderFailure('permanent', 'the command exceeds 256 KiB', {
        status: 'REQUEST_TOO_LARGE',
      });
    }
    const method = envelope.command === 'message.status' ? 'status' : 'send_template';
    return withPortSpan(
      {
        port: 'message_sender',
        method,
        provider: this.provider,
        outboxRowId: input.idempotencyKey,
      },
      async (span) => {
        let response: Response;
        try {
          response = await this.#fetch(this.#endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
              accept: 'application/json',
              ...signedHeaders(this.#key, 'POST', engineCommandPath, raw, this.#now()),
              ...this.#headers,
            },
            body: raw,
            signal: AbortSignal.timeout(this.#timeoutMs),
          });
        } catch (error) {
          const timedOut = error instanceof Error && error.name === 'TimeoutError';
          throw new ProviderFailure(
            'transient',
            timedOut ? 'the engine timed out' : 'the engine is unreachable',
            { status: engineUnavailable },
          );
        }
        span.setHttpStatus(response.status);
        const answer = (await response.json().catch(() => null)) as EngineAnswer | null;
        if (!response.ok || answer?.ok !== true) {
          throw engineFailure(
            response.ok ? 502 : response.status,
            answer,
            response.headers.get('retry-after'),
          );
        }
        const result = answer.result;
        return result !== null && typeof result === 'object'
          ? (result as Record<string, unknown>)
          : {};
      },
    );
  }
}
