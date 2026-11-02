import 'server-only';
import { ApiError } from '@eeasy-logistics/contracts/http';
import { client, type PlatformMe } from '@eeasy-logistics/contracts/platform';
import { pathHeader } from '@eeasy-logistics/ui/session/proxy';
import { signInPath } from '@eeasy-logistics/ui/session/tokens';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { platformServerFetcher } from './api';

/**
 * What the browser gets of `PlatformMe` (react `server-serialization`): the ids, the name, the
 * email the re-sign-in dialog signs in with, the roles and permissions; not the phone.
 */
function sessionView(me: PlatformMe): PlatformMe {
  const { user } = me;
  return {
    user:
      user === undefined
        ? undefined
        : {
            id: user.id,
            created_at: user.created_at,
            name: user.name,
            email: user.email,
            locale: user.locale,
            roles: user.roles,
            totp_enrolled: user.totp_enrolled,
          },
    permissions: me.permissions,
  };
}

/**
 * `platformGetMe` once per request (web §4; WEB-2 plan 2.3, 2.9), wrapped in React `cache()` so the
 * layout and any page of the same request share one call. Without an access cookie the user goes
 * to sign-in with the page they asked for, without calling the API; a `401` does the same with
 * `reason=ended` (the 12 h idle end of a console session lands there too, PLAT-11 2.9). The proxy
 * has already refreshed a stale access cookie, so a 401 here means the session is over. Platform
 * staff belong to no account, so there is no suspended case.
 */
export const getPlatformSession = cache(async (): Promise<PlatformMe> => {
  const [jar, incoming] = await Promise.all([cookies(), headers()]);
  if (!jar.has('el_platform_at')) redirect(signInPath(incoming.get(pathHeader) ?? '/'));
  const fetcher = await platformServerFetcher();
  let failure: ApiError;
  try {
    const answer = await client.platformGetMe({ fetcher });
    if (answer.status === 200) return sessionView(answer.data);
    throw new Error(`platformGetMe answered ${answer.status}`);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    failure = error;
  }
  if (failure.status === 401) redirect(signInPath(incoming.get(pathHeader) ?? '/', 'ended'));
  throw failure;
});
