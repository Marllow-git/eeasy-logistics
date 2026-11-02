import type { SqlRunner } from '../platform/database';

// The refresh lease (driver app §7.2, DRV-1 plan 2.4): one SQLite row that every JS context of the
// app (the foreground app, DRV-2's background task) takes before it presents the refresh token, so
// a token is never presented twice and the family is never revoked by our own race. The lease
// expires after 30 s, so a context that dies holding it blocks the others for at most that long.

export const leaseMilliseconds = 30_000;

export interface RefreshLease {
  /** Takes the lease for `holder` when it is free or expired; true when this holder has it. */
  tryAcquire(holder: string, now: number): boolean;
  release(holder: string): void;
}

export function migrateRefreshLease(db: SqlRunner): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS refresh_lease (' +
      'id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT NOT NULL, expires_at INTEGER NOT NULL)',
  );
}

export function sqliteRefreshLease(db: SqlRunner): RefreshLease {
  migrateRefreshLease(db);
  return {
    tryAcquire(holder, now) {
      // One statement, so two connections cannot both see the row free: the upsert changes the
      // row only when it is expired or already ours.
      const { changes } = db.run(
        'INSERT INTO refresh_lease (id, holder, expires_at) VALUES (1, ?, ?) ' +
          'ON CONFLICT (id) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at ' +
          'WHERE refresh_lease.expires_at <= ? OR refresh_lease.holder = excluded.holder',
        [holder, now + leaseMilliseconds, now],
      );
      return changes === 1;
    },
    release(holder) {
      db.run('DELETE FROM refresh_lease WHERE id = 1 AND holder = ?', [holder]);
    },
  };
}
