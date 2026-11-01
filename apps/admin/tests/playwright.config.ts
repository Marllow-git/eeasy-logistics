import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a running admin server (web §11): projects `ar` and `en`, one per locale.
 * The server must already listen on 127.0.0.1:3002, the admin port of `.env.example`
 * (`PUBLIC_ADMIN_URL`): locally `pnpm --filter admin build && pnpm --filter admin start`, in CI the
 * standalone server. The address is fixed rather than read from the environment, which only
 * packages/config may read (AGENTS.md). WEB-1 adds the census specs here.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3002',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'ar' }, { name: 'en' }],
});
