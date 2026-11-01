import type { Config } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import { verifyPoolRole } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';

// The platform pool of the one-shot `--role bootstrap` command (PLAT-11 plan 2.12): opened as the
// plain `elx_platform` role (checked first, as the api and worker do), used once, closed.

export type BootstrapPool = Pool<PlatformDatabase>;

export async function withBootstrapPool<T>(
  config: Config,
  fn: (pool: BootstrapPool) => Promise<T>,
): Promise<T> {
  const pool = createPlatformPool(config.db, 'elx-bootstrap');
  try {
    await verifyPoolRole(pool.db, 'elx_platform');
    return await fn(pool);
  } finally {
    await pool.close();
  }
}
