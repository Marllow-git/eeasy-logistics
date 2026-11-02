import { describe, expect, it } from 'vitest';
import type { AppRole } from '../src/index.ts';
import { ConfigError, defineConfig } from '../src/index.ts';
import { productionEnv, valuesOf } from './fixtures.ts';

// INT-2 plan 2.7, 2.11 (integrations §2.2, §6.1, §9): the geocoder's sources in chain order. The
// fixture stub in local and ci; elsewhere the official National Address API, the Sayyar mirror
// and Hudhud, never the stub, with at least one source per lookup unless GEOCODER_DISABLED=true;
// production talks to each source's own host only.

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

const stagingEnv = { ...productionEnv, APP_ENV: 'staging' };
const noSource = (appEnv: string, lookups: string) =>
  `leaves no source for ${lookups} when APP_ENV=${appEnv} (spl short codes need NATIONAL_ADDRESS_API_KEY, hudhud needs HUDHUD_API_KEY), unless GEOCODER_DISABLED=true`;

describe('geocoder configuration (INT-2 plan 2.7, 2.11)', () => {
  it('resolves unset sources to the stub in local and ci and the chain elsewhere', () => {
    expect(defineConfig({ APP_ENV: 'local' }).geo).toMatchObject({
      geocoderSources: ['stub'],
      geocoderDisabled: false,
      hudhudApiUrl: 'https://b.hudhud.sa',
      splApiUrl: 'https://apina.address.gov.sa',
      splPoiUrl: 'https://beta-api.address.gov.sa',
      sayyarUrl: 'https://sayyar.com',
    });
    expect(defineConfig({ APP_ENV: 'ci' }).geo.geocoderSources).toEqual(['stub']);
    expect(defineConfig({ APP_ENV: 'staging' }).geo.geocoderSources).toEqual([
      'spl',
      'sayyar',
      'hudhud',
    ]);
  });

  it('reads the list in order, the pause, both keys as secrets and the base URLs', () => {
    const config = defineConfig({
      APP_ENV: 'local',
      GEOCODER_SOURCES: ' hudhud , sayyar',
      GEOCODER_DISABLED: 'true',
      NATIONAL_ADDRESS_API_KEY: 'fake-national-address-key-abcdef',
      HUDHUD_API_KEY: 'fake-hudhud-secret-key-abcdef',
      HUDHUD_API_URL: 'http://127.0.0.1:4011',
      SPL_API_URL: 'http://127.0.0.1:4012',
      SPL_POI_URL: 'http://127.0.0.1:4013',
      SAYYAR_URL: 'http://127.0.0.1:4014',
    });
    expect(config.geo.geocoderSources).toEqual(['hudhud', 'sayyar']);
    expect(config.geo.geocoderDisabled).toBe(true);
    expect(config.geo.nationalAddressApiKey?.reveal()).toBe('fake-national-address-key-abcdef');
    expect(config.geo.hudhudApiKey?.reveal()).toBe('fake-hudhud-secret-key-abcdef');
    expect(String(config.geo.nationalAddressApiKey)).toBe('[redacted]');
    expect(String(config.geo.hudhudApiKey)).toBe('[redacted]');
    expect(config.geo).toMatchObject({
      hudhudApiUrl: 'http://127.0.0.1:4011',
      splApiUrl: 'http://127.0.0.1:4012',
      splPoiUrl: 'http://127.0.0.1:4013',
      sayyarUrl: 'http://127.0.0.1:4014',
    });
  });

  // An empty value is unset, like every variable (the default list applies).
  it.each(['google', 'spl,spl', 'spl,,hudhud', 'SPL'])('refuses the list %j', (value) => {
    expect(problems({ APP_ENV: 'local', GEOCODER_SOURCES: value })).toHaveProperty(
      'GEOCODER_SOURCES',
    );
  });

  it('refuses a base URL that is not http(s)', () => {
    for (const variable of ['HUDHUD_API_URL', 'SPL_API_URL', 'SPL_POI_URL', 'SAYYAR_URL']) {
      expect(problems({ APP_ENV: 'local', [variable]: 'ftp://example.test' })).toHaveProperty(
        variable,
      );
    }
  });

  it.each(['api', 'worker'] as const)(
    'starts a deployed %s on the default chain without any key (Sayyar and the POI API)',
    (role) => {
      expect(problems(productionEnv, role)).toEqual({});
      expect(problems(stagingEnv, role)).toEqual({});
    },
  );

  it.each([
    ['staging', stagingEnv],
    ['production', productionEnv],
  ] as const)('refuses the stub in %s, for every role', (appEnv, env) => {
    const problem = `lists stub, which only local and ci run; ${appEnv} refuses it`;
    for (const role of ['api', 'worker'] as const) {
      expect(problems({ ...env, GEOCODER_SOURCES: 'stub' }, role)).toEqual({
        GEOCODER_SOURCES: problem,
      });
    }
    expect(
      problems({ ...env, GEOCODER_SOURCES: 'sayyar,stub', GEOCODER_DISABLED: 'true' }),
    ).toEqual({ GEOCODER_SOURCES: problem });
  });

  it('refuses the stub for the migrate role too', () => {
    expect(problems({ ...stagingEnv, GEOCODER_SOURCES: 'stub' }, 'migrate')).toEqual({
      GEOCODER_SOURCES: 'lists stub, which only local and ci run; staging refuses it',
    });
  });

  it.each([
    ['staging', stagingEnv],
    ['production', productionEnv],
  ] as const)('refuses a %s list that leaves a lookup with no source', (appEnv, env) => {
    // spl without its key answers the reverse lookup only.
    expect(problems({ ...env, GEOCODER_SOURCES: 'spl' })).toEqual({
      GEOCODER_SOURCES: noSource(appEnv, 'short code, text'),
    });
    expect(
      problems({ ...env, GEOCODER_SOURCES: 'spl', NATIONAL_ADDRESS_API_KEY: 'fake-na-key-0123' }),
    ).toEqual({ GEOCODER_SOURCES: noSource(appEnv, 'text') });
    // Sayyar has no reverse lookup.
    expect(problems({ ...env, GEOCODER_SOURCES: 'sayyar' }, 'worker')).toEqual({
      GEOCODER_SOURCES: noSource(appEnv, 'reverse'),
    });
    // Hudhud without its key answers nothing.
    expect(problems({ ...env, GEOCODER_SOURCES: 'hudhud' })).toEqual({
      GEOCODER_SOURCES: noSource(appEnv, 'short code, text, reverse'),
    });
  });

  it('starts with any list that covers every lookup', () => {
    expect(
      problems({ ...productionEnv, GEOCODER_SOURCES: 'hudhud', HUDHUD_API_KEY: 'fake-hh-0123' }),
    ).toEqual({});
    expect(problems({ ...productionEnv, GEOCODER_SOURCES: 'sayyar,spl' })).toEqual({});
  });

  it('accepts GEOCODER_DISABLED=true as the explicit decision', () => {
    const env = { ...productionEnv, GEOCODER_SOURCES: 'hudhud', GEOCODER_DISABLED: 'true' };
    expect(problems(env)).toEqual({});
    expect(defineConfig(env, { role: 'api' }).geo.geocoderDisabled).toBe(true);
  });

  it('asks no lookup coverage of the migrate and bootstrap roles', () => {
    expect(problems({ ...stagingEnv, GEOCODER_SOURCES: 'hudhud' }, 'migrate')).toEqual({});
  });

  it.each([
    ['HUDHUD_API_URL', 'https://b.hudhud.sa'],
    ['SPL_API_URL', 'https://apina.address.gov.sa'],
    ['SPL_POI_URL', 'https://beta-api.address.gov.sa'],
    ['SAYYAR_URL', 'https://sayyar.com'],
  ])("refuses a production %s other than the source's own host", (variable, url) => {
    expect(problems({ ...productionEnv, [variable]: 'https://geo.example.test' })).toEqual({
      [variable]: `must be ${url} in production`,
    });
    expect(problems({ ...productionEnv, [variable]: url })).toEqual({});
    // Staging may point at another server; local and ci too.
    expect(problems({ ...stagingEnv, [variable]: 'https://geo.example.test' })).toEqual({});
  });
});
