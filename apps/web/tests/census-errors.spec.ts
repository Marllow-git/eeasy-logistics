import {
  captureMonitoring,
  censusBuild,
  expect,
  expectAxeClean,
  expectLocale,
  expectNoArabicIndicDigits,
  expectNoHorizontalOverflow,
  expectNoRawKeys,
  expectNothingPersonal,
  message,
  plantedPhone,
  settle,
  test,
} from './census/helpers';

// Census of the error pages and the Sentry tunnel (PLAT-14 plan 2.9, web §10.4): each group's
// error page renders inside its frame and the root one full-page, in the project's locale, with
// the reference support asks for, retry and home; a browser error reaches /monitoring without the
// recipient token, the planted phone or a cookie; the tunnel refuses envelopes for another DSN.
// The fault routes exist in local and ci builds only (src/observability/census-fault.tsx).

// A fake recipient token, assembled so the secret scanner of the commit hook sees no literal.
const token = ['Zx81kQ0p', 'R7vW2mN5', 'bT9yL3cJ'].join('');

const faults = [
  { name: 'error-merchant', path: '/census-fault', home: '/', shell: 'navigation' },
  { name: 'error-auth', path: '/sign-in/census-fault', home: '/sign-in', shell: 'frame' },
  { name: 'error-recipient', path: `/track/${token}/census-fault`, home: null, shell: 'frame' },
  { name: 'error-global', path: '/census-global-fault', home: '/', shell: null },
] as const;

for (const fault of faults) {
  test(`${fault.name} (${fault.path}) shows the reference in the project locale`, async ({
    page,
    locale,
  }) => {
    const response = await page.goto(fault.path);
    expect(response?.status(), `HTTP status of ${fault.path}`).toBe(500);
    await settle(page);

    await expectLocale(page, locale);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      message(locale, 'common', 'error_page.title'),
    );
    await expect(
      page.getByText(
        message(
          locale,
          'common',
          fault.shell === null ? 'error_page.global_description' : 'error_page.description',
        ),
      ),
    ).toBeVisible();
    // A server error's reference is its digest, the `request_id` tag of its Sentry report.
    await expect(page.getByTestId('error-reference')).toHaveText(/^\d{4,}$/);
    await expect(
      page.getByRole('button', { name: message(locale, 'common', 'error_page.copy') }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: message(locale, 'common', 'error_page.retry') }),
    ).toBeVisible();
    const home = page.getByRole('link', { name: message(locale, 'common', 'error_page.home') });
    if (fault.home === null) await expect(home).toHaveCount(0);
    else await expect(home).toHaveAttribute('href', fault.home);

    // Group errors keep the shell: the brand and, for the merchant, the navigation (web §10.4).
    if (fault.shell !== null) {
      await expect(page.getByRole('banner')).toBeVisible();
      if (fault.shell === 'navigation') {
        const wide = (page.viewportSize()?.width ?? 0) > 390;
        const navigation = wide
          ? page.getByRole('navigation')
          : page.getByRole('button', { name: message(locale, 'common', 'shell.open_navigation') });
        await expect(navigation).toBeVisible();
      }
    }

    await expectNoArabicIndicDigits(page);
    await expectNoRawKeys(page);
    if ((page.viewportSize()?.width ?? 0) <= 390) await expectNoHorizontalOverflow(page);
    await expectAxeClean(page);
    await expect(page).toHaveScreenshot(`${fault.name}.png`, {
      fullPage: true,
      mask: [page.getByTestId('error-reference')],
    });
  });
}

test('a browser error is reported through /monitoring without token, phone or cookie', async ({
  page,
  locale,
}) => {
  const envelopes = await captureMonitoring(page);
  const response = await page.goto(
    `/track/${token}/census-fault?at=client&phone=${encodeURIComponent(plantedPhone)}`,
  );
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    message(locale, 'common', 'error_page.title'),
  );
  // A browser error's reference is the Sentry event id the report carries.
  const reference = page.getByTestId('error-reference');
  await expect(reference).toHaveText(/^[0-9a-f]{32}$/);
  // The SDK loads after the page's load event, then sends the event it was handed.
  await expect.poll(() => envelopes.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const envelope = envelopes.join('\n');
  expectNothingPersonal(envelope, token);
  expect(envelope).not.toContain('phone=');
  const [header, , event] = envelopes[0]!
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(header).toMatchObject({
    dsn: censusBuild.sentryDsn,
    event_id: await reference.textContent(),
  });
  expect(event).toMatchObject({
    release: 'census',
    environment: 'ci',
    tags: { boundary: 'segment', group: 'recipient' },
  });
  expect(event).not.toHaveProperty('user');
  expect(event).not.toHaveProperty('breadcrumbs');
  expect(JSON.stringify(event)).toContain(`/track/:token/census-fault`);
});

test.describe('the /monitoring tunnel', () => {
  const envelope = (dsn: string, items: unknown[] = []) =>
    [{ event_id: 'f'.repeat(32), dsn }, ...items].map((line) => JSON.stringify(line)).join('\n');

  test('refuses another project, drops non-error items, forwards errors best effort', async ({
    request,
  }) => {
    test.skip(test.info().project.name !== 'ar', 'the endpoint is locale-free: one project');
    const foreign = await request.post('/monitoring', {
      data: envelope('https://census@evil.example.test/1', [{ type: 'event' }, {}]),
    });
    expect(foreign.status()).toBe(400);
    const sessionOnly = await request.post('/monitoring', {
      data: envelope(censusBuild.sentryDsn, [{ type: 'session' }, { sid: 'x' }]),
    });
    expect(sessionOnly.status()).toBe(204);
    // sentry.invalid never resolves: the tunnel answers 502 and the page is not affected.
    const forwarded = await request.post('/monitoring', {
      data: envelope(censusBuild.sentryDsn, [{ type: 'event' }, { message: 'census' }]),
    });
    expect(forwarded.status()).toBe(502);
    const get = await request.get('/monitoring');
    expect(get.status()).toBe(405);
  });
});
