// Fake values for tests only. None of them is a real credential; tests still never print them.

/** A fake 32-byte key in base64, distinct per seed. */
export function fakeKey(seed: number): string {
  return Buffer.alloc(32, seed).toString('base64');
}

/** The smallest valid environment. */
export const minimalEnv = { APP_ENV: 'local' } as const;

/** A complete production environment with a real (non-stub) messaging provider. */
export const productionEnv: Record<string, string> = {
  APP_ENV: 'production',
  PORT: '8080',
  PUBLIC_WEB_URL: 'https://app.example.test',
  PUBLIC_API_URL: 'https://api.example.test',
  DATABASE_URL_OWNER: 'postgres://elx_owner:fake-owner-pw@db.internal:5432/elx',
  DATABASE_URL_APP: 'postgres://elx_app:fake-app-pw@db.internal:5432/elx',
  DATABASE_URL_PLATFORM: 'postgres://elx_platform:fake-platform-pw@db.internal:5432/elx',
  DATABASE_URL_MAINTENANCE: 'postgres://elx_maintenance:fake-maint-pw@db.internal:5432/elx',
  REDIS_URL: 'rediss://:fake-redis-pw@redis.internal:6379',
  STORAGE_ENDPOINT: 'https://s3.example.test',
  STORAGE_BUCKET: 'elx-proofs',
  STORAGE_ACCESS_KEY_ID: 'FAKEACCESSKEYID',
  STORAGE_SECRET_ACCESS_KEY: 'fake-storage-secret',
  AUTH_SIGNING_KEY_ID: 'auth-2026-10',
  AUTH_SIGNING_KEY: 'fake-signing-key-abcdefghijklmnopqrstuvwxyz-0123456789',
  MESSAGING_PROVIDER: 'meta',
  MESSAGING_ACCESS_TOKEN: 'fake-messaging-token',
  MESSAGING_SENDER_ID: '100000000000001',
  CREDENTIALS_KEYS: `k1:${fakeKey(1)},k2:${fakeKey(2)}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'k2',
};

/**
 * Every value in `env` long enough to be recognisable if it leaked into a message. `APP_ENV` is left
 * out: messages legitimately say `APP_ENV=production`.
 */
export function valuesOf(env: Record<string, string>): string[] {
  return Object.entries(env)
    .filter(([variable, value]) => variable !== 'APP_ENV' && value.length >= 8)
    .map(([, value]) => value);
}
