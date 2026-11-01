import { defineConfig } from 'vitest/config';

// Unit and in-process HTTP tests, no database. Tests that need the stack (PostgreSQL, Redis,
// storage) live in test/integration/ and test/schema/ and run through vitest.integration.config.ts
// (CI lanes api-test and api-test-rls).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/integration/**', 'test/schema/**'],
  },
});
