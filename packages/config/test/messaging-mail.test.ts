import { describe, expect, it } from 'vitest';
import type { AppRole } from '../src/index.ts';
import { ConfigError, defineConfig } from '../src/index.ts';
import { engineEnv, productionEnv, valuesOf } from './fixtures.ts';

// PLAT-9 plan 2.9 and 2A.1 (ADR-0041): the stub's URL, the engine variables with their rules, and
// the mail group (plan 2.2), with their production rules.

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

describe('messaging (PLAT-9 plan 2.9, 2A.1)', () => {
  it('defaults the provider to the stub locally and leaves the stub URL and the engine unset', () => {
    const config = defineConfig({ APP_ENV: 'local' });
    expect(config.messaging.provider).toBe('stub');
    expect(config.messaging.stubUrl).toBeUndefined();
    expect(Object.values(config.messaging.engine).every((value) => value === undefined)).toBe(true);
    expect(config.mail).toEqual({ smtpUrl: undefined, from: undefined });
  });

  it('reads the engine variables, every one but the instance id as a Secret', () => {
    const env = engineEnv();
    const config = defineConfig({ APP_ENV: 'ci', MESSAGING_PROVIDER: 'engine', ...env });
    const engine = config.messaging.engine;
    expect(engine.url?.reveal()).toBe(env.WHATSAPP_ENGINE_URL);
    expect(engine.serviceId?.reveal()).toBe(env.WHATSAPP_ENGINE_SERVICE_ID);
    expect(engine.keyId?.reveal()).toBe(env.WHATSAPP_ENGINE_KEY_ID);
    expect(engine.commandSecret?.reveal()).toBe(env.WHATSAPP_ENGINE_COMMAND_SECRET);
    expect(engine.callbackKeyId?.reveal()).toBe(env.WHATSAPP_ENGINE_CALLBACK_KEY_ID);
    expect(engine.callbackSecret?.reveal()).toBe(env.WHATSAPP_ENGINE_CALLBACK_SECRET);
    expect(engine.platformInstanceId).toBe(env.WHATSAPP_ENGINE_PLATFORM_INSTANCE_ID);
    const printed = JSON.stringify(config);
    expect(printed).not.toContain(env.WHATSAPP_ENGINE_COMMAND_SECRET);
    expect(printed).not.toContain(env.WHATSAPP_ENGINE_CALLBACK_SECRET);
  });

  it.each(['meta', 'bsp'])('refuses the withdrawn provider %s (ADR-0041)', (provider) => {
    expect(Object.keys(problems({ APP_ENV: 'local', MESSAGING_PROVIDER: provider }))).toEqual([
      'MESSAGING_PROVIDER',
    ]);
  });

  it.each(Object.keys(engineEnv()))('requires %s when the provider is engine', (variable) => {
    const env: Record<string, string> = {
      APP_ENV: 'local',
      MESSAGING_PROVIDER: 'engine',
      ...engineEnv(),
    };
    delete env[variable];
    expect(problems(env)).toEqual({ [variable]: 'is required when MESSAGING_PROVIDER is engine' });
  });

  it('refuses the same secret for commands and callbacks', () => {
    const env: Record<string, string> = { APP_ENV: 'local', ...engineEnv() };
    env.WHATSAPP_ENGINE_CALLBACK_SECRET = env.WHATSAPP_ENGINE_COMMAND_SECRET ?? '';
    expect(problems(env)).toEqual({
      WHATSAPP_ENGINE_CALLBACK_SECRET:
        'must differ from WHATSAPP_ENGINE_COMMAND_SECRET (engine contract §2.1)',
    });
  });

  it.each([
    ['https://wa-engine.internal:8790', true],
    ['http://127.0.0.1:8790', true],
    ['http://localhost:8790', true],
    ['http://[::1]:8790', true],
    ['http://wa-engine.internal:8790', false],
    ['http://10.0.0.5:8790', false],
    ['https://user:fake-pw@wa-engine.internal', false],
    ['ftp://wa-engine.internal', false],
  ])('engine URL %s accepted: %s (https off loopback, contract §2.8)', (url, ok) => {
    const found = problems({ APP_ENV: 'local', WHATSAPP_ENGINE_URL: url });
    expect(Object.keys(found)).toEqual(ok ? [] : ['WHATSAPP_ENGINE_URL']);
  });

  it('refuses short secrets and malformed key, service and instance ids', () => {
    const found = problems({
      APP_ENV: 'local',
      WHATSAPP_ENGINE_COMMAND_SECRET: 'too-short-secret',
      WHATSAPP_ENGINE_CALLBACK_SECRET: 'too-short-secret-2',
      WHATSAPP_ENGINE_KEY_ID: 'bad key id',
      WHATSAPP_ENGINE_CALLBACK_KEY_ID: 'bad\nid',
      WHATSAPP_ENGINE_SERVICE_ID: 'eeasy laravel',
      WHATSAPP_ENGINE_PLATFORM_INSTANCE_ID: 'not-a-uuid',
    });
    expect(Object.keys(found).sort()).toEqual([
      'WHATSAPP_ENGINE_CALLBACK_KEY_ID',
      'WHATSAPP_ENGINE_CALLBACK_SECRET',
      'WHATSAPP_ENGINE_COMMAND_SECRET',
      'WHATSAPP_ENGINE_KEY_ID',
      'WHATSAPP_ENGINE_PLATFORM_INSTANCE_ID',
      'WHATSAPP_ENGINE_SERVICE_ID',
    ]);
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
