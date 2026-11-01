import { defineConfig } from 'vitest/config';

// Integration suite against the real stack (handbook 03): PostgreSQL, Redis and storage of the
// Compose `ci` profile in CI, the native stack locally. global-setup.ts migrates a scratch database
// (or, in ci without DATABASE_URL_ADMIN, the ci database) once per run, with ELX_RLS respected; CI
// runs the suite twice, the second time with ELX_RLS=on (data §4.5). test/schema/ holds the
// tenancy schema test (data §4.1).
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts', 'test/schema/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
