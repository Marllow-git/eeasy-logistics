import { defineConfig, devices } from '@playwright/test';

/**
 * The census (web §11, handbook 03): every screen of apps/web in Arabic and English against a
 * running server, with the locale, accessibility and security assertions of tests/census/helpers.ts
 * and screenshot baselines. Projects: `ar` at 1440 px and 390 px (Arabic is the primary layout,
 * reviewed first), `en` at 1440 px.
 *
 * The server must already listen on port 3001 and be reached as `http://localhost:3001`, the
 * `PUBLIC_WEB_URL` of `.env.example`: the API accepts a staff write only with that exact Origin
 * (ADR-0032), and the browser keeps the API's `Secure` session cookies on localhost (WEB-2). Locally
 * `pnpm --filter web build && pnpm --filter web start -p 3001`, in CI the standalone server; with the
 * API, its worker, Mailpit and the WhatsApp stub of the stack, and `seed:census` run first
 * (tests/census/session.ts). The address is fixed rather than read from the environment, which only
 * packages/config may read (AGENTS.md).
 *
 * A census spec joins `testMatch` in the PR that adds it (handbook 03), so an unlisted spec reports
 * "no tests found" instead of passing silently.
 */
export default defineConfig({
  testDir: '.',
  testMatch: [
    'census-shell.spec.ts',
    'census-errors.spec.ts',
    'census-analytics.spec.ts',
    'census-auth.spec.ts',
  ],
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
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'ar', metadata: { locale: 'ar' }, use: { viewport: { width: 1440, height: 900 } } },
    { name: 'ar-390', metadata: { locale: 'ar' }, use: { viewport: { width: 390, height: 844 } } },
    { name: 'en', metadata: { locale: 'en' }, use: { viewport: { width: 1440, height: 900 } } },
  ],
});
