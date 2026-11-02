import path from 'node:path';
import { webServerConfig } from '@eeasy-logistics/config/web-server';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// next-intl without i18n routing (web §5): the request locale comes from the el_locale cookie.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// WEB-2 plan 2.1: the browser calls the API on this origin (ADR-0032). In production the edge routes
// /v1/staff/* and /v1/recipient/* to the API before this app sees them; locally, in the census and
// in CI the rewrite below does the same, so the browser is same-origin everywhere and no CORS is
// ever enabled. Next writes rewrites into the build, so the build needs API_INTERNAL_URL; without it
// there is none. /v1/platform/* is never rewritten here: it is the console's (ADR-0038) and
// answers 404 from this app, as the edge would.
const apiInternalUrl = webServerConfig('web').apiInternalUrl;
const apiSurfaces = ['staff', 'recipient'] as const;

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
  rewrites: () =>
    Promise.resolve(
      apiInternalUrl === undefined
        ? []
        : apiSurfaces.map((surface) => ({
            source: `/v1/${surface}/:path*`,
            destination: `${apiInternalUrl}/v1/${surface}/:path*`,
          })),
    ),
  // nosniff on everything, static files and route handlers included; the pages' CSP and frame
  // headers come from src/proxy.ts with a nonce per request (WEB-2 plan 2.6, web §3.6).
  headers: () =>
    Promise.resolve([
      { source: '/:path*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] },
    ]),
};

export default withNextIntl(nextConfig);
