import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server for the web image (platform §2): .next/standalone/apps/web/server.js.
  output: 'standalone',
  // Trace from the monorepo root so workspace packages and pnpm's store land in the output.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@eeasy-logistics/config', '@eeasy-logistics/i18n'],
};

export default nextConfig;
