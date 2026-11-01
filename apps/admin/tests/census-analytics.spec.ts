import {
  captureAnalytics,
  censusBuild,
  expect,
  expectAnalyticsEvents,
  expectNothingPersonal,
  plantedPhone,
  test,
} from './census/helpers';

// Census of the console's product analytics, the checks of apps/web's census-analytics.spec.ts
// (PLAT-14 plan 2.8, 2.9; web §10.4): PostHog events leave through /ingest with ids and enums
// only, a page view carries no query string, phone number or person profile, an error page sends
// its catalogue event, and the proxy forwards capture endpoints only.

test('a console page view and an error page send catalogue events only', async ({ page }) => {
  const captured = await captureAnalytics(page);
  await page.goto(`/?phone=${encodeURIComponent(plantedPhone)}&name=Sara`);
  await expect.poll(() => captured.events.some((e) => e.event === '$pageview')).toBe(true);
  expect(captured.events.find((e) => e.event === '$pageview')?.properties).toMatchObject({
    token: censusBuild.posthogKey,
    $current_url: 'http://127.0.0.1:3002/',
    $process_person_profile: false,
  });
  await page.goto('/census-fault');
  await expectAnalyticsEvents(captured, ['shell.error_page.shown']);
  const shown = captured.events.find((event) => event.event === 'shell.error_page.shown');
  expect(shown?.properties).toMatchObject({ boundary: 'segment', group: 'platform' });
  const sent = captured.bodies.join('\n');
  expectNothingPersonal(sent);
  expect(sent).not.toContain('Sara');
  expect(sent).not.toContain('phone=');
});

test.describe('the /ingest proxy', () => {
  test('forwards capture endpoints only, best effort', async ({ request }) => {
    test.skip(test.info().project.name !== 'ar', 'the endpoint is locale-free: one project');
    const batch = JSON.stringify([{ event: '$pageview', properties: { token: 'phc_census' } }]);
    // posthog.invalid never resolves: the proxy answers 502 and the page is not affected.
    expect((await request.post('/ingest/e/', { data: batch })).status()).toBe(502);
    expect((await request.post('/ingest/flags/', { data: batch })).status()).toBe(404);
    expect((await request.get('/ingest/e/')).status()).toBe(405);
  });
});
