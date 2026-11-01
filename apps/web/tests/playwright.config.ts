import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against a running web server (web §11): projects `ar` and `en`, one per locale.
 * Start the server first (`pnpm --filter web build && pnpm --filter web start`, or the standalone
 * server in CI) and pass its address in PLAYWRIGHT_BASE_URL. WEB-1 adds the census specs here.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'ar' }, { name: 'en' }],
});
