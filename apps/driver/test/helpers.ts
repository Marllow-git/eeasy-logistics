import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SqlRunner } from '../src/platform/database';
import type { SecretKey, SecretStore } from '../src/platform/secure-store';

// Test doubles: the secure store in memory (one map shared by every JS context, as the keychain
// is), and SQLite through node:sqlite, the same engine and SQL as expo-sqlite (driver app §12.1).

export function memorySecrets(): SecretStore & { readonly values: Map<SecretKey, string> } {
  const values = new Map<SecretKey, string>();
  return {
    values,
    get: (key) => Promise.resolve(values.get(key) ?? null),
    set: (key, value) => {
      values.set(key, value);
      return Promise.resolve();
    },
    delete: (key) => {
      values.delete(key);
      return Promise.resolve();
    },
  };
}

type Param = string | number | null;

function runner(db: DatabaseSync): SqlRunner {
  return {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => ({
      changes: Number(db.prepare(sql).run(...(params as Param[])).changes),
    }),
    get: <T>(sql: string, params: readonly Param[]) =>
      db.prepare(sql).get(...(params as Param[])) as T | undefined,
  };
}

/** One SQLite file opened by several connections, like the app and its background task. */
export function sharedDatabase(): { connect(): SqlRunner; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'drv1-'));
  const file = join(dir, 'driver.db');
  const open: DatabaseSync[] = [];
  return {
    connect() {
      const db = new DatabaseSync(file);
      open.push(db);
      return runner(db);
    },
    close() {
      for (const db of open) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A clock the test moves; `sleep` advances it and yields to other promises. */
export function fakeClock(start = 1_700_000_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    sleep: async (milliseconds: number) => {
      now += milliseconds;
      await new Promise<void>((resolve) => setImmediate(() => resolve()));
    },
  };
}
