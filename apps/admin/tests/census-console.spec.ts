import type { Page } from '@playwright/test';
import {
  expect,
  expectAxeClean,
  expectLocale,
  expectNoArabicIndicDigits,
  expectNoHorizontalOverflow,
  expectNoRawKeys,
  message,
  settle,
  test,
  type Locale,
} from './census/helpers';
import {
  acceptOwnerInvitation,
  consoleAccount,
  platformSignIn,
  projectOf,
  type CensusProject,
} from './census/session';

// Census of the console screens (WEB-4 plan 2.13, leg 1): the home and navigation by permission
// with the 403 page; the accounts list; provisioning until the owner accepts and the account is
// active; the support reason asked once per tab and account, kept over a reload, cleared on exit;
// suspend, the notice and reactivate; close from suspended with the name typed; a flag set with a
// reason; rollout disabled for an admin and changed by a super admin. Each check signs in its own
// seeded console user (`census-platform-<role>-<project>`; the TOTP replay guard) on its project's
// own accounts (`consoleAccount`). Run `seed:census` before every run: it puts the accounts' status
// back (a closed census account opens again).

const project = () => projectOf(test.info().project.name);

/** A catalogue message with its `{placeholders}` filled. */
function text(locale: Locale, namespace: string, key: string, values: Record<string, string> = {}) {
  return message(locale, namespace, key).replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`no value for {${name}} in ${namespace}.${key}`);
    return value;
  });
}

const p = (locale: Locale, key: string, values?: Record<string, string>) =>
  text(locale, 'platform', key, values);

/** The locale, digits, raw-key, overflow and accessibility checks of every census page. */
async function checkPage(page: Page, locale: Locale) {
  await settle(page);
  // A colour transition still running (a filter chip just pressed) would read as low contrast.
  await page.waitForFunction(
    () => !document.getAnimations().some((animation) => animation instanceof CSSTransition),
  );
  // Next 16 streams the metadata again after a search-parameter change; wait for the title.
  await expect(page).toHaveTitle(message(locale, 'common', 'app.name'));
  await expectLocale(page, locale);
  await expectNoArabicIndicDigits(page);
  await expectNoRawKeys(page);
  if ((page.viewportSize()?.width ?? 0) <= 390) await expectNoHorizontalOverflow(page);
  await expectAxeClean(page);
  // A full-page capture of a scrolled page draws the sticky banner over the content.
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** A support reason in the project's language (the Arabic one travels percent-encoded, 8.2). */
function reasonFor(locale: Locale, purpose: string) {
  return locale === 'ar' ? `بلاغ دعم رقم 4411: ${purpose}` : `Support ticket 4411: ${purpose}`;
}

/** Opens an account and answers the support-reason dialog. */
async function openAccount(page: Page, locale: Locale, account: { id: string; name: string }) {
  await page.goto(`/accounts/${account.id}`);
  const gate = page.getByRole('alertdialog', {
    name: p(locale, 'account.gate.title', { name: account.name }),
  });
  await expect(gate).toBeVisible();
  const reason = reasonFor(locale, 'census');
  await gate.getByRole('textbox', { name: p(locale, 'account.gate.label') }).fill(reason);
  await gate.getByRole('button', { name: p(locale, 'account.gate.confirm') }).click();
  await expect(page.getByRole('region', { name: p(locale, 'account.banner.label') })).toBeVisible();
  // The tab's sections load as their own chunks: wait for them before reading or capturing.
  await expect(
    page.getByRole('heading', { level: 2, name: p(locale, 'account.details.title') }),
  ).toBeVisible();
  await page.waitForLoadState('networkidle');
  return reason;
}

/** Dates, times and generated ids change every run: masked in the screenshots. */
const masks = (page: Page) => [page.locator('time'), page.locator('[data-census-mask]')];

test('home: the areas the role opens and the outbox consumers', async ({ page, locale }) => {
  await platformSignIn(page, 'accounts', project());
  await page.goto('/');
  const main = page.getByRole('main');
  await expect(
    main.getByRole('heading', { level: 2, name: p(locale, 'nav.accounts') }),
  ).toBeVisible();
  await expect(
    main.getByRole('heading', { level: 2, name: p(locale, 'nav.rollout') }),
  ).toBeVisible();
  await expect(
    main.getByRole('heading', { name: p(locale, 'home.consumers.title') }),
  ).toBeVisible();
  // The manifest's navigation: the accounts list is current on its own pages too.
  const navigation = page.getByRole('navigation', { name: message(locale, 'nav', 'primary') });
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-home.png', {
    fullPage: true,
    mask: [...masks(page), main.locator('[aria-labelledby="consumers-title"] > div:last-child')],
  });
  await page.goto('/accounts');
  if ((page.viewportSize()?.width ?? 0) > 390) {
    await expect(navigation.getByRole('link', { name: p(locale, 'nav.accounts') })).toHaveAttribute(
      'aria-current',
      'page',
    );
  }
});

test('support reads accounts without a write control and gets 403 on provisioning', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'support', project());
  await page.goto('/accounts');
  await expect(
    page.getByRole('heading', { level: 1, name: p(locale, 'nav.accounts') }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: p(locale, 'accounts.provision') })).toHaveCount(0);

  const forbidden = await page.goto('/accounts/new');
  expect(forbidden?.status(), 'a support member opening the provisioning form').toBe(403);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(p(locale, 'no_access.title'));
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-no-access.png', { fullPage: true });

  await openAccount(page, locale, consoleAccount('active', project()));
  await expect(
    page.getByRole('button', { name: p(locale, 'account.lifecycle.suspend.button') }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: p(locale, 'account.invite.button') })).toHaveCount(
    0,
  );
  await page.getByRole('link', { name: p(locale, 'account.tabs.flags') }).click();
  await expect(page.getByRole('heading', { name: p(locale, 'flags.title') })).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);
});

test('accounts list: status tabs, search and the empty state after filters', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'accounts', project());
  const provisioned = consoleAccount('provisioned', project());
  await page.goto(`/accounts?q=${encodeURIComponent(provisioned.name)}`);
  const table = page.getByRole('table', { name: p(locale, 'accounts.table_label') });
  await expect(table.getByText(provisioned.name)).toBeVisible();
  await page
    .getByRole('group', { name: p(locale, 'accounts.filters.status') })
    .getByRole('button', { name: p(locale, 'account_status.provisioned') })
    .click();
  await expect(page).toHaveURL(/status=provisioned/);
  await expect(table.getByText(provisioned.name)).toBeVisible();
  await expect(table.getByText(p(locale, 'account_status.provisioned')).first()).toBeVisible();
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-accounts.png', {
    fullPage: true,
    mask: masks(page),
  });

  await page
    .getByRole('group', { name: p(locale, 'accounts.filters.status') })
    .getByRole('button', { name: p(locale, 'account_status.closed') })
    .click();
  await expect(page.getByText(p(locale, 'accounts.empty_filtered'))).toBeVisible();
  await page.getByRole('button', { name: p(locale, 'accounts.clear_filters') }).click();
  await expect(page).not.toHaveURL(/status=/);
});

test('provisioning: the owner accepts and the account turns active', async ({ page, locale }) => {
  const census: CensusProject = project();
  await platformSignIn(page, 'accounts', census);
  await page.goto('/accounts');
  await page.getByRole('link', { name: p(locale, 'accounts.provision') }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(p(locale, 'provision.title'));
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-provision.png', { fullPage: true });

  const stamp = Date.now();
  const name = `متجر التعداد ${stamp}`;
  const owner = `census-owner-${census.replace('-', '')}-${stamp}@census.test`;
  await page.getByLabel(p(locale, 'provision.fields.name'), { exact: true }).fill(name);
  for (const key of ['orders_per_month', 'drivers', 'sites', 'api_keys']) {
    await page.getByLabel(p(locale, `provision.limits.${key}`), { exact: true }).fill('25');
  }
  await page.getByLabel(p(locale, 'features.delivery'), { exact: true }).check();
  await page.getByLabel(p(locale, 'provision.fields.owner_email'), { exact: true }).fill(owner);
  await page
    .getByLabel(p(locale, 'provision.fields.owner_name'), { exact: true })
    .fill('مالك التعداد');
  await page.getByRole('button', { name: p(locale, 'provision.submit') }).click();
  await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').at(-1)!;

  await openAccount(page, locale, { id, name });
  await expect(page.getByRole('status').filter({ hasText: owner })).toBeVisible();
  const header = page.getByRole('main').locator('header').first();
  await expect(header.getByText(p(locale, 'account_status.provisioned'))).toBeVisible();

  await acceptOwnerInvitation(owner, 'مالك التعداد');
  await page.reload();
  // The tab keeps its reason over a reload: no dialog, the banner at once.
  await expect(page.getByRole('region', { name: p(locale, 'account.banner.label') })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(header.getByText(p(locale, 'account_status.active'))).toBeVisible();
});

test('the support reason: asked once per tab and account, kept, cleared on exit', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'lifecycle', project());
  const account = consoleAccount('active', project());
  await page.goto(`/accounts/${account.id}`);
  const gate = page.getByRole('alertdialog', {
    name: p(locale, 'account.gate.title', { name: account.name }),
  });
  await expect(gate).toBeVisible();
  await expect(
    gate.getByRole('button', { name: p(locale, 'account.gate.confirm') }),
  ).toBeDisabled();
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-reason.png');
  // Cancel goes back to the list: no read of the account's data without a reason.
  await gate.getByRole('button', { name: message(locale, 'common', 'actions.cancel') }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  const reason = await openAccount(page, locale, account);
  const banner = page.getByRole('region', { name: p(locale, 'account.banner.label') });
  await expect(banner).toContainText(reason);
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-account.png', { fullPage: true, mask: masks(page) });

  await page.reload();
  await expect(banner).toContainText(reason);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByRole('link', { name: p(locale, 'account.tabs.flags') }).click();
  await expect(page.getByRole('heading', { name: p(locale, 'flags.title') })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await banner.getByRole('button', { name: p(locale, 'account.banner.exit') }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  const stored = await page.evaluate(() =>
    Object.keys(window.sessionStorage).filter((key) => key.startsWith('elx:support:')),
  );
  expect(stored, 'support reasons left in the tab after exit').toEqual([]);
  await page.goto(`/accounts/${account.id}`);
  await expect(gate).toBeVisible();
});

test('suspend with a reason shows the notice; reactivate restores the account', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'lifecycle', project());
  const account = consoleAccount('active', project());
  const reason = await openAccount(page, locale, account);
  const header = page.getByRole('main').locator('header').first();

  await page.getByRole('button', { name: p(locale, 'account.lifecycle.suspend.button') }).click();
  const suspend = page.getByRole('alertdialog', {
    name: p(locale, 'account.lifecycle.suspend.title', { name: account.name }),
  });
  await expect(suspend.getByRole('textbox')).toHaveValue(reason);
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-suspend.png');
  await suspend
    .getByRole('button', { name: p(locale, 'account.lifecycle.suspend.confirm') })
    .click();
  await expect(header.getByText(p(locale, 'account_status.suspended'))).toBeVisible();
  const notice = page.getByRole('region', { name: p(locale, 'account.notice.suspended') });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(reason);
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-suspended.png', {
    fullPage: true,
    mask: masks(page),
  });

  await page
    .getByRole('button', { name: p(locale, 'account.lifecycle.reactivate.button') })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: p(locale, 'account.lifecycle.reactivate.confirm') })
    .click();
  await expect(header.getByText(p(locale, 'account_status.active'))).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test('close a suspended account: the name typed, then closed for good', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'accounts', project());
  const account = consoleAccount('suspended', project());
  await openAccount(page, locale, account);
  await page.getByRole('button', { name: p(locale, 'account.lifecycle.close.button') }).click();
  const close = page.getByRole('alertdialog', {
    name: p(locale, 'account.lifecycle.close.title', { name: account.name }),
  });
  const confirm = close.getByRole('button', { name: p(locale, 'account.lifecycle.close.confirm') });
  await expect(confirm).toBeDisabled();
  await close
    .getByRole('textbox', { name: p(locale, 'account.lifecycle.close.type_name') })
    .fill(account.name);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const header = page.getByRole('main').locator('header').first();
  await expect(header.getByText(p(locale, 'account_status.closed'))).toBeVisible();
  await expect(
    page.getByRole('region', { name: p(locale, 'account.notice.closed') }),
  ).toBeVisible();
});

test('an admin sets a flag with a reason and cannot change a rollout mode', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'operator', project());
  await page.goto('/rollout');
  const delivery = page.getByRole('radiogroup', { name: p(locale, 'features.delivery') });
  await expect(delivery.getByRole('radio').first()).toBeDisabled();
  await expect(
    page.getByText(message(locale, 'errors', 'codes.rollout_change_forbidden')).first(),
  ).toBeVisible();
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-rollout-admin.png', {
    fullPage: true,
    mask: masks(page),
  });

  const account = consoleAccount('active', project());
  await openAccount(page, locale, account);
  await page.getByRole('link', { name: p(locale, 'account.tabs.flags') }).click();
  const feature = p(locale, 'features.wms');
  const toggle = page.getByRole('switch', { name: p(locale, 'flags.switch_label', { feature }) });
  const wasOn = (await toggle.getAttribute('aria-checked')) === 'true';
  await toggle.click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByRole('textbox')).not.toHaveValue('');
  await dialog
    .getByRole('button', {
      name: p(locale, wasOn ? 'flags.dialog.off_confirm' : 'flags.dialog.on_confirm'),
    })
    .click();
  await expect(page.getByRole('status').filter({ hasText: p(locale, 'flags.done') })).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', wasOn ? 'false' : 'true');
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-flags.png', { fullPage: true, mask: masks(page) });
});

test('a super admin changes a rollout mode with a reason', async ({ page, locale }) => {
  const census = project();
  await platformSignIn(page, 'rollout', census);
  await page.goto('/rollout');
  // One key per writing project, so the projects never race on the same row; ar-390 reads only.
  const key = census === 'ar' ? 'delivery' : census === 'en' ? 'wms' : undefined;
  const group = page.getByRole('radiogroup', { name: p(locale, `features.${key ?? 'delivery'}`) });
  await expect(group.getByRole('radio').first()).toBeEnabled();
  if (key === undefined) return;
  const checked = group.getByRole('radio', { checked: true });
  const value = await checked.getAttribute('value');
  const from = value === 'off' || value === 'all' ? value : 'allowlist';
  const to = from === 'all' ? 'allowlist' : 'all';
  for (const mode of [to, from]) {
    await group
      .getByRole('radio', { name: p(locale, `rollout.modes.${mode}`), exact: true })
      .click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('textbox').fill(reasonFor(locale, `rollout ${mode}`));
    await dialog.getByRole('button', { name: p(locale, 'rollout.dialog.confirm') }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      group.getByRole('radio', { name: p(locale, `rollout.modes.${mode}`), exact: true }),
    ).toBeChecked();
  }
});
