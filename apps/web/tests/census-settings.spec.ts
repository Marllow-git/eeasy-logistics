import type { Locator, Page } from '@playwright/test';
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
import {
  censusEmail,
  censusPassword,
  censusPendingName,
  censusSettingsAccounts,
  expiredCopy,
  mailedLink,
  origin,
  projectOf,
  replaceCookie,
  sessionCookie,
  signIn,
} from './census/session';

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

/**
 * The locale, digit, key, overflow and accessibility checks, then the screenshot; `mask` covers
 * what changes from run to run (dates of the seed's rows).
 */
async function expectScreen(
  page: Page,
  locale: Locale,
  name: string,
  title: string,
  mask: Locator[] = [],
) {
  await settle(page);
  await expectLocale(page, locale);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expectNoArabicIndicDigits(page);
  await expectNoRawKeys(page);
  if ((page.viewportSize()?.width ?? 0) <= 390) await expectNoHorizontalOverflow(page);
  await expectAxeClean(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, mask });
}

/** The checks of `expectScreen` for an open dialog (the page behind it is inert, no `h1`). */
async function expectDialog(page: Page, locale: Locale, name: string, mask: Locator[] = []) {
  await settle(page);
  await expectLocale(page, locale);
  await expectNoArabicIndicDigits(page);
  await expectNoRawKeys(page);
  await expectAxeClean(page);
  await expect(page).toHaveScreenshot(`${name}.png`, { mask });
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

// Members (WEB-3 leg 2, item D; plan 2.7, 2.11). The seed leaves the owner, the viewer, the
// site-scoped member and one pending invitation on the project's account; the reads come first.

const viewerName = 'سارة الغامدي';
/** The app wraps an email inside a sentence in Unicode isolates (src/settings/bidi.ts). */
const isolate = (value: string) => `\u2068${value}\u2069`;
const memberRow = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });

test('members: the owner sees the members, the pending invitation and the invite control', async ({
  page,
  locale,
}) => {
  await signIn(page, 'settings', project());
  const response = await page.goto('/settings/members');
  expect(response?.status()).toBe(200);
  expectSecurityHeaders(response, 'merchant');
  const table = page.getByRole('table', { name: t(locale, 'members.table_label') });
  await expect(table).toBeVisible();
  const own = memberRow(page, ownerName);
  await expect(own.getByText(t(locale, 'members.you'))).toBeVisible();
  const pending = memberRow(page, censusPendingName);
  await expect(pending.getByText(t(locale, 'members.status.invited'))).toBeVisible();
  await expect(pending.getByText(censusEmail('pending', project()))).toBeVisible();
  await expect(page.getByRole('button', { name: t(locale, 'members.invite') })).toBeVisible();
  // "N shown" and never a total (ADR-0029).
  await expect(page.getByRole('status').filter({ hasText: '4' })).toBeVisible();
  await expectScreen(page, locale, 'members', message(locale, 'nav', 'settings_members'), [
    table.locator('time'),
  ]);
  // The search filter lands in the URL and narrows the list.
  await page
    .getByRole('searchbox', { name: t(locale, 'members.filters.search') })
    .fill(censusEmail('pending', project()));
  await expect(page).toHaveURL(/[?&]q=census-pending/);
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
});

test('members: the viewer reads the list and a member without any write control', async ({
  page,
  locale,
}) => {
  await signIn(page, 'viewer', project());
  await page.goto('/settings/members?status=invited');
  await expect(page.getByRole('button', { name: t(locale, 'members.invite') })).toHaveCount(0);
  await expect(
    page
      .getByRole('group', { name: t(locale, 'members.filters.status') })
      .getByRole('button', { name: t(locale, 'members.status.invited') }),
  ).toHaveAttribute('aria-pressed', 'true');
  await memberRow(page, censusPendingName).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(censusPendingName);
  await expect(
    page.getByText(
      t(locale, 'members.detail.invitation_banner', {
        email: isolate(censusEmail('pending', project())),
      }),
    ),
  ).toBeVisible();
  for (const control of ['members.revoke.withdraw_action', 'members.detail.save']) {
    await expect(page.getByRole('button', { name: t(locale, control) })).toHaveCount(0);
  }
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expectScreen(page, locale, 'member-viewer', censusPendingName, [page.locator('main time')]);
  // The viewer's own row reads the same, with no control either.
  await page.goto('/settings/members');
  await memberRow(page, viewerName).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(viewerName);
  await expect(page.getByRole('button', { name: t(locale, 'members.revoke.action') })).toHaveCount(
    0,
  );
});

test("members: the owner's own membership shows its controls disabled with the reason", async ({
  page,
  locale,
}) => {
  await signIn(page, 'settings', project());
  await page.goto('/settings/members');
  // Keyboard: the row takes focus and Enter opens it.
  const own = memberRow(page, ownerName);
  await own.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(ownerName);
  const reason = t(locale, 'members.locks.self');
  await expect(page.getByRole('note')).toHaveText(reason);
  const revoke = page.getByRole('button', { name: t(locale, 'members.revoke.action') });
  await expect(revoke).toBeDisabled();
  await expect(revoke).toHaveAccessibleDescription(reason);
  await expect(page.getByRole('button', { name: t(locale, 'members.detail.save') })).toBeDisabled();
  await expect(
    page.getByRole('checkbox', { name: message(locale, 'settings', 'roles.owner') }),
  ).toBeDisabled();
  await expectScreen(page, locale, 'member-self', ownerName, [page.locator('main time')]);
});

test('members: invite, accept from the mail, a roles change ends the session, revoke', async ({
  page,
  browser,
  locale,
}) => {
  const email = censusEmail('member', project());
  const name = 'سلمان القرني';
  const asked = new Date(Date.now() - 1000);
  await signIn(page, 'settings', project());
  await page.goto('/settings/members');
  await page.getByRole('button', { name: t(locale, 'members.invite') }).click();
  const dialog = page.getByRole('dialog', { name: t(locale, 'members.invite_dialog.title') });
  await expect(dialog).toBeVisible();
  // The owner role is open to an owner; a send with no role asks for one.
  await expect(
    dialog.getByRole('checkbox', { name: message(locale, 'settings', 'roles.owner') }),
  ).toBeEnabled();
  await dialog.getByLabel(t(locale, 'members.invite_dialog.email')).fill(email);
  await dialog.getByLabel(t(locale, 'members.invite_dialog.name')).fill(name);
  await dialog.getByRole('button', { name: t(locale, 'members.invite_dialog.submit') }).click();
  await expect(dialog.getByText(message(locale, 'errors', 'fields.required'))).toBeVisible();
  await dialog.getByRole('checkbox', { name: message(locale, 'settings', 'roles.viewer') }).click();
  await expectDialog(page, locale, 'member-invite', [page.locator('table time')]);
  await dialog.getByRole('button', { name: t(locale, 'members.invite_dialog.submit') }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').first()).toHaveText(
    t(locale, 'members.invited_notice', { email: isolate(email) }),
  );
  await expect(memberRow(page, name).getByText(t(locale, 'members.status.invited'))).toBeVisible();

  // The invitee accepts from the mail in a browser of their own and is signed in.
  const invitee = await browser.newContext({ baseURL: origin });
  await invitee.addCookies([{ name: 'el_locale', value: locale, url: origin }]);
  const member = await invitee.newPage();
  await member.goto(await mailedLink(email, 'invitations', asked));
  await member.getByLabel(message(locale, 'auth', 'invitation.name')).fill(name);
  await member
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await expect(member.locator('[data-met="true"]')).toBeVisible();
  await member.getByRole('button', { name: message(locale, 'auth', 'invitation.submit') }).click();
  await expect(member).toHaveURL(`${origin}/`);
  const access = (await sessionCookie(invitee, 'el_staff_at'))!;

  // The owner adds a role: the member's sessions end (PLAT-12 2.8).
  await page.reload();
  await memberRow(page, name).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
  const accessCard = page.getByRole('region', { name: t(locale, 'members.detail.access_title') });
  await accessCard
    .getByRole('checkbox', { name: message(locale, 'settings', 'roles.dispatcher') })
    .click();
  await accessCard.getByRole('button', { name: t(locale, 'members.detail.save') }).click();
  await expect(accessCard.getByRole('status')).toHaveText(message(locale, 'common', 'form.saved'));
  await replaceCookie(invitee, 'el_staff_at', expiredCopy(access.value));
  await member.goto('/');
  await expect(member).toHaveURL(`${origin}/sign-in?reason=ended`);
  await invitee.close();

  // Revoke with the confirmation naming the member.
  await page.getByRole('button', { name: t(locale, 'members.revoke.action') }).click();
  const confirm = page.getByRole('alertdialog', {
    name: t(locale, 'members.revoke.title', { name }),
  });
  await expect(confirm.getByRole('listitem')).toHaveCount(3);
  await confirm.getByRole('button', { name: t(locale, 'members.revoke.confirm') }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole('status').first()).toHaveText(t(locale, 'members.revoke.done'));
  await expect(page.getByText(t(locale, 'members.detail.revoked_banner'))).toBeVisible();
});
