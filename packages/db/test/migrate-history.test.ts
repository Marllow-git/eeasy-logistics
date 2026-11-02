import type { MigrationMeta } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';
import type { AppliedMigration, JournalEntry } from '../src/migrate.ts';
import { checkHistory } from '../src/migrate.ts';

// The runner's history check (CHORE-3 plan 2.2, 2.5): an applied file edited or removed is still
// refused; an unapplied file older than the last applied one is now applied in journal order.
// The apply itself runs in the api integration suite (`migrate.test.ts`).
const entry = (idx: number, when: number, tag: string): JournalEntry => ({ idx, when, tag });
const file = (when: number, hash: string): MigrationMeta => ({
  sql: [`SELECT ${when}`],
  bps: true,
  folderMillis: when,
  hash,
});

// Two index-named files on main, then a timestamp-named one generated on a parallel branch before
// main's last file (older `when`) but merged after it, ordered by `when` in the journal (2.4).
const journal = [
  entry(0, 1000, '0000_core_schema_meta'),
  entry(1, 2000, '0001_foundation'),
  entry(2, 2500, '20261102090000_parallel_order'),
  entry(3, 3000, '20261102100000_main_order'),
];
const files = [file(1000, 'h0'), file(2000, 'h1'), file(2500, 'h2'), file(3000, 'h3')];

describe('checkHistory', () => {
  it('returns every file of a fresh database in journal order, none of them older', () => {
    expect(checkHistory([], files, journal).map(({ tag, older }) => ({ tag, older }))).toEqual([
      { tag: '0000_core_schema_meta', older: false },
      { tag: '0001_foundation', older: false },
      { tag: '20261102090000_parallel_order', older: false },
      { tag: '20261102100000_main_order', older: false },
    ]);
  });

  it('admits an unapplied file older than the last applied one and marks it older', () => {
    const applied: AppliedMigration[] = [
      { hash: 'h0', createdAt: 1000 },
      { hash: 'h1', createdAt: 2000 },
      { hash: 'h3', createdAt: 3000 },
    ];
    const pending = checkHistory(applied, files, journal);
    expect(
      pending.map(({ tag, older, file }) => ({ tag, older, when: file.folderMillis })),
    ).toEqual([{ tag: '20261102090000_parallel_order', older: true, when: 2500 }]);
  });

  it('returns nothing when every file is applied', () => {
    const applied = files.map((f) => ({ hash: f.hash, createdAt: f.folderMillis }));
    expect(checkHistory(applied, files, journal)).toEqual([]);
  });

  it('still refuses an applied file that was edited', () => {
    const applied = [
      { hash: 'h0', createdAt: 1000 },
      { hash: 'edited', createdAt: 2000 },
    ];
    expect(() => checkHistory(applied, files, journal)).toThrow(
      'Applied migration 0001_foundation was edited after it ran; add a new migration instead',
    );
  });

  it('still refuses an applied file that was removed', () => {
    const applied = [
      { hash: 'h0', createdAt: 1000 },
      { hash: 'gone', createdAt: 1500 },
    ];
    expect(() => checkHistory(applied, files, journal)).toThrow(
      'Applied migration 1500 is missing from the folder',
    );
  });

  it('refuses two journal entries with the same when (applied rows are keyed by it)', () => {
    const twins = [...journal, entry(4, 2500, '20261102110000_twin')];
    expect(() => checkHistory([], [...files, file(2500, 'h4')], twins)).toThrow(
      'Migration 20261102110000_twin has the same journal "when" as an earlier entry',
    );
  });
});
