import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl without i18n routing (web §5): the request locale comes from the el_locale cookie.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Self-contained server for the web image (platform §2): .next/standalone/apps/web/server.js.
  output: 'standalone',
  // Trace from the monorepo root so workspace packages and pnpm's store land in the output.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@eeasy-logistics/config', '@eeasy-logistics/i18n', '@eeasy-logistics/ui'],
  // posthog-js posts to /ingest/e/ and similar paths with a trailing slash; without this, each
  // event would first get a 308 to the slashless path (PLAT-14 plan 2.8, PostHog's Next.js
  // proxy guide). Pages still match without the redirect.
  skipTrailingSlashRedirect: true,
  // The one response header this order asserts (plan 2.9); CSP and frame headers per group are
  // WEB-2's (web §3.6).
  headers: () =>
    Promise.resolve([
      { source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] },
    ]),
};

export default withNextIntl(nextConfig);
