import {
  expect,
  expectAxeClean,
  expectLocale,
  expectNoArabicIndicDigits,
  expectNoHorizontalOverflow,
  expectNoRawKeys,
  expectNoSessionCookies,
  expectSecurityHeaders,
  message,
  recordTraffic,
  settle,
  test,
  type Locale,
} from './census/helpers';

// Census of the shell (WEB-1 plan 2.9): the placeholder routes of the three groups render inside
// the shared shell in the project's locale, pass the locale, accessibility and security checks,
// and match their screenshot baselines. Replaces PLAT-3's smoke-locale.spec.ts.

const routes = [
  { name: 'merchant', path: '/', group: 'merchant', title: ['nav', 'home'] },
  { name: 'sign-in', path: '/sign-in', group: 'auth', title: ['auth', 'sign_in.title'] },
  {
    name: 'track',
    path: '/track/census-token',
    group: 'recipient',
    title: ['recipient', 'track.title'],
  },
] as const;

for (const route of routes) {
  test(`${route.name} (${route.path}) in the project locale`, async ({ page, locale }) => {
    const traffic = recordTraffic(page);
    const response = await page.goto(route.path);
    expect(response?.status(), `HTTP status of ${route.path}`).toBe(200);
    await settle(page);

    expectSecurityHeaders(response);
    await expectLocale(page, locale);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      message(locale, route.title[0], route.title[1]),
    );
    await expect(page).toHaveTitle(message(locale, 'common', 'app.name'));
    await expectNoArabicIndicDigits(page);
    await expectNoRawKeys(page);
    if ((page.viewportSize()?.width ?? 0) <= 390) await expectNoHorizontalOverflow(page);
    await expectAxeClean(page);
    if (route.group === 'recipient') await expectNoSessionCookies(traffic);

    await expect(page).toHaveScreenshot(`${route.name}.png`, { fullPage: true });
  });
}

test('the locale switch changes the language and direction of the page', async ({
  page,
  locale,
}) => {
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  await page.goto('/sign-in');
  await page.getByRole('button', { name: message(locale, 'common', 'locale.label') }).click();
  await expectLocale(page, other);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    message(other, 'auth', 'sign_in.title'),
  );
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === 'el_locale')?.value).toBe(other);
});
