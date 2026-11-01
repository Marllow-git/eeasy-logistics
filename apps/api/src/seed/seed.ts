import type { Config } from '@eeasy-logistics/config';
import { recreateDatabase, withDatabase } from '@eeasy-logistics/db/admin';
import { runMigrations } from '@eeasy-logistics/db/migrate';
import { verifyPoolRole } from '@eeasy-logistics/db';
import { createPlatformPool, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { migrationsFolder } from '../migrate/run.js';
import { coreAccounts } from '../modules/kernel/schema/accounts.js';
import { accountFixtures } from './fixtures.js';

/** The template database `tools/stack.sh clone` copies (data §11.7). */
export const seedTemplateDatabase = 'elx_seed';

/**
 * Writes the fixtures through the `elx_platform` pool (accounts are platform rows; the
 * platform_access policy lets it write under RLS too). Idempotent: existing fixture rows are kept.
 * Returns the number of rows inserted.
 */
export async function seedFixtures(db: Config['db']): Promise<number> {
  const pool = createPlatformPool({ ...db, poolSize: { ...db.poolSize, platform: 1 } }, 'elx-seed');
  try {
    await verifyPoolRole(pool.db, 'elx_platform');
    return await withPlatformUnitOfWork(pool.db, async ({ tx }) => {
      const inserted = await tx
        .insert(coreAccounts)
        .values([...accountFixtures])
        .onConflictDoNothing({ target: coreAccounts.id })
        .returning({ id: coreAccounts.id });
      return inserted.length;
    });
  } finally {
    await pool.close();
  }
}

/**
 * `seed --template`: recreates `elx_seed` from template1 with the superuser, migrates it from zero
 * as elx_owner (ELX_RLS respected) and seeds it, so `tools/stack.sh clone` gets a ready database.
 */
export async function buildSeedTemplate(config: Config): Promise<string> {
  const { admin, owner, platform } = config.db.urls;
  if (admin === undefined) throw new Error('seed --template needs DATABASE_URL_ADMIN');
  if (owner === undefined || platform === undefined) {
    throw new Error('seed --template needs DATABASE_URL_OWNER and DATABASE_URL_PLATFORM');
  }
  await recreateDatabase(admin, seedTemplateDatabase);
  const { version } = await runMigrations({
    url: withDatabase(owner, seedTemplateDatabase),
    folder: migrationsFolder,
    rls: config.db.rls,
  });
  await seedFixtures({
    ...config.db,
    urls: { ...config.db.urls, platform: withDatabase(platform, seedTemplateDatabase) },
  });
  return version;
}
