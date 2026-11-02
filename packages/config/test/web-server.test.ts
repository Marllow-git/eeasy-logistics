import { describe, expect, it } from 'vitest';
import { parseCensusConfig } from '../src/census.ts';
import { ConfigError } from '../src/index.ts';
import { parseWebServerConfig } from '../src/web-server.ts';

function issuesOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof ConfigError) return error.issues.map((issue) => issue.variable);
    throw error;
  }
  return [];
}

describe('web server config (WEB-2 plan 2.13)', () => {
  it('keeps origins only and picks the public URL of the app', () => {
    const env = {
      NEXT_PUBLIC_APP_ENV: 'production',
      API_INTERNAL_URL: 'http://api.internal:3000/',
      PUBLIC_WEB_URL: 'https://app.example.test/path',
      PUBLIC_ADMIN_URL: 'https://admin.example.test',
    };
    const web = parseWebServerConfig('web', env);
    expect(web).toEqual({
      appEnv: 'production',
      apiInternalUrl: 'http://api.internal:3000',
      publicOrigin: 'https://app.example.test',
    });
    expect(Object.isFrozen(web)).toBe(true);
    expect(parseWebServerConfig('admin', env).publicOrigin).toBe('https://admin.example.test');
  });

  it('requires the API and the app origin in staging and production', () => {
    expect(issuesOf(() => parseWebServerConfig('web', { NEXT_PUBLIC_APP_ENV: 'staging' }))).toEqual(
      ['API_INTERNAL_URL', 'PUBLIC_WEB_URL'],
    );
    expect(
      issuesOf(() =>
        parseWebServerConfig('admin', {
          NEXT_PUBLIC_APP_ENV: 'production',
          API_INTERNAL_URL: 'http://api:3000',
          PUBLIC_WEB_URL: 'https://app.example.test',
        }),
      ),
    ).toEqual(['PUBLIC_ADMIN_URL']);
  });

  it('allows both to be absent locally, in ci and in a build without an environment name', () => {
    for (const appEnv of ['local', 'ci', undefined]) {
      expect(parseWebServerConfig('web', { NEXT_PUBLIC_APP_ENV: appEnv })).toEqual({
        appEnv,
        apiInternalUrl: undefined,
        publicOrigin: undefined,
      });
    }
  });

  it('refuses a malformed URL, a password in it and an unknown environment name', () => {
    expect(
      issuesOf(() =>
        parseWebServerConfig('web', {
          NEXT_PUBLIC_APP_ENV: 'prod',
          API_INTERNAL_URL: 'ftp://api',
          PUBLIC_WEB_URL: 'https://user:secret@app.example.test',
        }),
      ),
    ).toEqual(['API_INTERNAL_URL', 'PUBLIC_WEB_URL', 'NEXT_PUBLIC_APP_ENV']);
  });
});

describe('census config (WEB-2 plan 2.14)', () => {
  it('defaults to the dev ports and keeps origins only', () => {
    expect(parseCensusConfig({})).toEqual({
      mailpitUrl: 'http://127.0.0.1:8025',
      whatsappStubUrl: 'http://127.0.0.1:8080',
      signingKey: undefined,
    });
    expect(
      parseCensusConfig({
        CENSUS_MAILPIT_URL: 'http://127.0.0.1:49152/',
        CENSUS_WHATSAPP_STUB_URL: 'http://127.0.0.1:49153',
      }),
    ).toEqual({
      mailpitUrl: 'http://127.0.0.1:49152',
      whatsappStubUrl: 'http://127.0.0.1:49153',
      signingKey: undefined,
    });
    expect(issuesOf(() => parseCensusConfig({ CENSUS_AUTH_SIGNING_KEY: 'short' }))).toEqual([
      'CENSUS_AUTH_SIGNING_KEY',
    ]);
    expect(issuesOf(() => parseCensusConfig({ CENSUS_MAILPIT_URL: 'mailpit' }))).toEqual([
      'CENSUS_MAILPIT_URL',
    ]);
  });
});
