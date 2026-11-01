import { defineConfig } from '@eeasy-logistics/config';
import { describe, expect, it } from 'vitest';
import { memoryBreakerStateStore } from './breaker.js';
import { MailSender, smtpFailure } from './mail-sender.js';
import { MessagingNotConfigured } from './message-sender.js';
import { createMessageSenders } from './senders.js';

// PLAT-9 item B without a server: what the mail adapter refuses before connecting, how SMTP
// failures map to the outbox's kinds, and which adapters a configuration yields. The round trip to
// Mailpit is test/integration/messaging-senders.test.ts.

const mail = () =>
  new MailSender({ appEnv: 'ci', smtpUrl: 'smtp://127.0.0.1:9', from: 'no-reply@example.test' });

describe('MailSender', () => {
  it.each(['not-an-address', 'a@b.test\r\nBcc: c@d.test', 'Name <a@b.test>', 'a@b.test, c@d.test'])(
    'refuses the recipient %j before connecting',
    async (to) => {
      await expect(
        mail().sendTemplate({
          to,
          templateKey: 'password_reset',
          locale: 'en',
          params: { link: 'https://app.example.test/reset/x' },
          idempotencyKey: '00000000-0000-7000-8000-000000000001',
        }),
      ).rejects.toMatchObject({ reason: 'permanent', status: 'address' });
    },
  );

  it('refuses a WhatsApp template', async () => {
    await expect(
      mail().sendTemplate({
        to: 'a@example.test',
        templateKey: 'auth_otp',
        locale: 'en',
        params: { code: '123456' },
        idempotencyKey: '00000000-0000-7000-8000-000000000001',
      }),
    ).rejects.toMatchObject({ reason: 'permanent', status: 'template' });
  });
});

describe('smtpFailure', () => {
  it.each([
    [{ code: 'EAUTH', responseCode: 535 }, 'unauthorised'],
    [{ code: 'EENVELOPE', responseCode: 550 }, 'permanent'],
    [{ code: 'EMESSAGE', responseCode: 451 }, 'transient'],
    [{ code: 'ETIMEDOUT' }, 'transient'],
    [{ code: 'ECONNECTION' }, 'transient'],
    [new Error('anything'), 'transient'],
  ])('maps %j to %s', (error, reason) => {
    expect(smtpFailure(error).reason).toBe(reason);
  });
});

describe('createMessageSenders', () => {
  const deps = {
    breakerStore: memoryBreakerStateStore(),
    logger: { warn: () => undefined, log: () => undefined },
  };

  it('gives every account, and platform rows, the platform adapters', () => {
    const senders = createMessageSenders(
      defineConfig({
        APP_ENV: 'ci',
        MESSAGING_STUB_URL: 'http://127.0.0.1:8080',
        MAIL_SMTP_URL: 'smtp://127.0.0.1:1025',
        MAIL_FROM: 'no-reply@example.test',
      }),
      deps,
    );
    const platform = senders.senderFor(null);
    expect(platform.provider).toBe('stub');
    expect(senders.senderFor('00000000-0000-7000-8000-00000000000a')).toBe(platform);
    expect(senders.senderFor(null, 'mail').provider).toBe('smtp');
  });

  it('has no WhatsApp sender for a provider without an adapter in this build, nor mail unset', () => {
    const senders = createMessageSenders(
      defineConfig({
        APP_ENV: 'local',
        MESSAGING_PROVIDER: 'meta',
        MESSAGING_ACCESS_TOKEN: 'fake-token',
        MESSAGING_SENDER_ID: '1',
      }),
      deps,
    );
    expect(() => senders.senderFor(null)).toThrow(MessagingNotConfigured);
    expect(() => senders.senderFor(null, 'mail')).toThrow(MessagingNotConfigured);
  });
});
