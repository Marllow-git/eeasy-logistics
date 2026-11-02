import { isDevelopmentServer, publicConfig } from '@eeasy-logistics/config/web';
import { webServerConfig } from '@eeasy-logistics/config/web-server';
import { client } from '@eeasy-logistics/contracts/platform';
import { createSessionProxy, type ProxyGroup } from '@eeasy-logistics/ui/session/proxy';
import type { NextRequest } from 'next/server';

// The proxy of apps/admin (web §3.2, §3.5, §3.6; ADR-0038; WEB-2 plan 2.2, 2.6): the security
// headers with a nonce on every page, and the platform session (its own cookies, host-only on the
// admin hostname) refreshed on a navigation under (platform). (auth) never refreshes.

const authPaths = /^\/(?:sign-in|signed-out|invitations|totp)(?:\/|$)/;
const otherPaths = /^\/census-global-fault(?:\/|$)/;

/** The route group of a path of the console. */
export function adminGroupOf(pathname: string): ProxyGroup {
  if (authPaths.test(pathname)) return 'auth';
  if (otherPaths.test(pathname)) return 'other';
  return 'session';
}

let built: ReturnType<typeof createSessionProxy> | undefined;

function build() {
  const server = webServerConfig('admin');
  let storageOrigin: string | undefined;
  try {
    storageOrigin = publicConfig().storageOrigin;
  } catch {
    storageOrigin = undefined;
  }
  return createSessionProxy({
    cookies: { access: 'el_platform_at', refresh: 'el_platform_rt' },
    refreshPath: client.getPlatformRefreshUrl(),
    apiInternalUrl: server.apiInternalUrl,
    publicOrigin: server.publicOrigin,
    groupOf: adminGroupOf,
    // Platform staff belong to no account; a 403 there is not a suspension, so this is never used
    // in practice and lands on sign-in.
    suspendedPath: '/sign-in',
    storageOrigin,
    development: isDevelopmentServer(),
    hsts: server.appEnv === 'staging' || server.appEnv === 'production',
  });
}

export function proxy(request: NextRequest) {
  built ??= build();
  return built(request);
}

export const config = {
  matcher: [
    '/((?!v1/|_next/static|_next/image|ingest|monitoring|healthz|favicon\\.ico|.*\\.(?:png|svg|ico|webp|jpg|jpeg|woff2?|txt|xml)$).*)',
  ],
};
