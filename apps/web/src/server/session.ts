import 'server-only';
import { ApiError } from '@eeasy-logistics/contracts/http';
import { client, type Me } from '@eeasy-logistics/contracts/staff';
import { pathHeader } from '@eeasy-logistics/ui/session/proxy';
import { signInPath } from '@eeasy-logistics/ui/session/tokens';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { staffServerFetcher } from './api';

/**
 * What the browser gets of `Me` (react `server-serialization`): the ids, names, the email the
 * re-sign-in dialog signs in with, roles, sites, permissions and features; not the phone numbers.
 */
function sessionView(me: Me): Me {
  const { user, membership, account } = me;
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
          },
    membership:
      membership === undefined
        ? undefined
        : {
            id: membership.id,
            created_at: membership.created_at,
            roles: membership.roles,
            site_ids: membership.site_ids,
            status: membership.status,
          },
    account:
      account === undefined
        ? undefined
        : {
            id: account.id,
            created_at: account.created_at,
            name: account.name,
            status: account.status,
          },
    permissions: me.permissions,
    features: me.features,
  };
}

/**
 * `getMe` once per request (web §4; WEB-2 plan 2.3), wrapped in React `cache()` so the layout and
 * any page of the same request share one call. A `401` sends the user to sign-in with the page
 * they asked for (`reason=ended` when they had a session cookie); a suspended account goes to its
 * notice. The proxy has already refreshed a stale access cookie, so a 401 here means the session
 * is over.
 */
export const getStaffSession = cache(async (): Promise<Me> => {
  const [fetcher, jar, incoming] = await Promise.all([staffServerFetcher(), cookies(), headers()]);
  let failure: ApiError;
  try {
    const answer = await client.getMe({ fetcher });
    if (answer.status === 200) return sessionView(answer.data);
    throw new Error(`getMe answered ${answer.status}`);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    failure = error;
  }
  if (failure.status === 401) {
    const hadSession = jar.has('el_staff_at') || jar.has('el_staff_rt');
    redirect(signInPath(incoming.get(pathHeader) ?? '/', hadSession ? 'ended' : undefined));
  }
  if (failure.code === 'account_suspended') redirect('/account-suspended');
  throw failure;
});
