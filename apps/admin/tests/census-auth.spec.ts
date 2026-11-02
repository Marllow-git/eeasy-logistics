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
  censusPassword,
  censusTotpSecret,
  expiredCopy,
  mailedLink,
  origin,
  platformEmail,
  platformSignIn,
  projectOf,
  replaceCookie,
  sessionCookie,
  stackSigningKey,
  totpCode,
  wrongCode,
} from './census/session';

// Census of the console's sign-in doors and session (WEB-2 plan 2.9, 2.14, leg 2; web §3.2 to
// §3.5; identity §3.3) against the real API of the stack, seeded by `pnpm --filter api
// seed:census`: password then TOTP, the enrolment view with its QR code and manual key (the code
// computed from the key the page shows), an invitation from its Mailpit link to a session, the
// proxy's refresh on a navigation, the end of a session (the 12 h idle notice), the re-sign-in
// dialog's password and TOTP steps, sign-out, the headers. No challenge, code, secret or otpauth
// URI appears in a URL or an analytics event.

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
    expect(url, 'step token, code or secret in a query').not.toMatch(
      /[?&](?:token|challenge_id|code|secret|otpauth|password|email)=/i,
    );
    expect(url, 'an otpauth URI in a URL').not.toMatch(/otpauth/i);
    for (const secret of secrets) expect(url, 'a secret in a URL').not.toContain(secret);
  }
}

/** The locale, text and accessibility checks every door passes, and its screenshot. */
async function expectDoor(
  page: Page,
  locale: Locale,
  name: string,
  title: string,
  mask: ReturnType<Page['locator']>[] = [],
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

async function fillSignIn(page: Page, locale: Locale, email: string, password = censusPassword) {
  await page.getByLabel(message(locale, 'auth', 'sign_in.email')).fill(email);
  await page.getByLabel(message(locale, 'auth', 'fields.password'), { exact: true }).fill(password);
  await page.getByRole('button', { name: message(locale, 'auth', 'sign_in.submit') }).click();
}

async function enterCode(page: Page, code: string) {
  await page.getByRole('textbox').first().fill(code);
}

async function expectConsoleHome(page: Page, locale: Locale) {
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    message(locale, 'platform', 'nav.home'),
  );
  await expect(
    page.getByRole('button', { name: new RegExp(message(locale, 'auth', 'session.user_menu')) }),
  ).toBeVisible();
}

/** The enrolment view: the QR code and the key; the first code computed from the key shown. */
async function enrolFromPage(page: Page, locale: Locale, name: string) {
  await expect(page).toHaveURL(`${origin}/sign-in/totp`);
  const key = page.getByTestId('totp-manual-key');
  await expect(key).toHaveText(/^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/);
  await expect(
    page.getByRole('img', { name: message(locale, 'auth', 'totp.qr_label') }),
  ).toBeVisible();
  // The QR code and the key are new on every enrolment: masked in the screenshot.
  await expectDoor(page, locale, name, message(locale, 'auth', 'totp.enrol_title'), [
    page.getByRole('img', { name: message(locale, 'auth', 'totp.qr_label') }),
    key,
  ]);
  const secret = (await key.textContent())!.replace(/\s+/g, '');
  await enterCode(page, totpCode(secret));
  return secret;
}

test('sign-in with password then TOTP, with the platform cookies and the events of plan 2.12', async ({
  page,
  locale,
}) => {
  const captured = await captureAnalytics(page);
  const requests = watchUrls(page);
  const response = await page.goto('/sign-in');
  expectSecurityHeaders(response);
  const login = page.waitForRequest((request) => request.url().endsWith('/v1/platform/auth/login'));
  await fillSignIn(page, locale, platformEmail('admin', project()));
  expect((await login).headers()['x-el-client']).toBe('web');
  await expect(page).toHaveURL(`${origin}/sign-in/totp`);
  await expectDoor(page, locale, 'totp', message(locale, 'auth', 'totp.title'));
  await enterCode(page, wrongCode(censusTotpSecret));
  await expect(page.getByText(message(locale, 'errors', 'codes.otp_invalid'))).toBeVisible();
  const code = totpCode(censusTotpSecret);
  await enterCode(page, code);
  await expectConsoleHome(page, locale);
  const access = await sessionCookie(page.context(), 'el_platform_at');
  expect(access).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  expect(access?.domain).toBe('localhost');
  expect((await sessionCookie(page.context(), 'el_platform_rt'))?.httpOnly).toBe(true);
  expect(await sessionCookie(page.context(), 'el_staff_at')).toBeUndefined();
  expectNoSecretInUrls(requests, [access!.value, code]);
  await expectAnalyticsEvents(captured, ['auth.sign_in.started', 'auth.sign_in.succeeded']);
  const bodies = captured.bodies.join('\n');
  expect(bodies).not.toContain(platformEmail('admin', project()));
  expect(bodies).not.toContain(access!.value);
});

test('first sign-in enrols the authenticator: QR code, key in groups of four, first code', async ({
  page,
  locale,
}) => {
  const captured = await captureAnalytics(page);
  const requests = watchUrls(page);
  const enrols: Request[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/v1/platform/auth/totp/enrol')) enrols.push(request);
  });
  await page.goto('/sign-in');
  await fillSignIn(page, locale, platformEmail('enrol', project()));
  const secret = await enrolFromPage(page, locale, 'totp-enrol');
  await expectConsoleHome(page, locale);
  expect(enrols, 'platformEnrolTotp once').toHaveLength(1);
  expectNoSecretInUrls(requests, [secret]);
  await expectAnalyticsEvents(captured, ['auth.sign_in.started', 'auth.sign_in.succeeded']);
  expect(captured.bodies.join('\n')).not.toContain(secret);
  // Enrolled now: the next sign-in asks for the code, the enrolment view is gone.
  await page.context().clearCookies({ name: /^el_platform_/ });
  await page.goto('/sign-in');
  await fillSignIn(page, locale, platformEmail('enrol', project()));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    message(locale, 'auth', 'totp.title'),
  );
});

test('an invitation from its Mailpit link: name, password, then the enrolment view', async ({
  page,
  locale,
}) => {
  const requests = watchUrls(page);
  const link = await mailedLink(platformEmail('invitee', project()), 'invitations');
  const response = await page.goto(link);
  expectSecurityHeaders(response);
  await expectDoor(page, locale, 'invitation', message(locale, 'auth', 'invitation.title'));
  await page.getByLabel(message(locale, 'auth', 'invitation.name')).fill('Census invitee');
  await page
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await page.getByRole('button', { name: message(locale, 'auth', 'invitation.submit') }).click();
  const secret = await enrolFromPage(page, locale, 'invitation-enrol');
  await expectConsoleHome(page, locale);
  expectNoSecretInUrls(requests, [secret]);
});

test('a used invitation link shows its own page', async ({ page, locale }) => {
  await page.goto('/invitations/census-used-link');
  await page.getByLabel(message(locale, 'auth', 'invitation.name')).fill('Census invitee');
  await page
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await page.getByRole('button', { name: message(locale, 'auth', 'invitation.submit') }).click();
  await expect(page.getByText(message(locale, 'auth', 'link.invalid_title'))).toBeVisible();
});

test('the TOTP page without a sign-in in progress goes back to sign-in', async ({ page }) => {
  const response = await page.goto('/sign-in/totp');
  expectSecurityHeaders(response);
  await expect(page).toHaveURL(`${origin}/sign-in`);
});

test('a navigation with an expired access cookie refreshes in the proxy and renders', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'session', project());
  const access = (await sessionCookie(page.context(), 'el_platform_at'))!;
  const refresh = (await sessionCookie(page.context(), 'el_platform_rt'))!;
  // The proxy reads only `exp`: an expired copy with a junk signature proves the refresh ran
  // before the page (the API would refuse the copy itself).
  const expired = expiredCopy(access.value);
  await replaceCookie(page.context(), 'el_platform_at', expired);
  const response = await page.goto('/?from=census');
  expect(response?.status()).toBe(200);
  expectSecurityHeaders(response);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    message(locale, 'platform', 'nav.home'),
  );
  const renewed = (await sessionCookie(page.context(), 'el_platform_at'))!.value;
  expect(renewed).not.toBe(expired);
  expect((await sessionCookie(page.context(), 'el_platform_rt'))?.value).not.toBe(refresh.value);
});

test('an ended session (the 12 h idle end) sends the navigation to sign-in with the notice', async ({
  page,
  locale,
}) => {
  await platformSignIn(page, 'session', project());
  const access = (await sessionCookie(page.context(), 'el_platform_at'))!;
  // After 12 idle hours the access token has expired and the API refuses the refresh token: an
  // expired access copy and a refresh token the API does not know stand for both.
  await replaceCookie(page.context(), 'el_platform_at', expiredCopy(access.value));
  await replaceCookie(page.context(), 'el_platform_rt', ['census', 'idle', 'refresh'].join('-'));
  const response = await page.goto('/?from=census');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(`${origin}/sign-in?next=%2F%3Ffrom%3Dcensus&reason=ended`);
  const notice = page.getByRole('status');
  await expect(notice).toContainText(message(locale, 'auth', 'session.ended_notice'));
  await expect(notice).toContainText(message(locale, 'auth', 'totp.idle_notice'));
  await expectDoor(page, locale, 'sign-in-ended', message(locale, 'auth', 'sign_in.title'));
  expect(await sessionCookie(page.context(), 'el_platform_at')).toBeUndefined();
  expect(await sessionCookie(page.context(), 'el_platform_rt')).toBeUndefined();
});

test('a page with unsaved state asks for the password, then the TOTP code, and keeps going', async ({
  page,
  locale,
}) => {
  const key = stackSigningKey();
  await platformSignIn(page, 'dialog', project());
  await page.goto('/census-session?unsaved');
  const access = (await sessionCookie(page.context(), 'el_platform_at'))!;
  await replaceCookie(page.context(), 'el_platform_at', expiredCopy(access.value, key));
  await replaceCookie(page.context(), 'el_platform_rt', ['census', 'refused', 'refresh'].join('-'));
  const refreshes: Request[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/v1/platform/auth/refresh')) refreshes.push(request);
  });
  await page.getByRole('button', { name: 'census: two calls' }).click();
  const dialog = page.getByRole('dialog', {
    name: message(locale, 'auth', 'session.dialog_title'),
  });
  await expect(dialog).toBeVisible();
  expect(refreshes).toHaveLength(1);
  await expect(page).toHaveURL(`${origin}/census-session?unsaved`);
  await dialog
    .getByLabel(message(locale, 'auth', 'fields.password'), { exact: true })
    .fill(censusPassword);
  await dialog
    .getByRole('button', { name: message(locale, 'auth', 'session.dialog_submit'), exact: true })
    .click();
  await expect(dialog.getByText(message(locale, 'auth', 'totp.description'))).toBeVisible();
  // The API refuses a step this user has used; the dialog's code is the next step's, which the
  // one-step tolerance accepts.
  await dialog
    .getByRole('textbox')
    .first()
    .fill(totpCode(censusTotpSecret, Math.floor(Date.now() / 30_000) + 1));
  await expect(page.getByTestId('census-session-result')).toHaveText('200,200');
  await expect(dialog).toBeHidden();
});

test('sign-out ends the session and lands on the signed-out page', async ({ page, locale }) => {
  await platformSignIn(page, 'logout', project());
  const response = await page.goto('/');
  expectSecurityHeaders(response);
  await page
    .getByRole('button', { name: new RegExp(message(locale, 'auth', 'session.user_menu')) })
    .click();
  const logout = page.waitForRequest((request) =>
    request.url().endsWith('/v1/platform/auth/logout'),
  );
  await page.getByRole('menuitem', { name: message(locale, 'auth', 'session.sign_out') }).click();
  expect((await logout).headers()['x-el-client']).toBe('web');
  await expect(page).toHaveURL(`${origin}/signed-out`);
  await expectDoor(page, locale, 'signed-out', message(locale, 'auth', 'signed_out.title'));
  expect(await sessionCookie(page.context(), 'el_platform_at')).toBeUndefined();
  expect(await sessionCookie(page.context(), 'el_platform_rt')).toBeUndefined();
  await page.goto('/');
  await expect(page).toHaveURL(`${origin}/sign-in`);
});

test('the console rewrites only its own surface', async ({ request }) => {
  test.skip(test.info().project.name !== 'ar', 'the routes are locale-free: one project');
  // ADR-0038: /v1/staff and /v1/recipient are the web hostname's; the console answers 404.
  expect((await request.get('/v1/staff/me')).status()).toBe(404);
  expect((await request.get('/v1/recipient/track/x')).status()).toBe(404);
  // Its own surface reaches the API: no session, so 401.
  expect((await request.get('/v1/platform/me')).status()).toBe(401);
});
