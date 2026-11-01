import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page, type Request, type Response } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Census helpers, a copy of apps/web/tests/census/helpers.ts (plan 2.9: a shared package waits for a
// third consumer) (web §11 "Locale assertions", "Accessibility", "Security assertions"; plan 2.9).
// Every census spec imports `test` from here, so the project's locale is set before each page.

export type Locale = 'ar' | 'en';

const directionOf = { ar: 'rtl', en: 'ltr' } as const;

export const test = base.extend<{ locale: Locale }>({
  // Playwright requires a destructuring pattern as a fixture's first parameter, even an empty one.
  // eslint-disable-next-line no-empty-pattern
  locale: async ({}, use, testInfo) => {
    const locale = testInfo.project.metadata.locale as unknown;
    if (locale !== 'ar' && locale !== 'en') throw new Error('census project needs metadata.locale');
    await use(locale);
  },
  // The el_locale preference cookie chooses the locale (web §5); there is no locale in the URL.
  context: async ({ context, baseURL, locale }, use) => {
    await context.addCookies([{ name: 'el_locale', value: locale, url: baseURL! }]);
    await use(context);
  },
});

export { expect };

/** The catalogue text a page must show: `platform` from this app, the rest from packages/i18n. */
export function message(locale: Locale, namespace: string, key: string): string {
  const root =
    namespace === 'platform'
      ? path.join(import.meta.dirname, '../../messages')
      : path.join(import.meta.dirname, '../../../../packages/i18n');
  let node: unknown = JSON.parse(
    readFileSync(path.join(root, locale, `${namespace}.json`), 'utf8'),
  );
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part];
  if (typeof node !== 'string') throw new Error(`no message ${locale}/${namespace}.${key}`);
  return node;
}

/** `<html lang dir>` match the locale (web §5). */
export async function expectLocale(page: Page, locale: Locale) {
  const html = page.locator('html');
  await expect(html).toHaveAttribute('lang', locale);
  await expect(html).toHaveAttribute('dir', directionOf[locale]);
}

/** ADR-0016: Western digits only, in Arabic too. */
export async function expectNoArabicIndicDigits(page: Page) {
  const text = await page.locator('body').innerText();
  expect(text.match(/[٠-٩۰-۹]+/g), 'Arabic-Indic digits on screen').toBeNull();
}

/** No `namespace.key` text on screen: a missing message never shows as its key (web §5). */
export async function expectNoRawKeys(page: Page) {
  const text = await page.locator('body').innerText();
  const keys = text.match(/\b(?:common|nav|auth|errors|recipient|platform)\.[a-z0-9_.]+/g);
  expect(keys, 'raw i18n keys on screen').toBeNull();
}

/** Nothing wider than the viewport at 390 px (web §11). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'document wider than the viewport').toBeLessThanOrEqual(clientWidth);
}

/** axe with WCAG 2.2 A and AA rules: no `serious` or `critical` violation (web §11). */
export async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(blocking, 'serious or critical axe violations').toEqual([]);
}

/**
 * The security headers this order owns (plan 2.9): `X-Content-Type-Options: nosniff`. CSP and the
 * frame headers per group join with WEB-2 (web §3.6).
 */
export function expectSecurityHeaders(response: Response | null) {
  expect(response, 'navigation response').not.toBeNull();
  expect(response!.headers()['x-content-type-options']).toBe('nosniff');
}

const sessionCookie = /\bel_(?:staff|platform)_(?:at|rt)\b|\bel_(?:staff|platform)_[a-z]+=/;

/** Records every request and response of `page` from now on, for the cookie assertion. */
export function recordTraffic(page: Page) {
  const traffic: { requests: Request[]; responses: Response[] } = { requests: [], responses: [] };
  page.on('request', (request) => traffic.requests.push(request));
  page.on('response', (response) => traffic.responses.push(response));
  return traffic;
}

/**
 * Recipient pages neither send nor receive a staff or platform session cookie (web §1.2, §11):
 * no request carries one and no response sets one.
 */
export async function expectNoSessionCookies(traffic: ReturnType<typeof recordTraffic>) {
  expect(traffic.requests.length, 'recorded requests').toBeGreaterThan(0);
  for (const request of traffic.requests) {
    const cookie = (await request.allHeaders())['cookie'] ?? '';
    expect(cookie, `cookie on ${request.url()}`).not.toMatch(sessionCookie);
  }
  for (const response of traffic.responses) {
    const setCookie = (await response.allHeaders())['set-cookie'] ?? '';
    expect(setCookie, `set-cookie on ${response.url()}`).not.toMatch(sessionCookie);
  }
}

/** Waits for the self-hosted fonts, so screenshots never catch the fallback face. */
export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
}

/**
 * The public values the census build carries (PLAT-14 plan 2.9; the CI census lanes and
 * `mem:suggested_commands` build with them): fake Sentry and PostHog targets on `.invalid` hosts,
 * so nothing leaves the machine. The census intercepts the browser's /monitoring and /ingest
 * requests and reads what they carry.
 */
export const censusBuild = {
  sentryDsn: 'https://census@sentry.invalid/1',
  posthogKey: 'phc_census',
} as const;

/** A phone number the census plants in URLs and errors; no report or event may carry it. */
export const plantedPhone = '+966501234567';

/** What must never leave in a report or an event: the planted phone (any spelling), cookies. */
export function expectNothingPersonal(payload: string, plantedToken?: string) {
  expect(payload, 'planted phone number').not.toMatch(/501234567/);
  expect(payload, 'cookie names').not.toMatch(/\bel_(?:locale|staff|platform)/);
  if (plantedToken !== undefined) expect(payload, 'recipient token').not.toContain(plantedToken);
}

/**
 * Holds the browser's Sentry envelopes posted to /monitoring (fulfilled here, never forwarded),
 * so a test can read what an error report would carry.
 */
export async function captureMonitoring(page: Page) {
  const envelopes: string[] = [];
  await page.route('**/monitoring', async (route) => {
    envelopes.push(route.request().postData() ?? '');
    await route.fulfill({ status: 200, body: '' });
  });
  return envelopes;
}
