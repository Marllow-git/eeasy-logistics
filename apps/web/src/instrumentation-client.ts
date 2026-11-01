// Runs in the browser before the app hydrates (Next.js `instrumentation-client`): error reports
// (PLAT-14 plan 2.7), loaded after the page's `load` event so they add nothing to first-load
// JavaScript (web §10.2).
const start = () => {
  void import('./observability/sentry-client').then(({ startSentryClient }) => startSentryClient());
};

if (document.readyState === 'complete') start();
else window.addEventListener('load', start, { once: true });
