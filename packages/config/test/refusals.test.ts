import { describe, expect, it } from 'vitest';
import type { AppRole } from '../src/index.ts';
import { ConfigError, defineConfig } from '../src/index.ts';
import { requiredInProduction } from '../src/refusals.ts';
import { engineEnv, productionEnv, productionOwnerUrl, valuesOf } from './fixtures.ts';

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

function without(...variables: string[]): Record<string, string> {
  const env = { ...productionEnv };
  for (const variable of variables) delete env[variable];
  return env;
}

describe('database credentials per role (review H-2, data §4.4, ADR-0031)', () => {
  it.each(['api', 'worker'] as const)(
    '%s needs the app and platform URLs and never the owner, maintenance or admin URL',
    (role) => {
      expect(requiredInProduction(role)).toEqual(
        expect.arrayContaining(['DATABASE_URL_APP', 'DATABASE_URL_PLATFORM']),
      );
      expect(requiredInProduction(role)).not.toContain('DATABASE_URL_OWNER');
      expect(requiredInProduction(role)).not.toContain('DATABASE_URL_MAINTENANCE');
      expect(problems(productionEnv, role)).toEqual({});
      for (const appEnv of ['staging', 'production']) {
        const env = { ...productionEnv, APP_ENV: appEnv };
        expect(
          problems(
            {
              ...env,
              DATABASE_URL_OWNER: productionOwnerUrl,
              DATABASE_URL_MAINTENANCE: 'postgres://elx_maintenance:fake-m@db.internal:5432/elx',
              DATABASE_URL_ADMIN: 'postgres://postgres:fake-admin@db.internal:5432/postgres',
            },
            role,
          ),
        ).toEqual({
          DATABASE_URL_OWNER: `must not be given to the ${role} role in ${appEnv} (ADR-0031)`,
          DATABASE_URL_MAINTENANCE: `must not be given to the ${role} role in ${appEnv} (ADR-0031)`,
          DATABASE_URL_ADMIN: `is for local and ci tooling only; ${appEnv} refuses it`,
        });
      }
    },
  );

  it('migrate needs only the owner URL in production', () => {
    expect(requiredInProduction('migrate')).toEqual(['DATABASE_URL_OWNER']);
    expect(problems({ APP_ENV: 'production' }, 'migrate')).toEqual({
      DATABASE_URL_OWNER: 'is required when APP_ENV=production',
    });
    expect(
      problems({ APP_ENV: 'production', DATABASE_URL_OWNER: productionOwnerUrl }, 'migrate'),
    ).toEqual({});
  });

  it('bootstrap needs the platform URL and the console URL, never the owner URL (PLAT-11 2.12)', () => {
    expect(requiredInProduction('bootstrap')).toEqual(['DATABASE_URL_PLATFORM', 'PUBLIC_ADMIN_URL']);
    expect(problems({ APP_ENV: 'production' }, 'bootstrap')).toEqual({
      DATABASE_URL_PLATFORM: 'is required when APP_ENV=production',
      PUBLIC_ADMIN_URL: 'is required when APP_ENV=production',
    });
    const { DATABASE_URL_PLATFORM, PUBLIC_ADMIN_URL } = productionEnv;
    const minimal = { APP_ENV: 'production', DATABASE_URL_PLATFORM, PUBLIC_ADMIN_URL } as Record<
      string,
      string
    >;
    expect(problems(minimal, 'bootstrap')).toEqual({});
    expect(
      problems({ ...minimal, DATABASE_URL_OWNER: productionOwnerUrl }, 'bootstrap'),
    ).toHaveProperty('DATABASE_URL_OWNER');
  });

  it('migrate may not hold the admin URL in staging or production', () => {
    const found = problems(
      {
        APP_ENV: 'staging',
        DATABASE_URL_OWNER: productionOwnerUrl,
        DATABASE_URL_ADMIN: 'postgres://postgres:fake-admin@db.internal:5432/postgres',
      },
      'migrate',
    );
    expect(found).toEqual({
      DATABASE_URL_ADMIN: 'is for local and ci tooling only; staging refuses it',
    });
  });

  it('local and ci accept every database URL for every role', () => {
    for (const appEnv of ['local', 'ci']) {
      for (const role of ['api', 'worker', 'migrate'] as const) {
        expect(
          problems(
            {
              APP_ENV: appEnv,
              DATABASE_URL_OWNER: productionOwnerUrl,
              DATABASE_URL_MAINTENANCE: 'postgres://elx_maintenance:fake-m@127.0.0.1:5432/elx',
            },
            role,
          ),
        ).toEqual({});
      }
    }
  });
});

describe('production refusals (plan 2.3)', () => {
  it('starts with a complete production environment', () => {
    expect(problems(productionEnv)).toEqual({});
  });

  it.each(requiredInProduction('api'))('refuses production without %s', (variable) => {
    const found = problems(without(variable));
    expect(Object.keys(found)).toContain(variable);
  });

  it('refuses each missing database URL, Redis, storage, signing key and credentials keys at once', () => {
    const found = problems({ APP_ENV: 'production', MESSAGING_PROVIDER: 'engine', ...engineEnv() });
    expect(Object.keys(found).sort()).toEqual(
      [...requiredInProduction('api'), 'ELX_RELEASE'].sort(),
    );
    expect(found.REDIS_URL).toBe('is required when APP_ENV=production');
  });

  it('refuses a production api or worker without its image release, or with dev (PLAT-14 A-8)', () => {
    const release = 'must name the image release (sha-<commit>) when APP_ENV=production';
    expect(problems(without('ELX_RELEASE'))).toEqual({ ELX_RELEASE: release });
    expect(problems({ ...productionEnv, ELX_RELEASE: 'dev' })).toEqual({ ELX_RELEASE: release });
    expect(() =>
      defineConfig({ ...productionEnv, ELX_RELEASE: 'dev' }, { role: 'worker' }),
    ).toThrow('ELX_RELEASE');
    expect(defineConfig(productionEnv).observability.release).toBe(productionEnv.ELX_RELEASE);
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
    const env = without('MESSAGING_PROVIDER', ...Object.keys(engineEnv()));
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

  it('requires TLS for Redis and https for the storage and OTLP endpoints', () => {
    const found = problems({
      ...productionEnv,
      REDIS_URL: 'redis://:fake-redis-pw@redis.internal:6379',
      STORAGE_ENDPOINT: 'http://s3.example.test',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel.internal:4318',
    });
    expect(found).toEqual({
      REDIS_URL: 'must use rediss:// in production',
      STORAGE_ENDPOINT: 'must use https:// in production',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'must use https:// in production',
    });
  });

  it('allows plain redis:// and http:// outside production (Compose services)', () => {
    const env = {
      REDIS_URL: 'redis://localhost:6379',
      STORAGE_ENDPOINT: 'http://localhost:9000',
      STORAGE_BUCKET: 'b',
      STORAGE_ACCESS_KEY_ID: 'id',
      STORAGE_SECRET_ACCESS_KEY: 'fake-storage-secret',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
    };
    for (const appEnv of ['local', 'ci', 'staging']) {
      expect(problems({ APP_ENV: appEnv, ...env })).toEqual({});
    }
  });

  it.each(['local', 'ci', 'staging'])('does not apply production rules in %s', (appEnv) => {
    expect(problems({ APP_ENV: appEnv })).toEqual({});
    expect(problems({ APP_ENV: appEnv, MESSAGING_PROVIDER: 'stub' })).toEqual({});
  });

  it.each(['staging', 'production'])('refuses the superuser DATABASE_URL_ADMIN in %s', (appEnv) => {
    const admin = 'postgres://postgres:fake-admin-pw@db.internal:5432/postgres';
    const env = appEnv === 'production' ? productionEnv : { APP_ENV: appEnv };
    const found = problems({ ...env, DATABASE_URL_ADMIN: admin });
    expect(found).toEqual({
      DATABASE_URL_ADMIN: `is for local and ci tooling only; ${appEnv} refuses it`,
    });
  });

  it.each(['local', 'ci'])('accepts DATABASE_URL_ADMIN in %s (PLAT-5 tooling)', (appEnv) => {
    const admin = 'postgres://postgres:fake-admin-pw@127.0.0.1:5432/postgres';
    const config = defineConfig({ APP_ENV: appEnv, DATABASE_URL_ADMIN: admin });
    expect(config.db.urls.admin?.reveal()).toBe(admin);
    expect(String(config.db.urls.admin)).toBe('[redacted]');
  });

  it('resolves an unset provider to the stub in local and ci only', () => {
    expect(defineConfig({ APP_ENV: 'local' }).messaging.provider).toBe('stub');
    expect(defineConfig({ APP_ENV: 'ci' }).messaging.provider).toBe('stub');
    expect(defineConfig({ APP_ENV: 'staging' }).messaging.provider).toBeNull();
  });
});
