import type { CredentialsCipher } from '@eeasy-logistics/config';
import { locales } from '@eeasy-logistics/i18n/templates';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import type { KindHandler, KindOutcome, OutboxRow, RelayRow } from '../outbox/kind-handlers.js';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { getMetrics } from '../telemetry/metrics.js';
import { BreakerOpen } from './breaker.js';
import { engineUnavailable } from './engine/engine-message-sender.js';
import type { EngineRoute, MessageSenders, SentMessage } from './message-sender.js';
import { MessagingNotConfigured } from './message-sender.js';
import type { CapCounter, RecipientLedger } from './message-policies.js';
import { capKeys, isStaleOtp, messageCaps, quietHoursWaitS } from './message-policies.js';
import { normalisePhone, phoneTail } from './phone.js';
import type { TemplateDefinition, TemplateKey } from './templates.js';
import { isTemplateKey, messageTemplates } from './templates.js';

// The `message` outbox handler (PLAT-9 plan 2.5, 2A.1; integrations §2.4, §4.1; ADR-0041): reads a
// `message` row, decrypts its secret parameters at send time only (the OTP code, never logged),
// resolves the engine sender (plan 2A.4), sends through the channel's adapter and maps the result
// to PLAT-8's outcomes. An engine that cannot be reached and an open breaker wait without consuming
// an attempt; refusals are dead (`ProviderFailure` through `failureOutcome`).

/** The decrypted `params.<name>.encrypted` of a secret parameter. */
const encryptedParam = z.strictObject({ encrypted: z.string().min(1).max(4096) });

/** A `message` row's payload (written by `OtpService` and, from wave 1, Delivery's consumers). */
export const messagePayload = z.object({
  channel: z.enum(['whatsapp', 'mail']),
  template_key: z.string().refine(isTemplateKey),
  to: z.string().min(3).max(320),
  locale: z.enum(locales),
  /** The OTP challenge whose context the code is encrypted under. */
  challenge_id: z.uuid().optional(),
  /** The order a recipient message is about (wave 1): the per-order cap's key. */
  order_id: z.uuid().optional(),
  params: z.record(z.string(), z.union([z.string(), encryptedParam])).default({}),
});
export type MessagePayload = z.infer<typeof messagePayload> & { template_key: TemplateKey };

/** Where an account's WhatsApp message leaves from (plan 2A.4), or why it cannot. */
export type SenderResolution = EngineRoute | 'no_sender';

export interface SenderResolver {
  resolve(accountId: string | null, template: TemplateKey): Promise<SenderResolution>;
}

/**
 * The platform's own sender only: OTP and platform-only rows (no account) use it; an account's
 * message has no sender. Item G replaces it with the per-account resolver of `core_messaging_senders`.
 */
export function platformOnlyResolver(
  senders: Pick<MessageSenders, 'platformRoute'>,
): SenderResolver {
  return {
    resolve: (accountId, template) => {
      const route = senders.platformRoute;
      const platform = template === 'auth_otp' || accountId === null;
      return Promise.resolve(platform && route !== null ? route : 'no_sender');
    },
  };
}

/** The decryption context of a template's secret parameters, from the row (data §10). */
function secretContext(template: TemplateKey, payload: MessagePayload): string | undefined {
  if (template === 'auth_otp' && payload.challenge_id !== undefined) {
    return `core_otp_challenges:${payload.challenge_id}`;
  }
  return undefined;
}

/** A row that can never be sent: dead at once, with a fixed message (never the payload). */
const deadRow = (status: string, message: string): KindOutcome => ({
  outcome: 'dead',
  error: { status, message },
});

/** An engine outage or open breaker: wait without spending the row's attempts (plan 2A.1, 2.5). */
const waitWithoutAttempt = (status: string, retryAfterS: number): KindOutcome => ({
  outcome: 'retry',
  consumesAttempt: false,
  retryAfterS,
  error: { status, message: 'messaging unavailable; waiting' },
});

export interface MessageHandlerDependencies {
  readonly senders: MessageSenders;
  /** Null without credentials keys: rows with secret parameters cannot be sent. */
  readonly cipher: CredentialsCipher | null;
  readonly resolver: SenderResolver;
  /** The send-time policies (plan 2.5, 2.7, 2.8); each is skipped when its dependency is absent. */
  readonly policies?: MessagePolicies;
  readonly logger?: Pick<Logger, 'log' | 'warn'>;
  /** Releases the handler's own clients when the worker stops. */
  readonly onClose?: () => Promise<void>;
}

export interface MessagePolicies {
  /** `MESSAGING_DISABLED=true`: every row is superseded with reason `disabled`. */
  readonly disabled?: boolean;
  readonly now?: () => Date;
  /** The opt-out list and the monthly usage and limit (integrations §5.5, §5.6). */
  readonly ledger?: RecipientLedger;
  /** The caps' counters and the key that pseudonymises phones in them (integrations §5.4). */
  readonly caps?: { readonly counter: CapCounter; readonly pseudonymKey: Buffer };
}

export class MessageKindHandler implements KindHandler {
  readonly kind = 'message' as const;
  readonly #deps: MessageHandlerDependencies;
  readonly #logger: Pick<Logger, 'log' | 'warn'>;

  constructor(deps: MessageHandlerDependencies) {
    this.#deps = deps;
    this.#logger = deps.logger ?? new Logger('MessageHandler');
  }

  async close(): Promise<void> {
    await this.#deps.onClose?.();
  }

  /** OTP rows retry on the `otp` schedule: three attempts within 60 s (integrations §4.2). */
  policyVariant(row: OutboxRow): string | undefined {
    const template = (row.payload as { template_key?: unknown } | null)?.template_key;
    return template === 'auth_otp' ? 'otp' : undefined;
  }

  /** Integrations §4.1: messages need no ordering. */
  orderingKey(row: RelayRow): string | null {
    void row;
    return null;
  }

  async execute(row: OutboxRow): Promise<KindOutcome> {
    const parsed = messagePayload.safeParse(row.payload);
    if (!parsed.success) return deadRow('payload', 'message payload is invalid');
    let payload = parsed.data as MessagePayload;
    // A WhatsApp recipient is E.164 from here on: the cap key, the opt-out lookup and the send all
    // use the one normalised number (lead review round 2, finding 1).
    if (payload.channel === 'whatsapp') {
      const to = normalisePhone(payload.to);
      if (to === undefined) return deadRow('payload', 'recipient is not a phone number');
      payload = { ...payload, to };
    }
    const template = payload.template_key;
    const definition: TemplateDefinition = messageTemplates[template];
    if (definition.channel !== payload.channel) {
      return deadRow('template', 'template is not sent on this channel');
    }

    const policies = this.#deps.policies ?? {};
    const now = policies.now?.() ?? new Date();
    // Integrations §2.4: a pause supersedes every row, OTP included.
    if (policies.disabled === true) return this.#supersede('disabled', template);
    // Integrations §4.3: an OTP older than 4 minutes is useless (the code expires at 5).
    if (template === 'auth_otp' && isStaleOtp(row.createdAt, now)) {
      return this.#supersede('stale', template);
    }
    // Integrations §5.4: a deferrable template waits out the quiet hours without an attempt.
    if (definition.deferrable) {
      const waitS = quietHoursWaitS(now);
      if (waitS > 0) {
        return {
          outcome: 'retry',
          consumesAttempt: false,
          retryAfterS: waitS,
          error: { status: 'quiet_hours', message: 'waiting for the end of quiet hours' },
        };
      }
    }
    // A recipient message of an account: opt-out, caps and budget (never OTP, never staff mail).
    const recipient =
      payload.channel === 'whatsapp' && template !== 'auth_otp' && row.accountId !== null
        ? { accountId: row.accountId, keys: this.#capKeys(row.accountId, payload, now) }
        : undefined;
    if (recipient !== undefined) {
      const skipped = await this.#recipientPolicies(recipient.accountId, recipient.keys, payload);
      if (skipped !== undefined) return this.#skip(skipped, template, payload);
    }

    const params = this.#params(template, definition, payload);
    if (typeof params === 'string') return deadRow('params', params);

    let route: EngineRoute | undefined;
    if (payload.channel === 'whatsapp') {
      const resolved = await this.#deps.resolver.resolve(row.accountId, template);
      if (resolved === 'no_sender') return this.#skip('no_sender', template, payload);
      route = resolved;
    }

    let sender;
    try {
      sender = this.#deps.senders.senderFor(row.accountId, payload.channel);
    } catch (error) {
      if (error instanceof MessagingNotConfigured) {
        return waitWithoutAttempt('not_configured', 60);
      }
      throw error;
    }

    let sent: SentMessage;
    try {
      sent = await sender.sendTemplate({
        to: payload.to,
        templateKey: template,
        locale: payload.locale,
        params,
        idempotencyKey: row.id,
        ...(route === undefined ? {} : { route }),
        // A row tried before asks the engine first (plan 2A.1).
        checkFirst: row.attempts > 0 || row.deferrals > 0,
      });
    } catch (error) {
      if (error instanceof BreakerOpen) return waitWithoutAttempt('breaker_open', 30);
      if (
        error instanceof ProviderFailure &&
        error.reason === 'transient' &&
        error.status === engineUnavailable
      ) {
        return waitWithoutAttempt(engineUnavailable, 30);
      }
      throw error;
    }
    getMetrics().add('messages_sent_total', 1, { template, locale: payload.locale });
    if (recipient !== undefined) await this.#countSent(recipient.accountId, recipient.keys);
    this.#logger.log(
      `message sent template=${template} channel=${payload.channel} provider=${sender.provider} ` +
        `state=${sent.providerState ?? 'n/a'} to=${this.#tail(payload)}`,
    );
    return { outcome: 'done' };
  }

  /** Superseded on purpose (integrations §2.4, §4.3), counted as a skip. */
  #supersede(reason: 'disabled' | 'stale', template: TemplateKey): KindOutcome {
    getMetrics().add('messages_skipped_total', 1, { reason });
    this.#logger.log(`message superseded reason=${reason} template=${template}`);
    return { outcome: 'superseded', reason };
  }

  #capKeys(accountId: string, payload: MessagePayload, now: Date): readonly string[] {
    const caps = this.#deps.policies?.caps;
    if (caps === undefined) return [];
    const keys = capKeys(caps.pseudonymKey, accountId, payload.to, payload.order_id, now);
    return keys.order === undefined ? [keys.phone] : [keys.phone, keys.order];
  }

  /**
   * The reason a recipient message is skipped, if any: the pair opted out (`opted_out`), the phone's
   * daily cap or the order's cap reached (`cap_phone`, `cap_order`), the month's budget spent
   * (`budget`). The database state is one read (one transaction); a failing Redis leaves the caps
   * open, like every PLAT-6 budget.
   */
  async #recipientPolicies(
    accountId: string,
    keys: readonly string[],
    payload: MessagePayload,
  ): Promise<string | undefined> {
    const policies = this.#deps.policies ?? {};
    const state = await policies.ledger?.read(accountId, payload.to);
    if (state?.optedOut === true) return 'opted_out';
    if (policies.caps !== undefined && keys.length > 0) {
      const counts = await policies.caps.counter.counts(keys).catch(() => {
        this.#logger.warn('message caps unreadable: not applied');
        return [];
      });
      if ((counts[0] ?? 0) >= messageCaps.perPhonePerDay) return 'cap_phone';
      if ((counts[1] ?? 0) >= messageCaps.perOrder) return 'cap_order';
    }
    if (state?.limit !== undefined && state.sentThisMonth >= state.limit) return 'budget';
    return undefined;
  }

  /** After a recipient message is sent: the month's usage and the caps' counters. */
  async #countSent(accountId: string, keys: readonly string[]): Promise<void> {
    const policies = this.#deps.policies ?? {};
    if (policies.ledger !== undefined) {
      const { sent, limit } = await policies.ledger.countSent(accountId);
      if (limit !== undefined && limit > 0) {
        getMetrics().set('message_budget_used_ratio', sent / limit, { account: accountId });
      }
    }
    if (policies.caps !== undefined && keys.length > 0) {
      await policies.caps.counter.hit(keys).catch(() => {
        this.#logger.warn('message caps not counted: Redis unavailable');
      });
    }
  }

  /** A deliberate skip: `done` with the reason (integrations §5.5), counted, never an error. */
  #skip(reason: string, template: TemplateKey, payload: MessagePayload): KindOutcome {
    getMetrics().add('messages_skipped_total', 1, { reason });
    this.#logger.log(
      `message skipped reason=${reason} template=${template} to=${this.#tail(payload)}`,
    );
    return { outcome: 'done', skipped: reason };
  }

  /** The recipient for logs: a phone's last two digits, never a mail address. */
  #tail(payload: MessagePayload): string {
    return payload.channel === 'whatsapp' ? phoneTail(payload.to) : 'mail';
  }

  /**
   * Every registry parameter in clear: plain ones as given, secret ones decrypted under the row's
   * context (data §10). Returns a reason instead when a parameter is missing, a secret one is not
   * encrypted, or it does not decrypt. The clear value never leaves this call except to the sender.
   */
  #params(
    template: TemplateKey,
    definition: TemplateDefinition,
    payload: MessagePayload,
  ): Record<string, string> | string {
    const params: Record<string, string> = {};
    for (const name of definition.params) {
      const value = Object.hasOwn(payload.params, name) ? payload.params[name] : undefined;
      if (value === undefined) return `parameter ${name} is missing`;
      const secret = definition.secretParams.includes(name);
      if (typeof value === 'string') {
        if (secret) return `parameter ${name} must be encrypted`;
        params[name] = value;
        continue;
      }
      const context = secretContext(template, payload);
      if (!secret || context === undefined || this.#deps.cipher === null) {
        return `parameter ${name} cannot be decrypted`;
      }
      try {
        params[name] = this.#deps.cipher.decrypt(Buffer.from(value.encrypted, 'base64'), context);
      } catch {
        return `parameter ${name} cannot be decrypted`;
      }
    }
    return params;
  }
}
