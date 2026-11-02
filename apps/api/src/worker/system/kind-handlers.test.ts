import { defineConfig } from '@eeasy-logistics/config';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { describe, expect, it, vi } from 'vitest';
import { buildKindHandlers } from './kind-handlers.js';

// PLAT-8 items E and F: the handlers of this build per environment.

const pool = { db: {} } as Pool<PlatformDatabase>;
const app = { db: {} } as Pool<AppDatabase>;
const kindsIn = (env: 'local' | 'ci' | 'staging', withApp = true) => {
  const warn = vi.fn();
  const config = { ...defineConfig({ APP_ENV: 'ci' }), app: { env } } as ReturnType<
    typeof defineConfig
  >;
  return {
    kinds: buildKindHandlers(config, pool, withApp ? app : undefined, { warn }).map((h) => h.kind),
    warn,
  };
};

describe('buildKindHandlers', () => {
  it('registers internal_event, storage_lifecycle (stub storage) and push (recorder) in local and ci', () => {
    expect(kindsIn('local').kinds).toEqual(['internal_event', 'storage_lifecycle', 'push']);
    expect(kindsIn('ci').kinds).toEqual(['internal_event', 'storage_lifecycle', 'push']);
  });

  it('leaves internal_event without a handler without the elx_app pool (adversary M-3)', () => {
    const { kinds, warn } = kindsIn('local', false);
    expect(kinds).toEqual(['storage_lifecycle', 'push']);
    expect(warn).toHaveBeenCalledWith(
      'internal_event has no handler: DATABASE_URL_APP not configured',
    );
  });

  it('leaves storage_lifecycle without a handler elsewhere, with a warning', () => {
    const { kinds, warn } = kindsIn('staging');
    expect(kinds).toEqual(['internal_event']);
    expect(warn).toHaveBeenCalledWith(
      'storage_lifecycle has no handler: no object storage adapter before OPS-1',
    );
    // INT-4 plan 2.8: the recorder never runs outside local and ci.
    expect(warn).toHaveBeenCalledWith(
      'push has no handler: the push recorder does not run in staging',
    );
  });

  it('registers push with the Expo adapter, and none with PUSH_DISABLED=true (INT-4 plan 2.8)', () => {
    const warn = vi.fn();
    const expo = defineConfig({ APP_ENV: 'ci', PUSH_PROVIDER: 'expo', EXPO_ACCESS_TOKEN: 'fake' });
    expect(buildKindHandlers(expo, pool, app, { warn }).map((h) => h.kind)).toContain('push');
    const disabled = defineConfig({ APP_ENV: 'ci', PUSH_DISABLED: 'true' });
    expect(buildKindHandlers(disabled, pool, app, { warn }).map((h) => h.kind)).not.toContain(
      'push',
    );
    expect(warn).toHaveBeenCalledWith('push has no handler: PUSH_DISABLED=true');
  });
});
