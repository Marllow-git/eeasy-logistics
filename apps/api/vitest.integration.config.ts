import { defineConfig } from 'vitest/config';

// Integration suite against the real stack (handbook 03): PostgreSQL, Redis and storage of the
// Compose `ci` profile in CI, the native stack locally. global-setup.ts migrates a scratch database
// (or, in ci without DATABASE_URL_ADMIN, the ci database) once per run, with ELX_RLS respected; CI
// runs the suite twice, the second time with ELX_RLS=on (data §4.5). test/schema/ holds the
// tenancy schema test (data §4.1).
//
// Files run in parallel workers on that one database. The files that run the migrator (its
// advisory lock, `core_enable_tenant_rls()`, audit partition DDL) take table locks the other files'
// writes can deadlock with (issue #71, CHORE-2): they form the `migrator` project, which starts
// only after every `parallel` file has finished (`sequence.groupOrder`), one file at a time. With
// DATABASE_URL_ADMIN they also use a scratch database of their own (migrate.test.ts).
const migratorFiles = ['test/integration/migrate.test.ts'];

export default defineConfig({
  test: {
    // Root-level: runs once per run, and its `provide` reaches both projects (Vitest 5).
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'parallel',
          include: ['test/integration/**/*.test.ts', 'test/schema/**/*.test.ts'],
          exclude: migratorFiles,
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: 'migrator',
          include: migratorFiles,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
