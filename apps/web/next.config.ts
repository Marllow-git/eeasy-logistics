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
};

export default withNextIntl(nextConfig);
