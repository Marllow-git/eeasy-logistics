import type { Locale } from '@eeasy-logistics/i18n/templates';
import type { MessageChannel, TemplateKey } from './templates.js';

// The `MessageSender` port (PLAT-9 plan 2.1; integrations §2.4): every outbound message leaves
// through one adapter of this shape, called only by the `message` outbox handler (ADR-0024; leg 2).
// Adapters report provider failures as `ProviderFailure` (rate limited, unauthorised, permanent,
// transient) so the outbox decides the retry (ADR-0036).

export interface SendTemplateInput {
  /** E.164 phone for WhatsApp, an address for mail. */
  readonly to: string;
  readonly templateKey: TemplateKey;
  readonly locale: Locale;
  /** Every registry parameter in clear: secret ones are decrypted by the caller at send time only. */
  readonly params: Readonly<Record<string, string>>;
  /** The outbox row id, sent as the provider's client reference where supported. */
  readonly idempotencyKey: string;
}

export interface SentMessage {
  readonly providerMessageId: string;
}

export interface TemplateStatus {
  readonly key: TemplateKey;
  readonly locale: Locale;
  readonly status: 'approved' | 'pending' | 'rejected' | 'unknown';
  readonly category: string;
}

export interface MessageSender {
  readonly channel: MessageChannel;
  /** The adapter's name in logs, metrics and the breaker key (`stub`, `smtp`, …). */
  readonly provider: string;
  sendTemplate(input: SendTemplateInput): Promise<SentMessage>;
  listTemplates(): Promise<readonly TemplateStatus[]>;
}

/** No adapter is configured for a channel (an unset or not yet built provider). */
export class MessagingNotConfigured extends Error {
  constructor(channel: MessageChannel) {
    super(`No message sender is configured for channel ${channel}`);
    this.name = 'MessagingNotConfigured';
  }
}

/** The platform's adapters, one per channel; null where none is configured in this build. */
export interface PlatformSenders {
  readonly whatsapp: MessageSender | null;
  readonly mail: MessageSender | null;
}

/**
 * Chooses the adapter for a message (owner input 2026-11-01: an admin links the platform's
 * WhatsApp number, and a merchant may later link its own for its customers' messages). Today every
 * account, and platform-only rows (`null`), get the platform adapter; per-account linking replaces
 * the body of `senderFor`, not its callers.
 */
export class MessageSenders {
  constructor(private readonly platform: PlatformSenders) {}

  senderFor(accountId: string | null, channel: MessageChannel = 'whatsapp'): MessageSender {
    void accountId;
    const sender = this.platform[channel];
    if (sender === null) throw new MessagingNotConfigured(channel);
    return sender;
  }
}
