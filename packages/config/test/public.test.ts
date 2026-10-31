import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../src/index.ts';
import { parseDriverPublicConfig, parseWebPublicConfig } from '../src/public.ts';

function issuesOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error.issues.map((issue) => issue.variable);
    throw error;
  }
  return [];
}

describe('web public config (NEXT_PUBLIC_*)', () => {
  it('parses valid values into a frozen object', () => {
    const config = parseWebPublicConfig({
      NEXT_PUBLIC_APP_ENV: 'staging',
      NEXT_PUBLIC_SENTRY_DSN: 'https://public@o1.ingest.example.test/1',
    });
    expect(config).toEqual({
      appEnv: 'staging',
      sentryDsn: 'https://public@o1.ingest.example.test/1',
      posthogKey: undefined,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('reports every missing or malformed variable at once', () => {
    expect(issuesOf(() => parseWebPublicConfig({ NEXT_PUBLIC_SENTRY_DSN: 'not a url' }))).toEqual([
      'NEXT_PUBLIC_APP_ENV',
      'NEXT_PUBLIC_SENTRY_DSN',
    ]);
  });

  it('ignores variables it does not declare', () => {
    const config = parseWebPublicConfig({ NEXT_PUBLIC_APP_ENV: 'ci', AUTH_SIGNING_KEY: 'x' });
    expect(Object.keys(config)).toEqual(['appEnv', 'sentryDsn', 'posthogKey']);
  });
});

describe('publicConfig() entry points', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('web reads each NEXT_PUBLIC_* variable', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'ci');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_fake_project_key');
    const { publicConfig } = await import('../src/web.ts');
    expect(publicConfig()).toEqual({
      appEnv: 'ci',
      sentryDsn: undefined,
      posthogKey: 'phc_fake_project_key',
    });
  });

  it('driver reads each EXPO_PUBLIC_* variable', async () => {
    vi.stubEnv('EXPO_PUBLIC_APP_ENV', 'staging');
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://api.staging.example.test');
    const { publicConfig } = await import('../src/driver.ts');
    expect(publicConfig()).toMatchObject({
      appEnv: 'staging',
      apiUrl: 'https://api.staging.example.test',
    });
  });
});

describe('driver public config (EXPO_PUBLIC_*)', () => {
  it('parses valid values', () => {
    const config = parseDriverPublicConfig({
      EXPO_PUBLIC_APP_ENV: 'local',
      EXPO_PUBLIC_API_URL: 'http://192.168.1.10:3000',
    });
    expect(config).toMatchObject({ appEnv: 'local', apiUrl: 'http://192.168.1.10:3000' });
  });

  it('requires the API URL', () => {
    expect(issuesOf(() => parseDriverPublicConfig({ EXPO_PUBLIC_APP_ENV: 'local' }))).toEqual([
      'EXPO_PUBLIC_API_URL',
    ]);
  });

  it('refuses a plain-http API URL in production', () => {
    const env = {
      EXPO_PUBLIC_APP_ENV: 'production',
      EXPO_PUBLIC_API_URL: 'http://api.example.test',
    };
    expect(issuesOf(() => parseDriverPublicConfig(env))).toEqual(['EXPO_PUBLIC_API_URL']);
    expect(
      parseDriverPublicConfig({ ...env, EXPO_PUBLIC_API_URL: 'https://api.example.test' }).apiUrl,
    ).toBe('https://api.example.test');
  });
});
