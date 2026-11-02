import { isDevelopmentServer, publicConfig } from '@eeasy-logistics/config/web';
import { webServerConfig } from '@eeasy-logistics/config/web-server';
import { client } from '@eeasy-logistics/contracts/staff';
import { createSessionProxy, type ProxyGroup } from '@eeasy-logistics/ui/session/proxy';
import type { NextRequest } from 'next/server';

// The proxy of apps/web (Next.js 16's name for middleware; web §3.2, §3.6; WEB-2 plan 2.2, 2.6):
// the security headers with a nonce on every page, and the staff session refreshed on a navigation
// under (merchant). (auth) and (recipient) never refresh; the recipient pages send no referrer.

/** The (auth) pages (web §1) and the notices around a session. */
const authPaths =
  /^\/(?:sign-in|signed-out|account-suspended|password-reset|invitations|second-factor)(?:\/|$)/;
const recipientPaths = /^\/(?:track|reschedule|pin|embed)\//;
const otherPaths = /^\/census-global-fault(?:\/|$)/;

/** The route group of a path of this app. */
export function webGroupOf(pathname: string): ProxyGroup {
  if (authPaths.test(pathname)) return 'auth';
  if (recipientPaths.test(pathname)) return 'recipient';
  if (otherPaths.test(pathname)) return 'other';
  return 'session';
}

let built: ReturnType<typeof createSessionProxy> | undefined;

function build() {
  const server = webServerConfig('web');
  // The public configuration is optional here: an image built without NEXT_PUBLIC_APP_ENV still
  // serves pages with the headers (no storage source then).
  let storageOrigin: string | undefined;
  try {
    storageOrigin = publicConfig().storageOrigin;
  } catch {
    storageOrigin = undefined;
  }
  return createSessionProxy({
    cookies: { access: 'el_staff_at', refresh: 'el_staff_rt' },
    refreshPath: client.getRefreshSessionUrl(),
    apiInternalUrl: server.apiInternalUrl,
    publicOrigin: server.publicOrigin,
    groupOf: webGroupOf,
    suspendedPath: '/account-suspended',
    storageOrigin,
    development: isDevelopmentServer(),
    hsts: server.appEnv === 'staging' || server.appEnv === 'production',
  });
}

export function proxy(request: NextRequest) {
  built ??= build();
  return built(request);
}

// Not the API (the edge or the rewrite sends it on), Next's assets, the Sentry and PostHog routes,
// the health route or static files.
export const config = {
  matcher: [
    '/((?!v1/|_next/static|_next/image|ingest|monitoring|healthz|favicon\\.ico|.*\\.(?:png|svg|ico|webp|jpg|jpeg|woff2?|txt|xml)$).*)',
  ],
};
