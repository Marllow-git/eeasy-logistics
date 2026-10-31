import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ['@eeasy-logistics/config', '@eeasy-logistics/i18n'],
};

export default nextConfig;
