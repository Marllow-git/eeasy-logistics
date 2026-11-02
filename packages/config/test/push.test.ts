import { describe, expect, it } from 'vitest';
import type { AppRole } from '../src/index.ts';
import { ConfigError, defineConfig } from '../src/index.ts';
import { productionEnv, valuesOf } from './fixtures.ts';

// INT-4 plan 2.6 (integrations §2.5, §9): the push adapter is the recorder in local and ci; a
// deployed worker sends through Expo with an access token, or says PUSH_DISABLED=true.

function problems(env: Record<string, string>, role: AppRole = 'worker'): Record<string, string> {
  try {
    defineConfig(env, { role });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const value of valuesOf(env)) expect(error.message).not.toContain(value);
    return Object.fromEntries(error.issues.map((issue) => [issue.variable, issue.problem]));
  }
  return {};
}

function without(env: Record<string, string>, ...variables: string[]): Record<string, string> {
  const copy = { ...env };
  for (const variable of variables) delete copy[variable];
  return copy;
}

const stagingEnv = { ...productionEnv, APP_ENV: 'staging' };

describe('push configuration (INT-4 plan 2.6)', () => {
  it('resolves an unset provider to the recorder in local and ci only', () => {
    expect(defineConfig({ APP_ENV: 'local' }).push).toMatchObject({
      provider: 'stub',
      disabled: false,
      expoPushUrl: 'https://exp.host',
    });
    expect(defineConfig({ APP_ENV: 'ci' }).push.provider).toBe('stub');
    expect(defineConfig({ APP_ENV: 'staging' }).push.provider).toBeNull();
  });

  it('reads the provider, the pause, the token as a secret and the base URL', () => {
    const config = defineConfig({
      APP_ENV: 'local',
      PUSH_PROVIDER: 'expo',
      PUSH_DISABLED: 'true',
      EXPO_ACCESS_TOKEN: 'fake-expo-token-abcdef',
      EXPO_PUSH_URL: 'http://127.0.0.1:4010',
    });
    expect(config.push.provider).toBe('expo');
    expect(config.push.disabled).toBe(true);
    expect(config.push.expoAccessToken?.reveal()).toBe('fake-expo-token-abcdef');
    expect(String(config.push.expoAccessToken)).toBe('[redacted]');
    expect(config.push.expoPushUrl).toBe('http://127.0.0.1:4010');
  });

  it('refuses an unknown provider and a URL that is not http(s)', () => {
    expect(problems({ APP_ENV: 'local', PUSH_PROVIDER: 'fcm' })).toHaveProperty('PUSH_PROVIDER');
    expect(problems({ APP_ENV: 'local', EXPO_PUSH_URL: 'ftp://exp.host' })).toHaveProperty(
      'EXPO_PUSH_URL',
    );
  });

  it('starts a deployed worker with expo and its access token', () => {
    expect(problems(productionEnv)).toEqual({});
    expect(problems(stagingEnv)).toEqual({});
  });

  it.each([
    ['staging', stagingEnv],
    ['production', productionEnv],
  ] as const)('refuses a %s worker without a push decision', (appEnv, env) => {
    expect(problems(without(env, 'PUSH_PROVIDER'))).toEqual({
      PUSH_PROVIDER: `must be expo when APP_ENV=${appEnv}, unless PUSH_DISABLED=true`,
    });
  });

  it.each([
    ['staging', stagingEnv],
    ['production', productionEnv],
  ] as const)('refuses a %s worker on expo without the access token', (appEnv, env) => {
    expect(problems(without(env, 'EXPO_ACCESS_TOKEN'))).toEqual({
      EXPO_ACCESS_TOKEN: `is required with PUSH_PROVIDER=expo when APP_ENV=${appEnv} (enhanced push security)`,
    });
  });

  it('refuses the recorder in staging and production', () => {
    expect(problems({ ...stagingEnv, PUSH_PROVIDER: 'stub' })).toEqual({
      PUSH_PROVIDER: 'must be expo when APP_ENV=staging, unless PUSH_DISABLED=true',
    });
    expect(problems({ ...productionEnv, PUSH_PROVIDER: 'stub' })).toEqual({
      PUSH_PROVIDER: 'selects a stub adapter, which production refuses',
    });
    // The selector rule holds for every role, the api included, and with the pause on.
    expect(problems({ ...productionEnv, PUSH_PROVIDER: 'stub' }, 'api')).toEqual({
      PUSH_PROVIDER: 'selects a stub adapter, which production refuses',
    });
    expect(
      problems({ ...productionEnv, PUSH_PROVIDER: 'stub', PUSH_DISABLED: 'true' }),
    ).toHaveProperty('PUSH_PROVIDER');
  });

  it('accepts PUSH_DISABLED=true as the explicit decision', () => {
    const env = { ...without(productionEnv, 'PUSH_PROVIDER', 'EXPO_ACCESS_TOKEN') };
    expect(problems({ ...env, PUSH_DISABLED: 'true' })).toEqual({});
    const config = defineConfig({ ...env, PUSH_DISABLED: 'true' }, { role: 'worker' });
    expect(config.push).toMatchObject({ provider: null, disabled: true });
  });

  it('refuses a production base URL other than the Expo push service', () => {
    expect(problems({ ...productionEnv, EXPO_PUSH_URL: 'https://push.example.test' })).toEqual({
      EXPO_PUSH_URL: 'must be https://exp.host in production',
    });
    expect(problems({ ...productionEnv, EXPO_PUSH_URL: 'https://exp.host' })).toEqual({});
    // Staging may point at another server (a recorder in front of Expo); local and ci too.
    expect(problems({ ...stagingEnv, EXPO_PUSH_URL: 'https://push.example.test' })).toEqual({});
  });

  it('asks nothing of the api, migrate and bootstrap roles', () => {
    const env = without(productionEnv, 'PUSH_PROVIDER', 'EXPO_ACCESS_TOKEN');
    expect(problems(env, 'api')).toEqual({});
    expect(problems({ ...env, APP_ENV: 'staging' }, 'api')).toEqual({});
  });
});
