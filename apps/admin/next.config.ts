import path from 'node:path';
import { webServerConfig } from '@eeasy-logistics/config/web-server';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl without i18n routing (web §5): the request locale comes from the el_locale cookie.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// WEB-2 plan 2.1 (ADR-0032, ADR-0038): the console calls /v1/platform/* on its own origin. In
// production the edge routes it to the API on the admin hostname only; locally, in the census and
// in CI this rewrite does the same (written into the build, so the build needs API_INTERNAL_URL).
// /v1/staff/* and /v1/recipient/* are never rewritten here: they answer 404 from the console.
const apiInternalUrl = webServerConfig('admin').apiInternalUrl;

const nextConfig: NextConfig = {
  // Self-contained server for the admin image (platform §2): .next/standalone/apps/admin/server.js.
  output: 'standalone',
  // Trace from the monorepo root so workspace packages and pnpm's store land in the output.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@eeasy-logistics/config', '@eeasy-logistics/i18n', '@eeasy-logistics/ui'],
  // posthog-js posts to /ingest/e/ and similar paths with a trailing slash; without this, each
  // event would first get a 308 to the slashless path (PLAT-14 plan 2.8, PostHog's Next.js
  // proxy guide). Pages still match without the redirect.
  skipTrailingSlashRedirect: true,
  rewrites: () =>
    Promise.resolve(
      apiInternalUrl === undefined
        ? []
        : [{ source: '/v1/platform/:path*', destination: `${apiInternalUrl}/v1/platform/:path*` }],
    ),
  // nosniff on everything, static files and route handlers included; the pages' CSP and frame
  // headers come from src/proxy.ts with a nonce per request (WEB-2 plan 2.6, web §3.6).
  headers: () =>
    Promise.resolve([
      { source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] },
    ]),
};

export default withNextIntl(nextConfig);
