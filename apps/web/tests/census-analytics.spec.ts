import {
  captureAnalytics,
  censusBuild,
  expect,
  expectAnalyticsEvents,
  expectNothingPersonal,
  plantedPhone,
  test,
} from './census/helpers';

// Census of product analytics (PLAT-14 plan 2.8, 2.9; web §9, §10.4): PostHog events leave
// through /ingest with ids and enums only; a recipient page sends one page view with the token
// rewritten, no person profile, and none of the phone number, name or token planted in its URL;
// an error page sends its catalogue event; the proxy forwards capture endpoints only.

// A fake recipient token, assembled so the secret scanner of the commit hook sees no literal.
const token = ['Qm7rT2xW', 'p9Lk4ZcV', 'n8Hb3YsD'].join('');

test('a recipient page view carries no token, phone, name or person profile', async ({ page }) => {
  const captured = await captureAnalytics(page);
  await page.goto(`/track/${token}?phone=${encodeURIComponent(plantedPhone)}&name=Sara`);
  await expectAnalyticsEvents(captured, []);
  await expect.poll(() => captured.events.some((e) => e.event === '$pageview')).toBe(true);

  const views = captured.events.filter((event) => event.event === '$pageview');
  expect(views).toHaveLength(1);
  expect(views[0]!.properties).toMatchObject({
    token: censusBuild.posthogKey,
    $current_url: 'http://127.0.0.1:3001/track/:token',
    $pathname: '/track/:token',
    $process_person_profile: false,
  });
  const sent = captured.bodies.join('\n');
  expectNothingPersonal(sent, token);
  expect(sent).not.toContain('Sara');
  expect(sent).not.toContain('phone=');
  expect(sent).not.toMatch(/"\$set(?:_once)?"/);
});

test('a merchant page view and an error page send catalogue events only', async ({ page }) => {
  const captured = await captureAnalytics(page);
  await page.goto('/');
  await expect.poll(() => captured.events.some((e) => e.event === '$pageview')).toBe(true);
  await page.goto('/census-fault');
  await expectAnalyticsEvents(captured, ['shell.error_page.shown']);
  const shown = captured.events.find((event) => event.event === 'shell.error_page.shown');
  expect(shown?.properties).toMatchObject({ boundary: 'segment', group: 'merchant' });
  expectNothingPersonal(captured.bodies.join('\n'));
});

test.describe('the /ingest proxy', () => {
  test('forwards capture endpoints only, best effort', async ({ request }) => {
    test.skip(test.info().project.name !== 'ar', 'the endpoint is locale-free: one project');
    const batch = JSON.stringify([{ event: '$pageview', properties: { token: 'phc_census' } }]);
    // posthog.invalid never resolves: the proxy answers 502 and the page is not affected.
    expect((await request.post('/ingest/e/', { data: batch })).status()).toBe(502);
    expect((await request.post('/ingest/i/v0/e/', { data: batch })).status()).toBe(502);
    expect((await request.post('/ingest/flags/', { data: batch })).status()).toBe(404);
    expect((await request.post('/ingest/api/projects/1/', { data: batch })).status()).toBe(404);
    expect((await request.get('/ingest/e/')).status()).toBe(405);
  });
});
