import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { Storage } from 'expo-sqlite/kv-store';

// The app's SQLite file (driver app §2). DRV-1 creates only the refresh lease table (plan 2.4); the
// outbox, the proof queue and the read model are DRV-2's. Secrets never go here.

/** The few synchronous calls the stores need; `node:sqlite` implements the same in tests. */
export interface SqlRunner {
  exec(sql: string): void;
  run(sql: string, params: readonly (string | number | null)[]): { changes: number };
  get<T>(sql: string, params: readonly (string | number | null)[]): T | undefined;
}

let database: SQLiteDatabase | undefined;

export function appDatabase(): SqlRunner {
  database ??= openDatabaseSync('driver.db');
  const db = database;
  return {
    exec: (sql) => db.execSync(sql),
    run: (sql, params) => ({ changes: db.runSync(sql, [...params]).changes }),
    get: <T>(sql: string, params: readonly (string | number | null)[]) =>
      db.getFirstSync<T>(sql, [...params]) ?? undefined,
  };
}

/** Plain app preferences (the language, the setup step seen): not secrets, not the secure store. */
export interface Preferences {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const preferences: Preferences = {
  get: (key) => Storage.getItemSync(key),
  set: (key, value) => Storage.setItemSync(key, value),
  remove: (key) => {
    Storage.removeItemSync(key);
  },
};
