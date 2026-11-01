// The files of the `migrator` project of vitest.integration.config.ts (issue #71, CHORE-2): every
// integration file that runs the migrator, calls its SQL functions, or runs DDL outside a throwaway
// schema. They take locks on shared tables the other files' writes can deadlock with, so they run
// after every `parallel` file, one at a time. test/integration-projects.test.ts (unit, every mode)
// fails when a file that takes those locks is missing here or one listed here no longer does.
export const migratorFiles: readonly string[] = [
  'test/integration/migrate.test.ts',
  // Calls the partition functions only as roles or with a cutoff they refuse (no DDL runs); listed
  // because the guard matches the function names, not the outcome.
  'test/integration/audit-log-table.test.ts',
];
