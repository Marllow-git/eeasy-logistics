// Shared helpers of the integration suite: the configuration pointed at this run's database
// (global-setup.ts) and one-connection clients per database role for direct SQL.
import type { Config, EnvRecord } from '@eeasy-logistics/config';
import { defineConfig } from '@eeasy-logistics/config';
import { readEnvironment } from '@eeasy-logistics/config/node';
import { withDatabase } from '@eeasy-logistics/db/admin';
import postgres from 'postgres';
import { inject } from 'vitest';

/** The database global-setup.ts migrated for this run (scratch `elx_test_*`, or the ci database). */
export function harnessDatabase(): string {
  return inject('elxDatabase');
}

/**
 * The web origins the marker tests send (PLAT-6 item G); `ci` reads no `.env`, so the suite sets
 * them itself unless the environment or the test names others.
 */
const webOrigins: EnvRecord = {
  PUBLIC_WEB_URL: 'http://localhost:3001',
  PUBLIC_ADMIN_URL: 'http://localhost:3002',
};

/**
 * The validated configuration with every database URL pointed at `database`: this run's database,
 * or a file's own scratch database (migrate.test.ts, CHORE-2).
 */
export function integrationConfig(
  overrides: EnvRecord = {},
  database: string = harnessDatabase(),
): Config {
  const config = defineConfig({ ...webOrigins, ...readEnvironment(), ...overrides });
  const point = (url: Config['db']['urls']['app']) =>
    url === undefined ? undefined : withDatabase(url, database);
  const { urls } = config.db;
  return {
    ...config,
    db: {
      ...config.db,
      urls: {
        owner: point(urls.owner),
        app: point(urls.app),
        platform: point(urls.platform),
        maintenance: point(urls.maintenance),
        admin: urls.admin,
      },
    },
  };
}

export type Role = 'owner' | 'app' | 'platform';

/** A one-connection client logged in as `elx_<role>` on this run's database. Call `end()`. */
export function connectAs(role: Role, config: Config = integrationConfig()): postgres.Sql {
  const url = config.db.urls[role];
  if (url === undefined) throw new Error(`No database URL for elx_${role}`);
  return postgres(url.reveal(), { max: 1, onnotice: () => undefined });
}

/** The SQLSTATE of a failed statement, or `none` when it succeeded. */
export async function sqlState(statement: PromiseLike<unknown>): Promise<string> {
  try {
    await statement;
    return 'none';
  } catch (error) {
    // Drizzle wraps the driver's error in `cause`; postgres.js errors carry `code` directly.
    const failure = error as { code?: string; cause?: { code?: string } };
    return failure.code ?? failure.cause?.code ?? 'unknown';
  }
}
