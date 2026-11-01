import { defineConfig } from 'vitest/config';

// Unit and in-process HTTP tests. Tests that need the Compose stack live in test/integration/
// and run through vitest.integration.config.ts (CI lanes api-test and api-test-rls).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/integration/**'],
  },
});
