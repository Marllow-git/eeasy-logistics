import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ConfigError, defineConfig, Secret } from '../src/index.ts';
import { fakeKey, minimalEnv, productionEnv, valuesOf } from './fixtures.ts';

function configError(run: () => unknown): ConfigError {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected a ConfigError');
}

describe('defineConfig: valid input', () => {
  it('applies defaults to the smallest valid environment', () => {
    const config = defineConfig(minimalEnv);
    expect(config.app).toEqual({
      env: 'local',
      role: 'api',
      port: 3000,
      trustProxyHops: 0,
      publicWebUrl: undefined,
      publicAdminUrl: undefined,
      publicApiUrl: undefined,
    });
    expect(config.db.poolSize).toEqual({ app: 10, platform: 5 });
    expect(config.auth.accessTokenTtlSeconds).toBe(900);
    expect(config.messaging).toMatchObject({ provider: 'stub', disabled: false });
    expect(config.credentials).toBeNull();
  });

  it('parses a full environment into typed groups, secrets wrapped', () => {
    const config = defineConfig(productionEnv, { role: 'worker' });
    expect(config.app).toMatchObject({ env: 'production', role: 'worker', port: 8080 });
    expect(config.db.urls.app).toBeInstanceOf(Secret);
    expect(config.db.urls.app?.reveal()).toBe(productionEnv.DATABASE_URL_APP);
    expect(config.storage.bucket).toBe('elx-proofs');
    expect(config.messaging).toMatchObject({
      provider: 'meta',
      disabled: false,
      senderId: '100000000000001',
    });
    expect(Object.keys(config.credentials?.keys ?? {})).toEqual(['k1', 'k2']);
    expect(config.credentials?.activeKeyId).toBe('k2');
  });

  it('returns a deeply frozen object', () => {
    const config = defineConfig(productionEnv);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.db.urls)).toBe(true);
    expect(Object.isFrozen(config.credentials?.keys)).toBe(true);
    expect(() => {
      (config.app as { port: number }).port = 1;
    }).toThrow(TypeError);
  });

  it('never prints a secret when the config is logged or serialised', () => {
    const config = defineConfig(productionEnv);
    const printed = [
      inspect(config, { depth: 10 }),
      JSON.stringify(config),
      String(config.redis.url),
    ];
    for (const text of printed) {
      for (const value of [
        productionEnv.DATABASE_URL_APP,
        productionEnv.REDIS_URL,
        productionEnv.AUTH_SIGNING_KEY,
        productionEnv.STORAGE_SECRET_ACCESS_KEY,
        fakeKey(1),
      ]) {
        expect(text.includes(value ?? '')).toBe(false);
      }
      expect(text).toContain('[redacted]');
    }
  });

  it('treats an empty string as unset', () => {
    const config = defineConfig({ APP_ENV: 'ci', PORT: '', REDIS_URL: '' });
    expect(config.app.port).toBe(3000);
    expect(config.redis.url).toBeUndefined();
  });
});

describe('defineConfig: the RLS switch (PLAT-5 plan 2.6)', () => {
  it('defaults ELX_RLS to off', () => {
    expect(defineConfig({ APP_ENV: 'ci' }).db.rls).toBe(false);
  });

  it('reads on and off', () => {
    expect(defineConfig({ APP_ENV: 'ci', ELX_RLS: 'on' }).db.rls).toBe(true);
    expect(defineConfig({ APP_ENV: 'ci', ELX_RLS: 'off' }).db.rls).toBe(false);
  });

  it('rejects any other value, naming the variable', () => {
    expect(() => defineConfig({ APP_ENV: 'ci', ELX_RLS: 'true' })).toThrow(
      'ELX_RLS: is invalid: expected on or off',
    );
  });
});

describe('defineConfig: missing and malformed input', () => {
  it('names a missing required variable', () => {
    const error = configError(() => defineConfig({}));
    expect(error.issues).toEqual([
      { variable: 'APP_ENV', problem: expect.stringMatching(/^is required/) as string },
    ]);
  });

  it('names a malformed variable without echoing its value', () => {
    const env = {
      APP_ENV: 'local',
      PORT: 'eighty-eighty',
      REDIS_URL: 'http://not-redis-host:6379',
    };
    const error = configError(() => defineConfig(env));
    expect(error.issues.map((issue) => issue.variable)).toEqual(['PORT', 'REDIS_URL']);
    expect(error.message).not.toContain('eighty-eighty');
    expect(error.message).not.toContain('not-redis-host');
  });

  it('reports every problem at once, never a value', () => {
    const env: Record<string, string> = {
      APP_ENV: 'prod',
      PORT: '70000',
      DATABASE_URL_APP: 'mysql://user:fake-db-password@db:3306/x',
      AUTH_SIGNING_KEY: 'fake-short-key',
      MESSAGING_DISABLED: 'yes',
      CREDENTIALS_KEYS: `k1:${fakeKey(1)},fake-misplaced-key-material`,
    };
    const error = configError(() => defineConfig(env));
    expect(error.issues.map((issue) => issue.variable)).toEqual([
      'APP_ENV',
      'PORT',
      'DATABASE_URL_APP',
      'AUTH_SIGNING_KEY',
      'MESSAGING_DISABLED',
      'CREDENTIALS_KEYS',
      'AUTH_SIGNING_KEY_ID',
      'CREDENTIALS_ACTIVE_KEY_ID',
    ]);
    expect(error.message).toContain('Invalid configuration (8 problems)');
    for (const value of valuesOf(env)) expect(error.message).not.toContain(value);
    for (const part of ['fake-db-password', 'fake-misplaced-key-material', fakeKey(1)]) {
      expect(error.message).not.toContain(part);
    }
  });

  it('rejects a credentials key that is not 32 bytes and an active key id not in the map', () => {
    const shortKey = Buffer.alloc(16, 7).toString('base64');
    const error = configError(() =>
      defineConfig({
        APP_ENV: 'local',
        CREDENTIALS_KEYS: `k1:${shortKey}`,
        CREDENTIALS_ACTIVE_KEY_ID: 'k1',
      }),
    );
    expect(error.issues).toEqual([
      { variable: 'CREDENTIALS_KEYS', problem: 'is invalid: entry 1 is not 32 bytes in base64' },
    ]);
    const missing = configError(() =>
      defineConfig({
        APP_ENV: 'local',
        CREDENTIALS_KEYS: `k1:${fakeKey(1)}`,
        CREDENTIALS_ACTIVE_KEY_ID: 'k9',
      }),
    );
    expect(missing.issues.map((issue) => issue.variable)).toEqual(['CREDENTIALS_ACTIVE_KEY_ID']);
    expect(missing.message).not.toContain(fakeKey(1));
  });

  it('requires grouped variables together and provider credentials for a real provider', () => {
    const error = configError(() =>
      defineConfig({ APP_ENV: 'local', STORAGE_BUCKET: 'b', MESSAGING_PROVIDER: 'bsp' }),
    );
    expect(error.issues.map((issue) => issue.variable)).toEqual([
      'STORAGE_ENDPOINT',
      'STORAGE_ACCESS_KEY_ID',
      'STORAGE_SECRET_ACCESS_KEY',
      'MESSAGING_ACCESS_TOKEN',
      'MESSAGING_SENDER_ID',
    ]);
  });

  it('refuses a password in a URL that is not a secret; a user name alone is fine', () => {
    const env = {
      APP_ENV: 'local',
      VROOM_URL: 'http://user:fake-url-password@vroom.internal:3000',
      SENTRY_DSN: 'https://publickey@o1.ingest.example.test/1',
    };
    const error = configError(() => defineConfig(env));
    expect(error.issues).toEqual([
      {
        variable: 'VROOM_URL',
        problem:
          'is invalid: must not carry a password; put credentials in their own secret variable',
      },
    ]);
    expect(error.message).not.toContain('fake-url-password');
    const dsnOnly = { APP_ENV: 'local', SENTRY_DSN: env.SENTRY_DSN };
    expect(defineConfig(dsnOnly).observability.sentryDsn).toBe(env.SENTRY_DSN);
  });

  it('refuses a signing key with fewer than 16 distinct characters', () => {
    const weak = 'ab'.repeat(20);
    const error = configError(() =>
      defineConfig({ APP_ENV: 'local', AUTH_SIGNING_KEY_ID: 'k1', AUTH_SIGNING_KEY: weak }),
    );
    expect(error.issues.map((issue) => issue.variable)).toEqual(['AUTH_SIGNING_KEY']);
    expect(error.issues[0]?.problem).toContain('fewer than 16 distinct characters');
    expect(error.message).not.toContain(weak);
  });

  it('rejects an unknown role', () => {
    const error = configError(() => defineConfig(minimalEnv, { role: 'scheduler' as 'api' }));
    expect(error.issues.map((issue) => issue.variable)).toEqual(['--role']);
  });
});

describe('PUBLIC_ADMIN_URL (WEB-19 decision 2.5, ADR-0038)', () => {
  it('exposes a valid http(s) URL as config.app.publicAdminUrl', () => {
    const config = defineConfig({ APP_ENV: 'local', PUBLIC_ADMIN_URL: 'http://localhost:3002' });
    expect(config.app.publicAdminUrl).toBe('http://localhost:3002');
  });

  it('names an invalid URL without echoing it', () => {
    const error = configError(() =>
      defineConfig({ APP_ENV: 'local', PUBLIC_ADMIN_URL: 'ftp://admin-host.invalid' }),
    );
    expect(error.issues).toEqual([
      { variable: 'PUBLIC_ADMIN_URL', problem: 'is invalid: expected an http(s) URL' },
    ]);
    expect(error.message).not.toContain('admin-host.invalid');
  });

  it('is optional outside production and required in production', () => {
    expect(defineConfig({ APP_ENV: 'staging' }).app.publicAdminUrl).toBeUndefined();
    const env: Record<string, string> = { ...productionEnv };
    delete env.PUBLIC_ADMIN_URL;
    const error = configError(() => defineConfig(env));
    expect(error.issues).toEqual([
      { variable: 'PUBLIC_ADMIN_URL', problem: 'is required when APP_ENV=production' },
    ]);
  });
});

describe('TRUST_PROXY_HOPS (PLAT-6 review round 2, platform §8)', () => {
  it('defaults to 0 and reads an integer from 0 to 10', () => {
    expect(defineConfig(minimalEnv).app.trustProxyHops).toBe(0);
    expect(defineConfig({ ...minimalEnv, TRUST_PROXY_HOPS: '2' }).app.trustProxyHops).toBe(2);
    for (const value of ['-1', '11', 'one', '1.5', '00', '01']) {
      const error = configError(() => defineConfig({ ...minimalEnv, TRUST_PROXY_HOPS: value }));
      expect(error.issues.map((issue) => issue.variable)).toEqual(['TRUST_PROXY_HOPS']);
    }
  });

  it('is required and at least 1 for the api role in production; the worker needs none', () => {
    const env: Record<string, string> = { ...productionEnv };
    delete env.TRUST_PROXY_HOPS;
    expect(configError(() => defineConfig(env)).issues).toEqual([
      { variable: 'TRUST_PROXY_HOPS', problem: 'is required when APP_ENV=production' },
    ]);
    expect(
      configError(() => defineConfig({ ...productionEnv, TRUST_PROXY_HOPS: '0' })).issues,
    ).toEqual([
      {
        variable: 'TRUST_PROXY_HOPS',
        problem: 'must be at least 1 in production (Cloudflare is one hop)',
      },
    ]);
    // Re-check N-1: `00` is no way around the production rule.
    expect(
      configError(() => defineConfig({ ...productionEnv, TRUST_PROXY_HOPS: '00' })).issues.map(
        (issue) => issue.variable,
      ),
    ).toEqual(['TRUST_PROXY_HOPS']);
    expect(defineConfig(productionEnv).app.trustProxyHops).toBe(1);
    expect(defineConfig(env, { role: 'worker' }).app.trustProxyHops).toBe(0);
  });
});
