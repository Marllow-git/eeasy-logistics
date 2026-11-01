import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config, Secret } from '@eeasy-logistics/config';
import type { AppDatabase } from '@eeasy-logistics/db';
import { verifyPoolRole } from '@eeasy-logistics/db';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';

// Readiness checks (PLAT-5 plan 2.7, platform §5): the app pool answers as a plain elx_app, Redis
// answers PING, the storage bucket answers HeadBucket, and the database is at or beyond the
// migration version this build ships. A failing check is reported by name only, never a detail.

export const checkNames = ['database', 'migrations', 'redis', 'storage'] as const;
export type CheckName = (typeof checkNames)[number];

export interface ReadinessCheck {
  readonly name: CheckName;
  /** Resolves when ready; rejects (or times out) otherwise. */
  run(signal: AbortSignal): Promise<void>;
  /** Releases a long-lived client, at shutdown. */
  close?(): Promise<void>;
}

/**
 * The app pool answers, as `elx_app`, and that role is neither superuser nor BYPASSRLS (review
 * M-6): a URL pointing at the wrong role fails readiness instead of silently bypassing RLS.
 */
export function databaseCheck(db: AppDatabase | undefined): ReadinessCheck {
  return {
    name: 'database',
    run: async () => {
      if (db === undefined) throw new Error('not configured');
      await verifyPoolRole(db, 'elx_app');
    },
  };
}

/** The numeric prefix of a migration tag (`0004_rls_switch` is 4); NaN for anything else. */
export function migrationNumber(tag: string): number {
  const match = /^(\d+)_/.exec(tag);
  return match?.[1] === undefined ? Number.NaN : Number(match[1]);
}

/**
 * `core_schema_meta.version` is at or beyond the last migration this build ships, by journal
 * order. Beyond counts as ready: during a rolling deploy the new image has migrated while old
 * pods still serve, which expand and contract makes safe (platform §5).
 */
export function migrationsCheck(
  db: AppDatabase | undefined,
  expectedVersion: string,
): ReadinessCheck {
  const expected = migrationNumber(expectedVersion);
  return {
    name: 'migrations',
    run: async () => {
      if (db === undefined) throw new Error('not configured');
      const rows = await db.execute<{ version: string }>(sql`SELECT version FROM core_schema_meta`);
      const actual = migrationNumber(rows[0]?.version ?? '');
      if (!(actual >= expected)) throw new Error('schema version behind the build');
    },
  };
}

/**
 * `PING` on one long-lived client (review L-1). It reconnects in the background; while it is down
 * a PING fails at once (no offline queue), so the check fails fast instead of waiting.
 */
export function redisCheck(url: Secret | undefined): ReadinessCheck {
  if (url === undefined) {
    return { name: 'redis', run: () => Promise.reject(new Error('not configured')) };
  }
  const client = new Redis(url.reveal(), {
    lazyConnect: true,
    connectTimeout: 2000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  });
  client.on('error', () => undefined);
  return {
    name: 'redis',
    run: async () => {
      if (client.status === 'wait') await client.connect();
      if ((await client.ping()) !== 'PONG') throw new Error('unexpected reply');
    },
    close: async () => {
      client.disconnect();
      await Promise.resolve();
    },
  };
}

/** `HeadBucket` on the configured bucket through one client (path-style, as MinIO). */
export function storageCheck(storage: Config['storage']): ReadinessCheck {
  const { endpoint, bucket, accessKeyId, secretAccessKey } = storage;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return { name: 'storage', run: () => Promise.reject(new Error('not configured')) };
  }
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId, secretAccessKey: secretAccessKey.reveal() },
  });
  return {
    name: 'storage',
    run: async (signal) => {
      await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
    },
    close: async () => {
      client.destroy();
      await Promise.resolve();
    },
  };
}

/** Runs every check in parallel, each bounded by `timeoutMs`; returns the names that failed. */
export async function failingChecks(
  checks: readonly ReadinessCheck[],
  timeoutMs: number,
): Promise<CheckName[]> {
  const results = await Promise.all(
    checks.map(async (check) => {
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('timed out'));
        }, timeoutMs);
      });
      try {
        await Promise.race([check.run(controller.signal), timeout]);
        return undefined;
      } catch {
        return check.name;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return results.filter((name): name is CheckName => name !== undefined);
}
