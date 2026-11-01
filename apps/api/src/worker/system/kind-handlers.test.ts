import { defineConfig } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { describe, expect, it, vi } from 'vitest';
import { buildKindHandlers } from './kind-handlers.js';

// PLAT-8 items E and F: the handlers of this build per environment.

const pool = {} as Pool<PlatformDatabase>;
const kindsIn = (env: 'local' | 'ci' | 'staging') => {
  const warn = vi.fn();
  const config = { ...defineConfig({ APP_ENV: 'ci' }), app: { env } } as ReturnType<
    typeof defineConfig
  >;
  return { kinds: buildKindHandlers(config, pool, { warn }).map((h) => h.kind), warn };
};

describe('buildKindHandlers', () => {
  it('registers storage_lifecycle with the stub storage in local and ci', () => {
    expect(kindsIn('local').kinds).toContain('storage_lifecycle');
    expect(kindsIn('ci').kinds).toContain('storage_lifecycle');
  });

  it('leaves storage_lifecycle without a handler elsewhere, with a warning', () => {
    const { kinds, warn } = kindsIn('staging');
    expect(kinds).not.toContain('storage_lifecycle');
    expect(warn).toHaveBeenCalledWith(
      'storage_lifecycle has no handler: no object storage adapter before OPS-1',
    );
  });
});
