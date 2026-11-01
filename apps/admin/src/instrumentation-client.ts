// Runs in the browser before the app hydrates (Next.js `instrumentation-client`): error reports
// (PLAT-14 plan 2.7) and product analytics (plan 2.8), both loaded after the page's `load` event
// as their own chunks, so they add nothing to first-load JavaScript (web §10.2).
const start = () => {
  void import('./observability/sentry-client').then(({ startSentryClient }) => startSentryClient());
  void import('./observability/analytics-client').then(({ startAnalytics }) => startAnalytics());
};

if (document.readyState === 'complete') start();
else window.addEventListener('load', start, { once: true });
