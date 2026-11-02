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
  censusPassword,
  consoleAccount,
  mailedLink,
  origin,
  platformEmail,
  platformSignIn,
  projectOf,
  replaceCookie,
  sessionCookie,
  totpCode,
  type CensusProject,
} from './census/session';
import type { Request, Route } from '@playwright/test';

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

/** A tab of the account's sections (the main navigation has an "Audit log" link too). */
const accountTab = (page: Page, locale: Locale, key: string) =>
  page
    .getByRole('navigation', { name: p(locale, 'account.tabs.label') })
    .getByRole('link', { name: p(locale, `account.tabs.${key}`) });

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
  await accountTab(page, locale, 'flags').click();
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
  await accountTab(page, locale, 'flags').click();
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

/** The access token with its claims kept and a signature the API refuses (`401 token_invalid`). */
function refusedCopy(token: string): string {
  const [header = '', payload = ''] = token.split('.');
  return `${header}.${payload}.${Buffer.from('not the signature').toString('base64url')}`;
}

// Adversary fix round 1 (M): a stored support reason must not outlive the session. The admin's
// edit is unsaved, so the refused token opens the re-sign-in dialog; "another account" ends the
// session, which drops every stored reason before the sign-in page; the next user is asked again.
test('an ended session forgets the support reasons: the next user is asked again', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'operator', project());
  const account = consoleAccount('active', project());
  await openAccount(page, locale, account);
  await page
    .getByLabel(p(locale, 'provision.fields.name'), { exact: true })
    .fill(`${account.name} 2`);
  const access = (await sessionCookie(page.context(), 'el_platform_at'))!;
  await replaceCookie(page.context(), 'el_platform_at', refusedCopy(access.value));
  await page.getByRole('button', { name: p(locale, 'account.details.save') }).click();
  const dialog = page.getByRole('dialog', {
    name: message(locale, 'auth', 'session.dialog_title'),
  });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: message(locale, 'auth', 'session.dialog_other_user') })
    .click();
  await expect(page).toHaveURL(/\/sign-in\?.*reason=ended/);
  const stored = await page.evaluate(() =>
    Object.keys(window.sessionStorage).filter((key) => key.startsWith('elx:support:')),
  );
  expect(stored, 'support reasons left in the tab after the session ended').toEqual([]);

  await page.context().clearCookies({ name: /^el_platform_/ });
  await platformSignIn(page, 'support', project());
  await page.goto(`/accounts/${account.id}`);
  await expect(
    page.getByRole('alertdialog', {
      name: p(locale, 'account.gate.title', { name: account.name }),
    }),
  ).toBeVisible();
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
  const reason = await openAccount(page, locale, account);
  await accountTab(page, locale, 'flags').click();
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

  // The account's Audit tab shows the change with its reason (leg 1 8.3 #3).
  await accountTab(page, locale, 'audit').click();
  const log = page.getByRole('table', { name: p(locale, 'audit.account_table_label') });
  const changed = log
    .getByRole('row')
    .filter({ hasText: message(locale, 'settings', 'audit.actions.core_feature_flag_changed') })
    .first();
  await expect(changed).toContainText(reason);
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

// Leg 2 (WEB-4 plan 2.7, 2.8): the account's members and audit log under the banner, read by a
// support member; the outbox with its account filter, the seeded dead row's drawer and the two
// replays. The census API runs without the queues (lead ruling on 8.3 #2): `platformListConsumers`
// answers, but a replay needs BullMQ, so the census asserts each replay request (reason, intent
// key, client header) and answers it itself; the API's integration suite covers the replay.

test('support reads the members and the audit log of an account under the banner', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'support', project());
  const account = consoleAccount('active', project());
  const reason = await openAccount(page, locale, account);
  await accountTab(page, locale, 'members').click();
  await expect(
    page.getByRole('heading', { level: 2, name: p(locale, 'members.title') }),
  ).toBeVisible();
  const members = page.getByRole('table', { name: p(locale, 'members.table_label') });
  await expect(members).toBeVisible();
  await expect(page.getByRole('region', { name: p(locale, 'account.banner.label') })).toContainText(
    reason,
  );
  await page.waitForLoadState('networkidle');
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-members.png', { fullPage: true, mask: masks(page) });

  await accountTab(page, locale, 'audit').click();
  const log = page.getByRole('table', { name: p(locale, 'audit.account_table_label') });
  // Every read under the door is audited with the reason: the members read above among them.
  const read = log
    .getByRole('row')
    .filter({
      hasText: message(locale, 'settings', 'audit.actions.platform_cross_tenant_accessed'),
    })
    .first();
  await expect(read).toContainText(reason);
  await page.waitForLoadState('networkidle');
  await checkPage(page, locale);
  // The log grows with every run: the viewport only, its rows masked.
  await expect(page).toHaveScreenshot('console-account-audit.png', {
    mask: [...masks(page), log.locator('tbody')],
  });
});

/** Answers a replay request in the census and keeps it for the assertions. */
function answerReplay(page: Page, path: RegExp, status: number, body: () => unknown) {
  const seen: Request[] = [];
  void page.route(path, async (route: Route) => {
    seen.push(route.request());
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body()) });
  });
  return seen;
}

test('outbox: an account filter with a reason, the dead row, its drawer and the replays', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'outbox', project());
  await page.goto('/outbox');
  // The contract requires a reason on the platform-wide list too (8.2): asked once in the tab.
  const wide = page.getByRole('alertdialog', {
    name: p(locale, 'filter_gate.title', { name: p(locale, 'filter_gate.all_accounts') }),
  });
  await wide.getByRole('textbox').fill(reasonFor(locale, 'outbox overview'));
  await wide.getByRole('button', { name: p(locale, 'filter_gate.confirm') }).click();
  await expect(page.getByRole('table', { name: p(locale, 'outbox.table_label') })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: p(locale, 'nav.outbox') }),
  ).toBeVisible();
  const bulk = page.getByRole('button', { name: p(locale, 'outbox.bulk.button') });
  await expect(bulk).toBeDisabled();
  await expect(page.getByText(p(locale, 'outbox.bulk.needs_filter'))).toBeVisible();
  await page.waitForLoadState('networkidle');
  await checkPage(page, locale);
  // The outbox grows with every run: the viewport only, its rows masked.
  await expect(page).toHaveScreenshot('console-outbox.png', {
    mask: [...masks(page), page.getByRole('table').locator('tbody')],
  });

  const account = consoleAccount('active', project());
  await page.goto(`/outbox?account_id=${account.id}&status=dead&kind=webhook`);
  const gate = page.getByRole('alertdialog', {
    name: p(locale, 'filter_gate.title', { name: account.name }),
  });
  await expect(gate).toBeVisible();
  const reason = reasonFor(locale, 'outbox');
  await gate.getByRole('textbox').fill(reason);
  await gate.getByRole('button', { name: p(locale, 'filter_gate.confirm') }).click();
  const table = page.getByRole('table', { name: p(locale, 'outbox.table_label') });
  const dead = table.getByRole('row').filter({ hasText: 'http_503' }).first();
  await expect(dead).toBeVisible();
  await expect(dead).toContainText(p(locale, 'outbox.statuses.dead'));

  await dead.click();
  const drawer = page.getByRole('dialog', { name: 'core.account.suspended' });
  await expect(drawer.getByLabel(p(locale, 'outbox.drawer.envelope'))).toContainText(
    'WEB-4 outbox census row',
  );
  await page.waitForLoadState('networkidle');
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-outbox-drawer.png', {
    mask: [
      ...masks(page),
      drawer.getByLabel(p(locale, 'outbox.drawer.envelope')),
      drawer.locator('dd bdi'),
      drawer.locator('p bdi'),
    ],
  });

  // One row: never one click; the reason is the tab's, sent in the body with the intent's key.
  const replays = answerReplay(page, /\/v1\/platform\/outbox\/[^/]+\/replay$/, 200, () => ({}));
  await drawer.getByRole('button', { name: p(locale, 'outbox.replay.button') }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('textbox')).toHaveValue(reason);
  await confirm.getByRole('button', { name: p(locale, 'outbox.replay.confirm') }).click();
  await expect(drawer.getByRole('status')).toHaveText(p(locale, 'outbox.replay.done'));
  expect(replays).toHaveLength(1);
  const one = replays[0]!;
  expect(one.method()).toBe('POST');
  expect(one.postDataJSON()).toEqual({ reason });
  expect(await one.headerValue('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
  expect(await one.headerValue('x-el-client')).toBe('web');
  await page.keyboard.press('Escape');

  // The filtered set: the account and the kind name it; the count comes back from the API.
  const bulks = answerReplay(page, /\/v1\/platform\/outbox\/replay-dead$/, 202, () => ({
    matched: 1,
    replayed: 1,
  }));
  await expect(bulk).toBeEnabled();
  await bulk.click();
  const confirmBulk = page.getByRole('alertdialog');
  await expect(confirmBulk).toContainText(p(locale, 'outbox.bulk.limit'));
  await confirmBulk.getByRole('button', { name: p(locale, 'outbox.bulk.confirm') }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: p(locale, 'outbox.bulk.done', { matched: '1', replayed: '1' }) }),
  ).toBeVisible();
  expect(bulks).toHaveLength(1);
  expect(bulks[0]!.postDataJSON()).toEqual({ account_id: account.id, kind: 'webhook', reason });
});

// Leg 2 (WEB-4 plan 2.9, 2.10): a super admin invites a staff member (the mail in Mailpit), sees
// every action locked on their own row, changes the role of `colleague` and revokes it, and resets
// the authenticator of `relink`; `relink` is then told at sign-in to use the mailed link, opens it,
// confirms the password, enrols a new authenticator and lands signed in.

/** The row of a staff member by email, and its actions menu. */
function staffRow(page: Page, locale: Locale, email: string) {
  const row = page
    .getByRole('table', { name: p(locale, 'staff.table_label') })
    .getByRole('row')
    .filter({ hasText: email });
  return {
    row,
    open: () => row.getByRole('button', { name: /.+/ }).last().click(),
  };
}

test('staff: invite, own row locked, change a role, revoke, reset an authenticator', async ({
  page,
  locale,
}) => {
  const census = project();
  await platformSignIn(page, 'staff', census);
  await page.goto('/staff');
  await expect(page.getByRole('heading', { level: 1, name: p(locale, 'nav.staff') })).toBeVisible();
  const own = staffRow(page, locale, platformEmail('staff', census));
  await expect(own.row).toContainText(p(locale, 'staff.you'));
  await page.waitForLoadState('networkidle');
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-staff.png', {
    mask: [...masks(page), page.getByRole('table').locator('tbody')],
  });

  // Never on oneself: every action of the own row is disabled with why.
  await own.open();
  const menu = page.getByRole('menu');
  await expect(
    menu.getByRole('menuitem', { name: new RegExp(p(locale, 'staff.role.button')) }),
  ).toHaveAttribute('aria-disabled', 'true');
  await expect(menu).toContainText(p(locale, 'staff.locks.self'));
  await page.keyboard.press('Escape');

  // Invite: one role from the list with its sentence; the invitation reaches Mailpit.
  const hire = platformEmail('hire', census);
  await page.getByRole('button', { name: p(locale, 'staff.invite.button') }).click();
  const invite = page.getByRole('alertdialog', { name: p(locale, 'staff.invite.title') });
  await invite.getByLabel(p(locale, 'staff.invite.email')).fill(hire);
  await invite.getByLabel(p(locale, 'staff.invite.name')).fill('Census hire');
  await invite
    .getByRole('radio', { name: p(locale, 'staff.roles.platform_support.label'), exact: true })
    .check();
  await checkPage(page, locale);
  // The dialog alone: the list behind it changes with every run.
  await expect(invite).toHaveScreenshot('console-staff-invite.png');
  await invite.getByRole('button', { name: p(locale, 'staff.invite.submit') }).click();
  await expect(
    page.getByRole('status').filter({ hasText: p(locale, 'staff.invite.done', { email: hire }) }),
  ).toBeVisible();
  expect(await mailedLink(hire, 'invitations')).toContain(`${origin}/invitations/`);

  // Change the role of `colleague` (support → admin), then revoke it.
  const colleague = staffRow(page, locale, platformEmail('colleague', census));
  await colleague.open();
  await page.getByRole('menuitem', { name: new RegExp(p(locale, 'staff.role.button')) }).click();
  const change = page.getByRole('alertdialog');
  await expect(change).toContainText(p(locale, 'staff.role.sessions'));
  await change
    .getByRole('radio', { name: p(locale, 'staff.roles.platform_admin.label'), exact: true })
    .check();
  await change.getByRole('button', { name: p(locale, 'staff.role.confirm') }).click();
  await expect(colleague.row).toContainText(p(locale, 'staff.roles.platform_admin.label'));
  await colleague.open();
  await page.getByRole('menuitem', { name: new RegExp(p(locale, 'staff.revoke.button')) }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: p(locale, 'staff.revoke.confirm') })
    .click();
  await expect(colleague.row).toContainText(p(locale, 'staff.revoked'));

  // Reset the authenticator of `relink` with a reason: the one-time link is mailed.
  const relink = staffRow(page, locale, platformEmail('relink', census));
  await relink.open();
  await page.getByRole('menuitem', { name: new RegExp(p(locale, 'staff.reset.button')) }).click();
  const reset = page.getByRole('alertdialog');
  await reset.getByRole('textbox').fill(reasonFor(locale, 'lost phone'));
  await reset.getByRole('button', { name: p(locale, 'staff.reset.confirm') }).click();
  await expect(page.getByRole('status').filter({ hasText: /.+/ }).first()).toBeVisible();
  await expect(relink.row).toContainText(p(locale, 'staff.totp_off'));
});

test('a reset authenticator: the sign-in points to the link, the link re-enrols and signs in', async ({
  page,
  locale,
}) => {
  const census = project();
  const email = platformEmail('relink', census);
  // The reset of the previous case mailed the link; this case runs after it in the project.
  const link = await mailedLink(email, 'totp/enrol');
  await page.goto('/sign-in');
  await page.getByLabel(message(locale, 'auth', 'sign_in.email')).fill(email);
  await page
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await page.getByRole('button', { name: message(locale, 'auth', 'sign_in.submit') }).click();
  await expect(
    page.getByText(message(locale, 'auth', 'totp.enrolment_link_required')),
  ).toBeVisible();

  await page.goto(link);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    message(locale, 'auth', 'totp.relink_title'),
  );
  await checkPage(page, locale);
  await expect(page).toHaveScreenshot('console-relink.png', { fullPage: true });
  await page
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await page.getByRole('button', { name: message(locale, 'auth', 'totp.relink_submit') }).click();
  await expect(page).toHaveURL(`${origin}/sign-in/totp`);
  const key = page.getByTestId('totp-manual-key');
  await expect(key).toHaveText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/);
  const secret = (await key.textContent())!.replace(/\s+/g, '');
  await page.getByRole('textbox').first().fill(totpCode(secret));
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(p(locale, 'nav.home'));

  // The link is spent: opened again, it says so.
  await page.context().clearCookies({ name: /^el_platform_/ });
  await page.goto(link);
  await page
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await page.getByRole('button', { name: message(locale, 'auth', 'totp.relink_submit') }).click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(
    message(locale, 'auth', 'link.invalid_title'),
  );
});
// Leg 2 (WEB-4 plan 2.11; exit criterion): the platform audit log, read by support with a reason,
// filtered to an account (its own reason) and to support reads, shows the reason the support
// member gave on the account, in the project's language (an Arabic reason decoded by the API).

test('platform audit: support reads, filtered to an account, show the support reason', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'support', project());
  await page.goto('/audit');
  const wide = page.getByRole('alertdialog', {
    name: p(locale, 'filter_gate.title', { name: p(locale, 'filter_gate.all_accounts') }),
  });
  await wide.getByRole('textbox').fill(reasonFor(locale, 'audit review'));
  await wide.getByRole('button', { name: p(locale, 'filter_gate.confirm') }).click();
  const table = page.getByRole('table', { name: p(locale, 'audit.table_label') });
  await expect(table).toBeVisible();
  await page.waitForLoadState('networkidle');
  await checkPage(page, locale);
  // The log grows with every run: the viewport only, its rows masked.
  await expect(page).toHaveScreenshot('console-audit.png', {
    mask: [...masks(page), table.locator('tbody')],
  });

  const account = consoleAccount('active', project());
  await page.goto(`/audit?account_id=${account.id}&action=platform.cross_tenant.accessed`);
  const gate = page.getByRole('alertdialog', {
    name: p(locale, 'filter_gate.title', { name: account.name }),
  });
  await gate.getByRole('textbox').fill(reasonFor(locale, 'audit of one account'));
  await gate.getByRole('button', { name: p(locale, 'filter_gate.confirm') }).click();
  const read = table
    .getByRole('row')
    .filter({
      hasText: message(locale, 'settings', 'audit.actions.platform_cross_tenant_accessed'),
    })
    .filter({ hasText: reasonFor(locale, 'census') })
    .first();
  await expect(read).toBeVisible();
});
