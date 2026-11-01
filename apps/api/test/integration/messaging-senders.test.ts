import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MailSender } from '../../src/modules/kernel/messaging/mail-sender.js';
import { StubMessageSender } from '../../src/modules/kernel/messaging/stub-message-sender.js';
import { integrationConfig, mailpitUrl } from './support.js';

// PLAT-9 item B against the stack's real services (integrations §9): the stub adapter's round trip
// through tools/whatsapp-stub (the send is recorded, the code readable from `GET /sent`), and the
// mail adapter's round trip through Mailpit in Arabic and English.

const config = integrationConfig();

interface StubRecord {
  readonly path: string;
  readonly body: { client_reference?: string; to?: string; params?: { code?: string } };
}

interface MailpitSummary {
  readonly ID: string;
  readonly MessageID: string;
  readonly Subject: string;
}

async function mailpitMessage(messageId: string): Promise<{ Subject: string; Text: string }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const search = await fetch(
      `${mailpitUrl()}/api/v1/search?query=${encodeURIComponent(`message-id:"${messageId}"`)}`,
    );
    const { messages } = (await search.json()) as { messages: MailpitSummary[] };
    const found = messages[0];
    if (found !== undefined) {
      const full = await fetch(`${mailpitUrl()}/api/v1/message/${found.ID}`);
      return (await full.json()) as { Subject: string; Text: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mailpit has no message ${messageId}`);
}

describe('stub adapter against tools/whatsapp-stub (PLAT-9 item B)', () => {
  it('records the send with the code, retrievable by the client reference', async () => {
    const stubUrl = config.messaging.stubUrl;
    if (stubUrl === undefined) throw new Error('MESSAGING_STUB_URL is required for this suite');
    const sender = new StubMessageSender({
      appEnv: config.app.env,
      url: stubUrl,
      templateNamespace: config.messaging.templateNamespace,
    });
    const reference = randomUUID();
    const sent = await sender.sendTemplate({
      to: '+966500000123',
      templateKey: 'auth_otp',
      locale: 'ar',
      params: { code: '731904' },
      idempotencyKey: reference,
    });
    expect(sent.providerMessageId).toMatch(/^[0-9a-f-]{36}$/);
    const records = (await (await fetch(`${stubUrl}/sent`)).json()) as StubRecord[];
    const mine = records.filter((record) => record.body.client_reference === reference);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.path).toBe('/v1/messages');
    expect(mine[0]?.body).toMatchObject({ to: '+966500000123', params: { code: '731904' } });
  });
});

describe('mail adapter against Mailpit (PLAT-9 item B)', () => {
  const smtpUrl = config.mail.smtpUrl?.reveal();
  const from = config.mail.from;

  it.each([
    ['en', 'Reset your Eeasy Logistics password', 'Set a new password within 30 minutes'],
    ['ar', 'إعادة تعيين كلمة المرور في إيزي لوجستكس', 'عيّن كلمة مرور جديدة خلال 30 دقيقة'],
  ] as const)('delivers a password reset in %s', async (locale, subject, line) => {
    if (smtpUrl === undefined || from === undefined) {
      throw new Error('MAIL_SMTP_URL and MAIL_FROM are required for this suite');
    }
    const sender = new MailSender({ appEnv: config.app.env, smtpUrl, from });
    const reference = randomUUID();
    const link = `https://app.example.test/reset/${reference}`;
    try {
      const sent = await sender.sendTemplate({
        to: `reset-${reference}@example.test`,
        templateKey: 'password_reset',
        locale,
        params: { link },
        idempotencyKey: reference,
      });
      expect(sent.providerMessageId).toBe(`<${reference}@eeasy-logistics>`);
      const message = await mailpitMessage(`${reference}@eeasy-logistics`);
      expect(message.Subject).toBe(subject);
      expect(message.Text).toContain(line);
      expect(message.Text).toContain(link);
    } finally {
      sender.close();
    }
  });

  it('delivers an invitation with the account name in both locales', async () => {
    if (smtpUrl === undefined || from === undefined) {
      throw new Error('MAIL_SMTP_URL and MAIL_FROM are required for this suite');
    }
    const sender = new MailSender({ appEnv: config.app.env, smtpUrl, from });
    try {
      for (const locale of ['ar', 'en'] as const) {
        const reference = randomUUID();
        await sender.sendTemplate({
          to: `invite-${reference}@example.test`,
          templateKey: 'invitation',
          locale,
          params: { account_name: 'Acme', link: `https://app.example.test/invite/${reference}` },
          idempotencyKey: reference,
        });
        const message = await mailpitMessage(`${reference}@eeasy-logistics`);
        expect(message.Subject).toContain('Acme');
        expect(message.Text).toContain(`https://app.example.test/invite/${reference}`);
      }
    } finally {
      sender.close();
    }
  });
});
