// A mail row of core_outbox through the worker's processor and PLAT-9's real `message` handler to
// the stack's Mailpit (PLAT-12 member suites; the PLAT-11 sign-in suite does the same inline): the
// link a person receives is the one the API sealed on the row.
import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import type postgres from 'postgres';
import { vi } from 'vitest';
import { MailSender } from '../../src/modules/kernel/messaging/mail-sender.js';
import { MessageSenders } from '../../src/modules/kernel/messaging/message-sender.js';
import {
  MessageKindHandler,
  platformOnlyResolver,
} from '../../src/modules/kernel/messaging/message.handler.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import type { OutboxJob } from '../../src/worker/system/outbox-workers.js';
import { processOutboxJob } from '../../src/worker/system/outbox-workers.js';
import { mailpitUrl } from './support.js';

export interface MailRow {
  readonly id: string;
  readonly aggregate_id: string;
  readonly account_id: string | null;
  readonly payload: {
    readonly to: string;
    readonly locale: 'ar' | 'en';
    readonly template_key: string;
    readonly params: Record<string, string | { encrypted: string }>;
  };
}

/** The newest `message` row of `template` to `email`, or undefined. */
export async function latestMail(
  owner: postgres.Sql,
  email: string,
  template: string,
): Promise<MailRow | undefined> {
  const [row] = await owner<MailRow[]>`
    SELECT id, aggregate_id, payload, account_id FROM core_outbox
    WHERE kind = 'message' AND payload->>'to' = ${email} AND payload->>'template_key' = ${template}
    ORDER BY created_at DESC, id DESC LIMIT 1`;
  return row;
}

/** Sends one `message` row as the worker would; the row ends `done`. */
export async function sendMailRow(config: Config, outboxId: string): Promise<void> {
  const smtpUrl = config.mail.smtpUrl?.reveal();
  const from = config.mail.from;
  if (smtpUrl === undefined || from === undefined || config.credentials === null) {
    throw new Error('MAIL_SMTP_URL, MAIL_FROM and credentials are required');
  }
  const mail = new MailSender({ appEnv: config.app.env, smtpUrl, from });
  const senders = new MessageSenders({ whatsapp: null, mail, platformRoute: null });
  const quiet = { log: () => undefined, warn: () => undefined };
  const handler = new MessageKindHandler({
    senders,
    cipher: createCredentialsCipher(config.credentials),
    resolver: platformOnlyResolver(senders),
    logger: quiet,
  });
  const pool = createPlatformPool(config.db, 'member-mail-test');
  try {
    const job = {
      data: { outboxId },
      moveToDelayed: vi.fn(() => Promise.resolve()),
      updateData: vi.fn(() => Promise.resolve()),
    } as unknown as OutboxJob;
    await processOutboxJob(
      {
        db: pool.db,
        registry: new KindHandlerRegistry([handler]),
        logger: quiet,
        random: () => 0.5,
      },
      'message',
      job,
      'token',
    );
  } finally {
    mail.close();
    await pool.close();
  }
}

/** The message Mailpit received with this `Message-ID` (the outbox row id `@eeasy-logistics`). */
export async function mailpitMessage(
  messageId: string,
): Promise<{ Subject: string; Text: string }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const search = await fetch(
      `${mailpitUrl()}/api/v1/search?query=${encodeURIComponent(`message-id:"${messageId}"`)}`,
    );
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    const found = messages[0];
    if (found !== undefined) {
      const full = await fetch(`${mailpitUrl()}/api/v1/message/${found.ID}`);
      return (await full.json()) as { Subject: string; Text: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mailpit has no message ${messageId}`);
}
