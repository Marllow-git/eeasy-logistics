import path from 'node:path';
import { expect, test } from '@playwright/test';

// PLAT-3 smoke spec until WEB-1's census harness: every placeholder route renders with the
// project's locale in <html lang> and the matching direction in <html dir> (web §5, §11).
// The locale is chosen through the el_locale preference cookie (apps/web/src/locale.ts).

const expectedDir = { ar: 'rtl', en: 'ltr' } as const;
type Locale = keyof typeof expectedDir;

const routes = [
  { name: 'merchant', path: '/' },
  { name: 'sign-in', path: '/sign-in' },
  { name: 'platform', path: '/platform' },
  { name: 'track', path: '/track/smoke-token' },
] as const;

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  await context.addCookies([
    { name: 'el_locale', value: testInfo.project.name, url: baseURL ?? 'http://127.0.0.1:3000' },
  ]);
});

for (const route of routes) {
  test(`${route.name} (${route.path}) sets lang and dir`, async ({ page }, testInfo) => {
    const locale = testInfo.project.name as Locale;
    expect(Object.keys(expectedDir), 'project name must be a locale').toContain(locale);

    const response = await page.goto(route.path);
    expect(response?.status(), `HTTP status of ${route.path}`).toBe(200);

    const html = page.locator('html');
    await expect(html).toHaveAttribute('lang', locale);
    await expect(html).toHaveAttribute('dir', expectedDir[locale]);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.screenshot({
      path: path.join(testInfo.project.outputDir, 'screenshots', locale, `${route.name}.png`),
      fullPage: true,
    });
  });
}
