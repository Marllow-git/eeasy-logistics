import { describe, expect, it } from 'vitest';
import { ConfigError, defineConfig } from '../src/index.ts';
import { requiredInProduction } from '../src/refusals.ts';
import { productionEnv, valuesOf } from './fixtures.ts';

function problems(env: Record<string, string>): Record<string, string> {
  try {
    defineConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    for (const value of valuesOf(env)) expect(error.message).not.toContain(value);
    return Object.fromEntries(error.issues.map((issue) => [issue.variable, issue.problem]));
  }
  return {};
}

function without(...variables: string[]): Record<string, string> {
  const env = { ...productionEnv };
  for (const variable of variables) delete env[variable];
  return env;
}

describe('production refusals (plan 2.3)', () => {
  it('starts with a complete production environment', () => {
    expect(problems(productionEnv)).toEqual({});
  });

  it.each(requiredInProduction)('refuses production without %s', (variable) => {
    const found = problems(without(variable));
    expect(Object.keys(found)).toContain(variable);
  });

  it('refuses each missing database URL, Redis, storage, signing key and credentials keys at once', () => {
    const found = problems({
      APP_ENV: 'production',
      MESSAGING_PROVIDER: 'meta',
      MESSAGING_ACCESS_TOKEN: 'fake-token',
      MESSAGING_SENDER_ID: '1',
    });
    expect(Object.keys(found).sort()).toEqual([...requiredInProduction].sort());
    expect(found.REDIS_URL).toBe('is required when APP_ENV=production');
  });

  it('refuses the stub messaging provider in production', () => {
    const found = problems({ ...productionEnv, MESSAGING_PROVIDER: 'stub' });
    expect(found).toEqual({
      MESSAGING_PROVIDER: 'selects a stub adapter, which production refuses',
    });
  });

  it('refuses the stub provider even with MESSAGING_DISABLED=true', () => {
    const found = problems({
      ...productionEnv,
      MESSAGING_PROVIDER: 'stub',
      MESSAGING_DISABLED: 'true',
    });
    expect(Object.keys(found)).toEqual(['MESSAGING_PROVIDER']);
  });

  it('refuses production with no messaging provider unless MESSAGING_DISABLED=true', () => {
    const env = without('MESSAGING_PROVIDER', 'MESSAGING_ACCESS_TOKEN', 'MESSAGING_SENDER_ID');
    expect(Object.keys(problems(env))).toEqual(['MESSAGING_PROVIDER']);
    const config = defineConfig({ ...env, MESSAGING_DISABLED: 'true' });
    expect(config.messaging).toMatchObject({ provider: null, disabled: true });
  });

  it('refuses an active credentials key id that is not in the map', () => {
    const found = problems({ ...productionEnv, CREDENTIALS_ACTIVE_KEY_ID: 'k9' });
    expect(found).toEqual({
      CREDENTIALS_ACTIVE_KEY_ID: 'names a key id that is not in CREDENTIALS_KEYS',
    });
  });

  it.each(['local', 'ci', 'staging'])('does not apply production rules in %s', (appEnv) => {
    expect(problems({ APP_ENV: appEnv })).toEqual({});
    expect(problems({ APP_ENV: appEnv, MESSAGING_PROVIDER: 'stub' })).toEqual({});
  });

  it('resolves an unset provider to the stub in local and ci only', () => {
    expect(defineConfig({ APP_ENV: 'local' }).messaging.provider).toBe('stub');
    expect(defineConfig({ APP_ENV: 'ci' }).messaging.provider).toBe('stub');
    expect(defineConfig({ APP_ENV: 'staging' }).messaging.provider).toBeNull();
  });
});
