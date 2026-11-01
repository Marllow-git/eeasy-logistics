import { fileURLToPath } from 'node:url';
import type { Config } from '@eeasy-logistics/config';
import { runMigrations } from '@eeasy-logistics/db/migrate';
import { Logger } from '@nestjs/common';

/**
 * `apps/api/drizzle/`: the reviewed SQL migrations and their journal. Resolved from this file, so
 * it is the same folder from `src/migrate/` and from the compiled `dist/migrate/`; the image must
 * ship the folder next to `dist/`.
 */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * The one-shot migration job, `api --role migrate` (data §11.5, platform §5): runs as `elx_owner`,
 * applies every pending migration under the advisory lock, records the version for `/ready`, and
 * returns. Nothing to do is a success.
 */
export async function runMigrateJob(config: Config): Promise<void> {
  const logger = new Logger('Migrate');
  const result = await runMigrations({
    url: config.db.urls.owner,
    folder: migrationsFolder,
    rls: config.db.rls,
    log: (line) => logger.log(line),
  });
  logger.log(
    result.applied === 0
      ? `Nothing to migrate; the database is at ${result.version}.`
      : `Applied ${result.applied} migration(s); the database is at ${result.version}.`,
  );
}
