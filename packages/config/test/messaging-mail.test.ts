import { describe, expect, it } from 'vitest';
import type { AppRole } from '../src/index.ts';
import { ConfigError, defineConfig } from '../src/index.ts';
import { productionEnv, valuesOf } from './fixtures.ts';

// PLAT-9 plan 2.9 (items A): the messaging additions (webhook secret, template namespace, the
// stub's URL) and the mail group (plan 2.2), with their production rules.

function problems(env: Record<string, string>, role: AppRole = 'api'): Record<string, string> {
  try {
    defineConfig(env, { role });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const value of valuesOf(env)) expect(error.message).not.toContain(value);
    return Object.fromEntries(error.issues.map((issue) => [issue.variable, issue.problem]));
  }
  return {};
}

describe('messaging additions (PLAT-9 plan 2.9)', () => {
  it('defaults the template namespace to elx and leaves the rest unset', () => {
    const config = defineConfig({ APP_ENV: 'local' });
    expect(config.messaging).toMatchObject({
      templateNamespace: 'elx',
      stubUrl: undefined,
      webhookSecret: undefined,
    });
    expect(config.mail).toEqual({ smtpUrl: undefined, from: undefined });
  });

  it('reads the stub URL, the namespace and the webhook secret as a Secret', () => {
    const config = defineConfig({
      APP_ENV: 'ci',
      MESSAGING_STUB_URL: 'http://127.0.0.1:8080',
      MESSAGING_TEMPLATE_NAMESPACE: 'elx2',
      MESSAGING_WEBHOOK_SECRET: 'fake-webhook-secret-0123',
    });
    expect(config.messaging.stubUrl).toBe('http://127.0.0.1:8080');
    expect(config.messaging.templateNamespace).toBe('elx2');
    expect(config.messaging.webhookSecret?.reveal()).toBe('fake-webhook-secret-0123');
    expect(String(config.messaging.webhookSecret)).toBe('[redacted]');
  });

  it.each(['', 'Elx', '1elx', 'elx_', 'a-b', 'abcdefghijklmnopq'])(
    'refuses the template namespace %j',
    (value) => {
      expect(
        Object.keys(problems({ APP_ENV: 'local', MESSAGING_TEMPLATE_NAMESPACE: value })),
      ).toEqual(value === '' ? [] : ['MESSAGING_TEMPLATE_NAMESPACE']);
    },
  );

  it('refuses a webhook secret shorter than 16 characters', () => {
    expect(problems({ APP_ENV: 'local', MESSAGING_WEBHOOK_SECRET: 'short-secret' })).toHaveProperty(
      'MESSAGING_WEBHOOK_SECRET',
    );
  });

  it.each(['staging', 'production'])('refuses the stub URL in %s', (appEnv) => {
    const env = appEnv === 'production' ? productionEnv : { APP_ENV: appEnv };
    const found = problems({ ...env, MESSAGING_STUB_URL: 'http://stub.internal:8080' });
    expect(found).toEqual({
      MESSAGING_STUB_URL: `is for local and ci tooling only; ${appEnv} refuses it`,
    });
  });
});

describe('mail (PLAT-9 plan 2.2)', () => {
  it('reads the SMTP URL as a Secret and the sender as given', () => {
    const config = defineConfig({
      APP_ENV: 'local',
      MAIL_SMTP_URL: 'smtp://127.0.0.1:1025',
      MAIL_FROM: 'Eeasy Logistics <no-reply@example.test>',
    });
    expect(config.mail.smtpUrl?.reveal()).toBe('smtp://127.0.0.1:1025');
    expect(String(config.mail.smtpUrl)).toBe('[redacted]');
    expect(config.mail.from).toBe('Eeasy Logistics <no-reply@example.test>');
  });

  it.each(['smtp://127.0.0.1:1025', 'smtps://user:fake-pw@smtp.example.test:465'])(
    'accepts the SMTP URL %s',
    (url) => {
      expect(problems({ APP_ENV: 'local', MAIL_SMTP_URL: url })).toEqual({});
    },
  );

  it.each(['http://smtp.example.test', 'not a url', 'redis://127.0.0.1:6379'])(
    'refuses the SMTP URL %s',
    (url) => {
      expect(Object.keys(problems({ APP_ENV: 'local', MAIL_SMTP_URL: url }))).toEqual([
        'MAIL_SMTP_URL',
      ]);
    },
  );

  it.each(['no-reply@example.test', 'Eeasy Logistics <no-reply@example.test>'])(
    'accepts the sender %s',
    (from) => {
      expect(problems({ APP_ENV: 'local', MAIL_FROM: from })).toEqual({});
    },
  );

  it.each([
    'no-reply',
    'Name <no-reply@example.test',
    'Name\r\nBcc: victim@example.test <no-reply@example.test>',
    'a@example.test\nBcc: b@example.test',
  ])('refuses the sender %j (no header injection)', (from) => {
    expect(Object.keys(problems({ APP_ENV: 'local', MAIL_FROM: from }))).toEqual(['MAIL_FROM']);
  });

  it.each(['api', 'worker'] as const)(
    'requires SMTP and the sender in production for %s',
    (role) => {
      const env = { ...productionEnv };
      delete env.MAIL_SMTP_URL;
      delete env.MAIL_FROM;
      expect(problems(env, role)).toEqual({
        MAIL_SMTP_URL: 'is required when APP_ENV=production',
        MAIL_FROM: 'is required when APP_ENV=production',
      });
    },
  );

  it('does not require mail for the migration job', () => {
    const env = {
      APP_ENV: 'production',
      DATABASE_URL_OWNER: 'postgres://elx_owner:fake-owner-pw@db.internal:5432/elx',
    };
    expect(problems(env, 'migrate')).toEqual({});
  });
});
