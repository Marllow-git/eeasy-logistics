import { defineConfig } from 'vitest/config';

// Integration suite against PostgreSQL, Redis and the stubs of the Compose `ci` profile
// (handbook 03). Empty until PLAT-5; CI runs it twice, the second time with ELX_RLS=on (data §4.5).
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
  },
});
