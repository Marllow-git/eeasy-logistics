import type { Locale } from '@eeasy-logistics/i18n/templates';
import type { MessageChannel, TemplateKey } from './templates.js';

// The `MessageSender` port (PLAT-9 plan 2.1, 2A.1; integrations §2.4; ADR-0041): every outbound
// message leaves through one adapter of this shape, called only by the `message` outbox handler
// (ADR-0024). Adapters report provider failures as `ProviderFailure` (rate limited, unauthorised,
// permanent, transient) so the outbox decides the retry (ADR-0036).

/**
 * Which engine sender a WhatsApp message leaves through (plan 2A.3, 2A.4): the engine's integer
 * account id we map our account to (the platform's is reserved as 1) and the linked instance. The
 * handler resolves it from our own tables, never from a request.
 */
export interface EngineRoute {
  readonly engineAccountId: number;
  readonly senderInstanceId: string;
}

export interface SendTemplateInput {
  /** E.164 phone for WhatsApp, an address for mail. */
  readonly to: string;
  readonly templateKey: TemplateKey;
  readonly locale: Locale;
  /** Every registry parameter in clear: secret ones are decrypted by the caller at send time only. */
  readonly params: Readonly<Record<string, string>>;
  /** The outbox row id: the engine's `eeasy_message_id` and idempotency key, the mail Message-ID. */
  readonly idempotencyKey: string;
  /** The engine sender (WhatsApp only); an engine adapter refuses a send without one. */
  readonly route?: EngineRoute;
  /**
   * The row was tried before: ask the engine what it holds for this id first (`message.status`,
   * plan 2A.1), so a send whose answer was lost is not repeated.
   */
  readonly checkFirst?: boolean;
}

export interface SentMessage {
  readonly providerMessageId: string;
  /** The provider's state at acceptance (engine: `accepted`, `queued`, `suppressed`, …). */
  readonly providerState?: string;
}

export interface TemplateStatus {
  readonly key: TemplateKey;
  readonly locale: Locale;
  readonly status: 'approved' | 'pending' | 'rejected' | 'unknown';
  readonly category: string;
}

export interface MessageSender {
  readonly channel: MessageChannel;
  /** The adapter's name in logs, metrics and the breaker key (`stub`, `engine`, `smtp`). */
  readonly provider: string;
  sendTemplate(input: SendTemplateInput): Promise<SentMessage>;
  listTemplates(): Promise<readonly TemplateStatus[]>;
}

/** No adapter is configured for a channel (an unset provider, or the stub without its settings). */
export class MessagingNotConfigured extends Error {
  constructor(channel: MessageChannel) {
    super(`No message sender is configured for channel ${channel}`);
    this.name = 'MessagingNotConfigured';
  }
}

/** The adapters of this build, one per channel; null where none is configured. */
export interface PlatformSenders {
  readonly whatsapp: MessageSender | null;
  readonly mail: MessageSender | null;
  /** The platform's own engine sender (OTP and platform messages, plan 2A.4); null without one. */
  readonly platformRoute: EngineRoute | null;
}

/** The engine account id reserved for the platform's instance (plan 2A.3). */
export const platformEngineAccountId = 1;

/**
 * The adapters of this build. Which engine sender an account's message uses is the handler's
 * `SenderResolver` (plan 2A.4); the adapter of a channel is the same for every sender.
 */
export class MessageSenders {
  constructor(private readonly platform: PlatformSenders) {}

  /** The adapter of `channel`; throws `MessagingNotConfigured` when this build has none. */
  senderFor(accountId: string | null, channel: MessageChannel = 'whatsapp'): MessageSender {
    void accountId;
    const sender = this.platform[channel];
    if (sender === null) throw new MessagingNotConfigured(channel);
    return sender;
  }

  /** The platform's engine sender, or null when none is configured. */
  get platformRoute(): EngineRoute | null {
    return this.platform.platformRoute;
  }
}
