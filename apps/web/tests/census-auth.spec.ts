import type { Page, Request } from '@playwright/test';
import {
  captureAnalytics,
  expect,
  expectAnalyticsEvents,
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
  censusAccountNames,
  censusEmail,
  censusPassword,
  censusPhone,
  codeSentTo,
  expiredCopy,
  lastCode,
  mailedLink,
  origin,
  projectOf,
  replaceCookie,
  sessionCookie,
  signIn,
  stackSigningKey,
} from './census/session';

// Census of the sign-in doors and the browser session (WEB-2 plan 2.7, 2.8, 2.14; web §3.2 to
// §3.4) against the real API of the stack, seeded by `pnpm --filter api seed:census`: each door in
// the project's locale with its screenshot, the main path of each to a session, the proxy's
// refresh on a navigation, a refused refresh, the in-page single flight, the re-sign-in dialog,
// sign-out, and `next` kept on the origin. No step token, code or secret appears in a URL.

const project = () => projectOf(test.info().project.name);

/** Every request of the page from now on, to check that no URL carries a secret. */
function watchUrls(page: Page) {
  const requests: Request[] = [];
  page.on('request', (request) => requests.push(request));
  return requests;
}

function expectNoSecretInUrls(requests: Request[], secrets: string[] = []) {
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    const url = request.url();
    expect(url, 'step token or code in a query').not.toMatch(
      /[?&](?:token|challenge_id|enrolment_token|selection_token|link_token|code|password|email)=/i,
    );
    for (const secret of secrets) expect(url, 'a secret in a URL').not.toContain(secret);
  }
}

/** The locale, text and accessibility checks every door passes, and its screenshot. */
async function expectDoor(page: Page, locale: Locale, name: string, title: string) {
  await settle(page);
  await expectLocale(page, locale);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  await expectNoArabicIndicDigits(page);
  await expectNoRawKeys(page);
  if ((page.viewportSize()?.width ?? 0) <= 390) await expectNoHorizontalOverflow(page);
  await expectAxeClean(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    // The resend countdown moves every second.
    mask: [page.locator('button[aria-live="polite"]')],
  });
}

async function fillSignIn(page: Page, locale: Locale, email: string, password = censusPassword) {
  await page.getByLabel(message(locale, 'auth', 'sign_in.email')).fill(email);
  await page.getByLabel(message(locale, 'auth', 'fields.password'), { exact: true }).fill(password);
  await page.getByRole('button', { name: message(locale, 'auth', 'sign_in.submit') }).click();
}

async function enterCode(page: Page, code: string) {
  await page.getByRole('textbox').first().fill(code);
}

async function expectSignedInHome(page: Page, locale: Locale, account: string) {
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(message(locale, 'nav', 'home'));
  // The account names the sidebar's top; at 390 px the sidebar is a sheet behind a button.
  if ((page.viewportSize()?.width ?? 0) <= 390) {
    await page
      .getByRole('button', { name: message(locale, 'common', 'shell.open_navigation') })
      .click();
  }
  await expect(page.getByText(account, { exact: true }).filter({ visible: true })).toHaveCount(1);
}

test('sign-in to a session, with the cookies of PLAT-11 and the events of plan 2.12', async ({
  page,
  locale,
}) => {
  const captured = await captureAnalytics(page);
  const requests = watchUrls(page);
  const response = await page.goto('/sign-in');
  expectSecurityHeaders(response, 'auth');
  const login = page.waitForRequest((request) => request.url().endsWith('/v1/staff/auth/login'));
  await fillSignIn(page, locale, censusEmail('staff', project()));
  expect((await login).headers()['x-el-client']).toBe('web');
  await expectSignedInHome(page, locale, censusAccountNames.one);
  const access = await sessionCookie(page.context(), 'el_staff_at');
  expect(access).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  expect(access?.domain).toBe('localhost');
  expect((await sessionCookie(page.context(), 'el_staff_rt'))?.httpOnly).toBe(true);
  expectNoSecretInUrls(requests, [access!.value]);
  await expectAnalyticsEvents(captured, ['auth.sign_in.started', 'auth.sign_in.succeeded']);
  const bodies = captured.bodies.join('\n');
  expect(bodies).not.toContain(censusEmail('staff', project()));
  expect(bodies).not.toContain(access!.value);
});

test('a wrong password shows one message and stays on sign-in', async ({ page, locale }) => {
  await page.goto('/sign-in');
  await fillSignIn(page, locale, censusEmail('staff', project()), `${censusPassword} wrong`);
  await expect(
    page.getByText(message(locale, 'errors', 'codes.invalid_credentials')),
  ).toBeVisible();
  await expect(page).toHaveURL(`${origin}/sign-in`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    message(locale, 'auth', 'sign_in.title'),
  );
});

test('the second factor: the code from WhatsApp, a wrong one refused, then a session', async ({
  page,
  locale,
}) => {
  const requests = watchUrls(page);
  const phone = censusPhone(1, project());
  const before = await lastCode(phone);
  await page.goto('/sign-in');
  await fillSignIn(page, locale, censusEmail('factor', project()));
  await expect(page).toHaveURL(`${origin}/sign-in/second-factor`);
  const code = await codeSentTo(phone, before);
  await expectDoor(page, locale, 'second-factor', message(locale, 'auth', 'second_factor.title'));
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  await enterCode(page, wrong);
  await expect(page.getByText(message(locale, 'errors', 'codes.otp_invalid'))).toBeVisible();
  await enterCode(page, code);
  await expectSignedInHome(page, locale, 'بضائع الدمام');
  expectNoSecretInUrls(requests, [code]);
});

test('enrolment at sign-in: the phone, its code, then sign in again', async ({ page, locale }) => {
  const requests = watchUrls(page);
  const phone = censusPhone(3, project());
  const before = await lastCode(phone);
  await page.goto('/sign-in');
  await fillSignIn(page, locale, censusEmail('enrol', project()));
  await expect(page).toHaveURL(`${origin}/sign-in/second-factor/enrol`);
  await expectDoor(page, locale, 'enrol', message(locale, 'auth', 'enrol.title'));
  await page.getByLabel(message(locale, 'auth', 'enrol.phone')).fill(phone.slice(4));
  await page.getByRole('button', { name: message(locale, 'auth', 'enrol.send') }).click();
  const code = await codeSentTo(phone, before);
  await enterCode(page, code);
  await expect(page.getByText(message(locale, 'auth', 'enrol.done_title'))).toBeVisible();
  expectNoSecretInUrls(requests, [code]);
});

test('account selection lists both accounts and opens the chosen one', async ({ page, locale }) => {
  await page.goto('/sign-in');
  await fillSignIn(page, locale, censusEmail('owner', project()));
  await expect(page).toHaveURL(`${origin}/sign-in/select-account`);
  await expect(
    page.getByRole('button', { name: new RegExp(censusAccountNames.one) }),
  ).toBeVisible();
  await expectDoor(page, locale, 'select-account', message(locale, 'auth', 'select_account.title'));
  await page.getByRole('button', { name: new RegExp(censusAccountNames.two) }).click();
  await expectSignedInHome(page, locale, censusAccountNames.two);
});

test('an invitation accepted from its Mailpit link starts a session', async ({ page, locale }) => {
  const link = await mailedLink(censusEmail('invitee', project()), 'invitations');
  const response = await page.goto(link);
  expectSecurityHeaders(response, 'auth');
  await expectDoor(page, locale, 'invitation', message(locale, 'auth', 'invitation.title'));
  await page.getByLabel(message(locale, 'auth', 'invitation.name')).fill('دعوة التعداد');
  await page
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await expect(page.locator('[data-met="true"]')).toBeVisible();
  await page.getByRole('button', { name: message(locale, 'auth', 'invitation.submit') }).click();
  await expectSignedInHome(page, locale, censusAccountNames.one);
});

test('a password reset from its Mailpit link, then sign-in with the new password', async ({
  page,
  locale,
}) => {
  const email = censusEmail('reset', project());
  const asked = new Date(Date.now() - 1000);
  await page.goto('/password-reset');
  await expectDoor(
    page,
    locale,
    'password-reset',
    message(locale, 'auth', 'password_reset.request_title'),
  );
  await page.getByLabel(message(locale, 'auth', 'sign_in.email')).fill(email);
  await page
    .getByRole('button', { name: message(locale, 'auth', 'password_reset.request_submit') })
    .click();
  await expect(page.getByRole('status')).toHaveText(
    message(locale, 'auth', 'password_reset.sent_description'),
  );
  const link = await mailedLink(email, 'password-reset', asked);
  await page.goto(link);
  await expectDoor(
    page,
    locale,
    'password-reset-confirm',
    message(locale, 'auth', 'password_reset.confirm_title'),
  );
  const renewed = `${censusPassword} renewed`;
  await page.getByLabel(message(locale, 'auth', 'password.new'), { exact: true }).fill(renewed);
  await page
    .getByRole('button', { name: message(locale, 'auth', 'password_reset.confirm_submit') })
    .click();
  await expect(page.getByText(message(locale, 'auth', 'password_reset.done_title'))).toBeVisible();
  await page.goto('/sign-in');
  await fillSignIn(page, locale, email, renewed);
  await expectSignedInHome(page, locale, censusAccountNames.one);
});

test('the re-enrolment link: the password, then a new phone and its code', async ({
  page,
  locale,
}) => {
  const phone = censusPhone(4, project());
  const before = await lastCode(phone);
  const link = await mailedLink(censusEmail('relink', project()), 'second-factor/enrol');
  await page.goto(link);
  await expectDoor(page, locale, 'enrol-link', message(locale, 'auth', 'enrol_link.title'));
  await page
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await page.getByRole('button', { name: message(locale, 'auth', 'enrol_link.submit') }).click();
  await page.getByLabel(message(locale, 'auth', 'enrol.phone')).fill(phone.slice(4));
  await page.getByRole('button', { name: message(locale, 'auth', 'enrol.send') }).click();
  await enterCode(page, await codeSentTo(phone, before));
  await expect(page.getByText(message(locale, 'auth', 'enrol.done_title'))).toBeVisible();
});

test('sign-out ends the session and lands on the signed-out page', async ({ page, locale }) => {
  await signIn(page, 'session', project());
  await page.goto('/');
  await page
    .getByRole('button', { name: new RegExp(message(locale, 'auth', 'session.user_menu')) })
    .click();
  await page.getByRole('menuitem', { name: message(locale, 'auth', 'session.sign_out') }).click();
  await expect(page).toHaveURL(`${origin}/signed-out`);
  await expectDoor(page, locale, 'signed-out', message(locale, 'auth', 'signed_out.title'));
  expect(await sessionCookie(page.context(), 'el_staff_at')).toBeUndefined();
  expect(await sessionCookie(page.context(), 'el_staff_rt')).toBeUndefined();
  await page.goto('/');
  await expect(page).toHaveURL(`${origin}/sign-in`);
});

test('a navigation with an expired access cookie refreshes in the proxy and renders', async ({
  page,
  locale,
}) => {
  await signIn(page, 'session', project());
  const access = (await sessionCookie(page.context(), 'el_staff_at'))!;
  const refresh = (await sessionCookie(page.context(), 'el_staff_rt'))!;
  // The proxy reads only `exp`: an expired copy with a junk signature proves the refresh ran
  // before the page (the API would refuse the copy itself).
  const expired = expiredCopy(access.value);
  await replaceCookie(page.context(), 'el_staff_at', expired);
  const response = await page.goto('/?from=census');
  expect(response?.status()).toBe(200);
  expectSecurityHeaders(response, 'merchant');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(message(locale, 'nav', 'home'));
  // A fresh access token (signed in the same second it may equal the first one: same claims).
  const renewed = (await sessionCookie(page.context(), 'el_staff_at'))!.value;
  expect(renewed).not.toBe(expired);
  const exp = (
    JSON.parse(Buffer.from(renewed.split('.')[1]!, 'base64url').toString()) as {
      exp: number;
    }
  ).exp;
  expect(exp * 1000).toBeGreaterThan(Date.now());
  expect((await sessionCookie(page.context(), 'el_staff_rt'))?.value).not.toBe(refresh.value);
});

test('a refused refresh sends the navigation to sign-in with next and the notice', async ({
  page,
  locale,
}) => {
  await signIn(page, 'session', project());
  const access = (await sessionCookie(page.context(), 'el_staff_at'))!;
  await replaceCookie(page.context(), 'el_staff_at', expiredCopy(access.value));
  await replaceCookie(page.context(), 'el_staff_rt', ['census', 'refused', 'refresh'].join('-'));
  const response = await page.goto('/?from=census');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(`${origin}/sign-in?next=%2F%3Ffrom%3Dcensus&reason=ended`);
  await expect(page.getByRole('status')).toHaveText(
    message(locale, 'auth', 'session.ended_notice'),
  );
  await expectDoor(page, locale, 'sign-in-ended', message(locale, 'auth', 'sign_in.title'));
  expect(await sessionCookie(page.context(), 'el_staff_at')).toBeUndefined();
});

test('two in-page calls with an expired token cause one refresh in the browser', async ({
  page,
}) => {
  const key = stackSigningKey();
  await signIn(page, 'session', project());
  await page.goto('/census-session');
  const access = (await sessionCookie(page.context(), 'el_staff_at'))!;
  await replaceCookie(page.context(), 'el_staff_at', expiredCopy(access.value, key));
  const refreshes: Request[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/v1/staff/auth/refresh')) refreshes.push(request);
  });
  await page.getByRole('button', { name: 'census: two calls' }).click();
  await expect(page.getByTestId('census-session-result')).toHaveText('200,200');
  expect(refreshes).toHaveLength(1);
  expect(refreshes[0]?.headers()['x-el-client']).toBe('web');
});

test('a page with unsaved state asks for the password again and keeps going', async ({
  page,
  locale,
}) => {
  const key = stackSigningKey();
  await signIn(page, 'session', project());
  await page.goto('/census-session?unsaved');
  const access = (await sessionCookie(page.context(), 'el_staff_at'))!;
  await replaceCookie(page.context(), 'el_staff_at', expiredCopy(access.value, key));
  await replaceCookie(page.context(), 'el_staff_rt', ['census', 'refused', 'refresh'].join('-'));
  await page.getByRole('button', { name: 'census: two calls' }).click();
  const dialog = page.getByRole('dialog', {
    name: message(locale, 'auth', 'session.dialog_title'),
  });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(`${origin}/census-session?unsaved`);
  await dialog
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await dialog
    .getByRole('button', { name: message(locale, 'auth', 'session.dialog_submit'), exact: true })
    .click();
  await expect(page.getByTestId('census-session-result')).toHaveText('200,200');
  await expect(dialog).toBeHidden();
});

test('next never leaves the origin', async ({ page, locale }) => {
  await page.goto(`/sign-in?next=${encodeURIComponent('//evil.example/steal')}`);
  await fillSignIn(page, locale, censusEmail('staff', project()));
  await expectSignedInHome(page, locale, censusAccountNames.one);
  await page.goto(`/sign-in?next=${encodeURIComponent('https://evil.example/steal')}`);
  // Signed in already: the proxy sends the user on, to the origin's home, not to the other host.
  await expect(page).toHaveURL(`${origin}/`);
});

test('the suspended notice and the account pages answer with the headers', async ({
  page,
  locale,
}) => {
  const response = await page.goto('/account-suspended');
  expectSecurityHeaders(response, 'auth');
  await expectDoor(
    page,
    locale,
    'account-suspended',
    message(locale, 'auth', 'session.suspended_title'),
  );
  await expect(
    page.getByRole('button', { name: message(locale, 'auth', 'session.sign_out') }),
  ).toBeVisible();
});

test('a used invitation link shows its own page', async ({ page, locale }) => {
  await page.goto('/invitations/census-used-link');
  await page.getByLabel(message(locale, 'auth', 'invitation.name')).fill('دعوة التعداد');
  await page
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await page.getByRole('button', { name: message(locale, 'auth', 'invitation.submit') }).click();
  await expect(page.getByText(message(locale, 'auth', 'link.invalid_title'))).toBeVisible();
});

