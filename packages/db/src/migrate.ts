// The migration runner (PLAT-5 plan 2.2, data §11.5, platform §5): applies the reviewed SQL in
// `apps/api/drizzle/` with Drizzle's migrator as `elx_owner`, under one advisory lock so two
// deploys (or two CI steps) cannot race, then records the version `/ready` compares against.
// Only the one-shot migration job (`api --role migrate`) and the test and seed tooling call it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Secret } from '@eeasy-logistics/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';

/** `pg_advisory_lock(hashtext('elx_migrate'))`: every migration run takes this session lock. */
export const migrationLockKey = 'elx_migrate';

export interface MigrateOptions {
  /** `config.db.urls.owner`: migrations run as `elx_owner` (ADR-0031). */
  readonly url: Secret | undefined;
  /** The folder holding the SQL files and `meta/_journal.json`. */
  readonly folder: string;
  /** Progress lines; never given a value from the configuration. */
  readonly log?: (line: string) => void;
}

export interface MigrateResult {
  /** Files applied by this run; 0 when the database was already current. */
  readonly applied: number;
  /** The tag of the last migration in the folder, now recorded in `core_schema_meta`. */
  readonly version: string;
}

interface JournalEntry {
  readonly idx: number;
  readonly when: number;
  readonly tag: string;
}

function readJournal(folder: string): JournalEntry[] {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries?: JournalEntry[];
  };
  return journal.entries ?? [];
}

/**
 * The schema version this build expects: the tag of the last migration in the folder. `/ready`
 * compares it with `core_schema_meta.version` (plan 2.7).
 */
export function expectedSchemaVersion(folder: string): string {
  const last = readJournal(folder).at(-1);
  if (last === undefined) throw new Error('The migrations folder has no migrations');
  return last.tag;
}

/**
 * Applies every pending migration and records the version. Idempotent: a second run applies
 * nothing and exits cleanly. A concurrent run waits on the advisory lock, then finds nothing to do.
 * Refuses to run when an applied migration file was edited or removed, or when a migration older
 * than the last applied one appears (Drizzle would skip it silently).
 */
export async function runMigrations(options: MigrateOptions): Promise<MigrateResult> {
  if (options.url === undefined) throw new Error('DATABASE_URL_OWNER is not configured');
  const log = options.log ?? (() => undefined);
  const journal = readJournal(options.folder);
  const files = readMigrationFiles({ migrationsFolder: options.folder });
  const version = expectedSchemaVersion(options.folder);

  // One connection: the advisory lock is per session and Drizzle's migrator needs `max: 1`.
  const client = postgres(options.url.reveal(), {
    max: 1,
    connect_timeout: 10,
    onnotice: () => undefined,
    connection: { application_name: 'elx-migrate' },
  });
  try {
    const [attempt] = await client<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(hashtext(${migrationLockKey})) AS locked`;
    if (attempt?.locked !== true) {
      log('Another migration run holds the lock; waiting for it to finish.');
      await client`SELECT pg_advisory_lock(hashtext(${migrationLockKey}))`;
    }

    const before = await appliedMigrations(client);
    checkHistory(before, files, journal);

    await migrate(drizzle({ client }), { migrationsFolder: options.folder });

    const after = await appliedMigrations(client);
    await client`UPDATE core_schema_meta SET version = ${version}, migrated_at = now()`;
    return { applied: after.length - before.length, version };
  } finally {
    // Closing the session releases the lock as well; the explicit unlock keeps the order clear.
    await client`SELECT pg_advisory_unlock_all()`.catch(() => undefined);
    await client.end({ timeout: 5 });
  }
}

interface AppliedMigration {
  readonly hash: string;
  readonly createdAt: number;
}

async function appliedMigrations(client: postgres.Sql): Promise<AppliedMigration[]> {
  const [exists] = await client<{ table: string | null }[]>`
    SELECT to_regclass('drizzle.__drizzle_migrations')::text AS table`;
  if (exists?.table === null || exists?.table === undefined) return [];
  const rows = await client<{ hash: string; created_at: string }[]>`
    SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`;
  return rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
}

function checkHistory(
  applied: readonly AppliedMigration[],
  files: readonly { folderMillis: number; hash: string }[],
  journal: readonly JournalEntry[],
): void {
  const tagOf = (when: number) => journal.find((entry) => entry.when === when)?.tag ?? `${when}`;
  for (const row of applied) {
    const file = files.find((candidate) => candidate.folderMillis === row.createdAt);
    if (file === undefined) {
      throw new Error(`Applied migration ${tagOf(row.createdAt)} is missing from the folder`);
    }
    if (file.hash !== row.hash) {
      throw new Error(
        `Applied migration ${tagOf(row.createdAt)} was edited after it ran; add a new migration instead`,
      );
    }
  }
  const last = applied.at(-1);
  if (last === undefined) return;
  for (const file of files) {
    const known = applied.some((row) => row.createdAt === file.folderMillis);
    if (!known && file.folderMillis <= last.createdAt) {
      throw new Error(
        `Migration ${tagOf(file.folderMillis)} is older than the last applied one; regenerate it`,
      );
    }
  }
}
