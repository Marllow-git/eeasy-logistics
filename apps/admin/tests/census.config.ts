import { defineConfig, devices } from '@playwright/test';

/**
 * The census (web §11, handbook 03): every screen of apps/admin in Arabic and English against a
 * running server, with the locale, accessibility and security assertions of tests/census/helpers.ts
 * and screenshot baselines. Projects: `ar` at 1440 px and 390 px (Arabic is the primary layout,
 * reviewed first), `en` at 1440 px.
 *
 * The server must already listen on 127.0.0.1:3002, the admin port of `.env.example`
 * (`PUBLIC_ADMIN_URL`): locally `pnpm --filter admin build && pnpm --filter admin start`, in CI the
 * standalone server. The address is fixed rather than read from the environment, which only
 * packages/config may read (AGENTS.md).
 *
 * A census spec joins `testMatch` in the PR that adds it (handbook 03), so an unlisted spec reports
 * "no tests found" instead of passing silently.
 */
export default defineConfig({
  testDir: '.',
  testMatch: ['census-shell.spec.ts', 'census-errors.spec.ts', 'census-analytics.spec.ts'],
  outputDir: '../test-results',
  forbidOnly: true,
  retries: 0,
  workers: 2,
  reporter: [['list']],
  // Baselines per project and platform: font rasterisation differs between macOS and Linux (CI).
  snapshotPathTemplate: '{testDir}/census/__screenshots__/{projectName}/{arg}-{platform}{ext}',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:3002',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'ar', metadata: { locale: 'ar' }, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'ar-390', metadata: { locale: 'ar' }, use: { viewport: { width: 390, height: 844 } } },
    { name: 'en', metadata: { locale: 'en' }, use: { viewport: { width: 1440, height: 900 } } },
  ],
});
