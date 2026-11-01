import type { AppEnv } from '@eeasy-logistics/config';
import { locales } from '@eeasy-logistics/i18n/templates';
import nodemailer from 'nodemailer';
import { ProviderFailure } from '../outbox/provider-failure.js';
import type {
  MessageSender,
  SendTemplateInput,
  SentMessage,
  TemplateStatus,
} from './message-sender.js';
import { providerTimeoutMs } from './stub-message-sender.js';
import type { TemplateKey } from './templates.js';
import { messageTemplates, renderTemplate } from './templates.js';

// The mail adapter (PLAT-9 plan 2.2): invitations and password resets leave as `message` outbox rows
// with `channel: 'mail'` and are sent here over SMTP (Mailpit locally and in ci). Plain-text bodies
// from the `messages` templates, no attachments; the outbox row id is the Message-ID, so a resend
// after a timeout carries the same id and a receiving server or inbox can collapse it.

export interface MailSenderOptions {
  readonly appEnv: AppEnv;
  readonly smtpUrl: string;
  readonly from: string;
  readonly timeoutMs?: number;
}

/** A single address: no display name, no line break, one `@` (header injection, plan 2.2). */
const addressPattern = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/;

/** The SMTP error fields nodemailer sets. */
interface SmtpError {
  readonly code?: string;
  readonly responseCode?: number;
}

/**
 * Maps an SMTP failure to the outbox's kinds (ADR-0036): refused credentials park, a 5xx reply is a
 * message the server will never take, everything else (4xx replies, connection, timeouts) retries.
 */
export function smtpFailure(error: unknown): ProviderFailure {
  const { code, responseCode } = (error ?? {}) as SmtpError;
  if (code === 'EAUTH') {
    return new ProviderFailure('unauthorised', 'SMTP refused the credentials', {
      status: responseCode ?? code,
    });
  }
  if (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600) {
    return new ProviderFailure('permanent', 'SMTP refused the message', { status: responseCode });
  }
  return new ProviderFailure('transient', 'SMTP failed', {
    status: responseCode ?? code ?? 'smtp',
  });
}

export class MailSender implements MessageSender {
  readonly channel = 'mail' as const;
  readonly provider = 'smtp';
  readonly #transport: ReturnType<typeof nodemailer.createTransport>;
  readonly #from: string;

  constructor(options: MailSenderOptions) {
    const timeout = options.timeoutMs ?? providerTimeoutMs;
    this.#from = options.from;
    this.#transport = nodemailer.createTransport({
      url: options.smtpUrl,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      // Deployed environments never send a reset link in clear over `smtp://`: STARTTLS or fail.
      requireTLS: options.appEnv === 'staging' || options.appEnv === 'production',
    });
  }

  async sendTemplate(input: SendTemplateInput): Promise<SentMessage> {
    if (messageTemplates[input.templateKey].channel !== 'mail') {
      throw new ProviderFailure('permanent', 'not a mail template', { status: 'template' });
    }
    if (!addressPattern.test(input.to)) {
      throw new ProviderFailure('permanent', 'not a mail address', { status: 'address' });
    }
    const text = renderTemplate(input.templateKey, input.locale, input.params);
    let info: unknown;
    try {
      info = await this.#transport.sendMail({
        from: this.#from,
        to: input.to,
        subject: text.subject,
        text: text.body,
        messageId: `<${input.idempotencyKey}@eeasy-logistics>`,
        headers: { 'Content-Language': input.locale },
      });
    } catch (error) {
      throw smtpFailure(error);
    }
    const messageId = (info as { messageId?: unknown } | null)?.messageId;
    if (typeof messageId !== 'string' || messageId === '') {
      throw new ProviderFailure('transient', 'SMTP answered without a message id', {
        status: 'smtp',
      });
    }
    return { providerMessageId: messageId };
  }

  listTemplates(): Promise<readonly TemplateStatus[]> {
    const keys = (Object.keys(messageTemplates) as TemplateKey[]).filter(
      (key) => messageTemplates[key].channel === 'mail',
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

  close(): void {
    this.#transport.close();
  }
}
