import type { Page } from '@playwright/test';
import {
  expect,
  expectAxeClean,
  expectLocale,
  expectNoArabicIndicDigits,
  expectNoHorizontalOverflow,
  expectNoRawKeys,
  expectSecurityHeaders,
  message,
  settle,
  test,
  type Locale,
} from './census/helpers';
import { censusSettingsAccounts, projectOf, signIn } from './census/session';

// Census of the merchant settings (WEB-3 plan 2.11, leg 1): the home page and the account
// settings against the real API, with the seeded owner, viewer and site-scoped member of the
// project's own account (apps/api/src/seed/census.ts). Run `seed:census` before each run: the
// writes below change that account's settings, and the screenshots expect the seeded state.

const project = () => projectOf(test.info().project.name);
const ownerName = 'عبدالله الشمري';

const t = (locale: Locale, key: string, values: Record<string, string> = {}) =>
  Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, value),
    message(locale, 'settings', key),
  );

/** The locale, digit, key, overflow and accessibility checks, then the screenshot. */
async function expectScreen(page: Page, locale: Locale, name: string, title: string) {
  await settle(page);
  await expectLocale(page, locale);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expectNoArabicIndicDigits(page);
  await expectNoRawKeys(page);
  if ((page.viewportSize()?.width ?? 0) <= 390) await expectNoHorizontalOverflow(page);
  await expectAxeClean(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

/** A settings section: the card is a region named by its title. */
const section = (page: Page, locale: Locale, key: string) =>
  page.getByRole('region', { name: t(locale, `account.${key}.title`), exact: true });

test('home greets the owner, shows the empty modules, the settings card and the limits', async ({
  page,
  locale,
}) => {
  await signIn(page, 'settings', project());
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expectSecurityHeaders(response, 'merchant');
  await expect(page.getByText(t(locale, 'home.greeting', { name: ownerName }))).toBeVisible();
  await expect(
    page.getByText(t(locale, 'home.account_line', { account: censusSettingsAccounts[project()] })),
  ).toBeVisible();
  await expect(page.getByText(t(locale, 'home.modules_empty'))).toBeVisible();
  await expect(
    page.getByRole('link', { name: t(locale, 'home.settings_card_open') }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: t(locale, 'home.facts_title') })).toBeVisible();
  // The sidebar's settings group (from the route manifest); at 390 px it sits in the closed drawer.
  if ((page.viewportSize()?.width ?? 0) > 390) {
    await expect(
      page.getByRole('link', { name: message(locale, 'nav', 'settings_account') }),
    ).toBeVisible();
  }
  await expectScreen(page, locale, 'home', message(locale, 'nav', 'home'));
});

test('a site-scoped member has no settings and gets the no-access page with 403', async ({
  page,
  locale,
}) => {
  await signIn(page, 'sitestaff', project());
  await page.goto('/');
  await expect(page.getByText(t(locale, 'home.modules_empty'))).toBeVisible();
  await expect(page.getByRole('link', { name: t(locale, 'home.settings_card_open') })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('link', { name: message(locale, 'nav', 'settings_account') }),
  ).toHaveCount(0);
  const response = await page.goto('/settings/account');
  expect(response?.status()).toBe(403);
  expectSecurityHeaders(response, 'merchant');
  await expectScreen(page, locale, 'no-access', message(locale, 'common', 'no_access.title'));
});

test('account settings render filled for the owner, each section with its own save', async ({
  page,
  locale,
}) => {
  await signIn(page, 'settings', project());
  const response = await page.goto('/settings/account');
  expect(response?.status()).toBe(200);
  expectSecurityHeaders(response, 'merchant');
  const intake = section(page, locale, 'intake');
  await expect(intake.getByLabel(t(locale, 'account.intake.max_attempts'))).toHaveValue('3');
  // Save stays disabled until a field changes (design references, Klaviyo and Meetup).
  await expect(
    intake.getByRole('button', { name: message(locale, 'common', 'form.save') }),
  ).toBeDisabled();
  await expect(
    page.getByRole('checkbox', { name: t(locale, 'account.cod.kinds.card') }),
  ).toBeDisabled();
  await expectScreen(page, locale, 'account-settings', message(locale, 'nav', 'settings_account'));
});

test('the viewer reads the settings with every field disabled and no save control', async ({
  page,
  locale,
}) => {
  await signIn(page, 'viewer', project());
  const response = await page.goto('/settings/account');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('note')).toHaveText(t(locale, 'account.read_only'));
  await expect(
    page.getByRole('button', { name: message(locale, 'common', 'form.save') }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: t(locale, 'account.reason_codes.add') }),
  ).toHaveCount(0);
  await expect(
    section(page, locale, 'intake').getByLabel(t(locale, 'account.intake.max_attempts')),
  ).toBeDisabled();
  await expectScreen(
    page,
    locale,
    'account-settings-viewer',
    message(locale, 'nav', 'settings_account'),
  );
});

test('the owner changes the intake rule and max attempts; both persist after a reload', async ({
  page,
  locale,
}) => {
  await signIn(page, 'settings', project());
  await page.goto('/settings/account');
  const intake = section(page, locale, 'intake');
  await intake.getByRole('radio', { name: t(locale, 'account.intake.auto_accept') }).click();
  await intake.getByLabel(t(locale, 'account.intake.max_attempts')).fill('5');
  await intake.getByRole('button', { name: message(locale, 'common', 'form.save') }).click();
  await expect(intake.getByRole('status')).toHaveText(message(locale, 'common', 'form.saved'));
  await page.reload();
  const reloaded = section(page, locale, 'intake');
  await expect(
    reloaded.getByRole('radio', { name: t(locale, 'account.intake.auto_accept') }),
  ).toBeChecked();
  await expect(reloaded.getByLabel(t(locale, 'account.intake.max_attempts'))).toHaveValue('5');
});

test('reason codes: a bad code shows its field error; a good one in both languages persists', async ({
  page,
  locale,
}) => {
  await signIn(page, 'settings', project());
  await page.goto('/settings/account');
  const reasons = section(page, locale, 'reason_codes');
  await reasons.getByRole('button', { name: t(locale, 'account.reason_codes.add') }).click();
  const code = reasons.getByLabel(t(locale, 'account.reason_codes.code'), { exact: true });
  await code.fill('Bad Code');
  await code.blur();
  await expect(reasons.getByText(message(locale, 'errors', 'fields.invalid'))).toBeVisible();
  await expect(code).toHaveAttribute('aria-invalid', 'true');
  await code.fill('census_absent');
  await reasons.getByLabel(message(locale, 'common', 'locale.ar')).fill('المستلم غائب');
  await reasons.getByLabel(message(locale, 'common', 'locale.en')).fill('Recipient away');
  await reasons.getByRole('button', { name: message(locale, 'common', 'form.save') }).click();
  await expect(reasons.getByRole('status')).toHaveText(message(locale, 'common', 'form.saved'));
  await page.reload();
  const reloaded = section(page, locale, 'reason_codes');
  await expect(
    reloaded.getByLabel(t(locale, 'account.reason_codes.code'), { exact: true }),
  ).toHaveValue('census_absent');
  await expect(reloaded.getByLabel(message(locale, 'common', 'locale.ar'))).toHaveValue(
    'المستلم غائب',
  );
});

test('keyboard: the settings sections are reachable and a save works from the keyboard', async ({
  page,
  locale,
}) => {
  await signIn(page, 'settings', project());
  await page.goto('/settings/account');
  const drivers = section(page, locale, 'drivers');
  const hours = drivers.getByLabel(t(locale, 'account.drivers.offline_window'));
  await hours.focus();
  await hours.fill('24');
  await page.keyboard.press('Tab');
  const save = drivers.getByRole('button', { name: message(locale, 'common', 'form.save') });
  await expect(save).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(drivers.getByRole('status')).toHaveText(message(locale, 'common', 'form.saved'));
});
