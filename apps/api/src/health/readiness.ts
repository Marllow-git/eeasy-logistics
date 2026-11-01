import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import type { Config, Secret } from '@eeasy-logistics/config';
import type { AppDatabase } from '@eeasy-logistics/db';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';

// Readiness checks (PLAT-5 plan 2.7, platform §5): the app pool answers as elx_app, Redis answers
// PING, the storage bucket answers HeadBucket, and the database is at the migration version this
// build ships. A failing check is reported by name only, never with a detail.

export const checkNames = ['database', 'migrations', 'redis', 'storage'] as const;
export type CheckName = (typeof checkNames)[number];

export interface ReadinessCheck {
  readonly name: CheckName;
  /** Resolves when ready; rejects (or times out) otherwise. */
  run(signal: AbortSignal): Promise<void>;
}

/** `SELECT 1` on the elx_app pool. */
export function databaseCheck(db: AppDatabase | undefined): ReadinessCheck {
  return {
    name: 'database',
    run: async () => {
      if (db === undefined) throw new Error('not configured');
      await db.execute(sql`SELECT 1`);
    },
  };
}

/** `core_schema_meta.version` equals the last migration this build ships. */
export function migrationsCheck(
  db: AppDatabase | undefined,
  expectedVersion: string,
): ReadinessCheck {
  return {
    name: 'migrations',
    run: async () => {
      if (db === undefined) throw new Error('not configured');
      const rows = await db.execute<{ version: string }>(sql`SELECT version FROM core_schema_meta`);
      if (rows[0]?.version !== expectedVersion) throw new Error('schema version mismatch');
    },
  };
}

/** A fresh connection, `PING`, then disconnect: no client keeps reconnecting in the background. */
export function redisCheck(url: Secret | undefined): ReadinessCheck {
  return {
    name: 'redis',
    run: async (signal) => {
      if (url === undefined) throw new Error('not configured');
      const client = new Redis(url.reveal(), {
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 0,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      client.on('error', () => undefined);
      signal.addEventListener('abort', () => client.disconnect(), { once: true });
      try {
        await client.connect();
        if ((await client.ping()) !== 'PONG') throw new Error('unexpected reply');
      } finally {
        client.disconnect();
      }
    },
  };
}

/** `HeadBucket` on the configured bucket (path-style, as MinIO and most S3-compatible stores). */
export function storageCheck(storage: Config['storage']): ReadinessCheck {
  return {
    name: 'storage',
    run: async (signal) => {
      const { endpoint, bucket, accessKeyId, secretAccessKey } = storage;
      if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        throw new Error('not configured');
      }
      const client = new S3Client({
        endpoint,
        region: 'us-east-1',
        forcePathStyle: true,
        maxAttempts: 1,
        credentials: { accessKeyId, secretAccessKey: secretAccessKey.reveal() },
      });
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: signal });
      } finally {
        client.destroy();
      }
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
