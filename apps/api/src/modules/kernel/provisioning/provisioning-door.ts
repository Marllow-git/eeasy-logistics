import { getContext } from '@eeasy-logistics/db';
import { ApiException } from '../errors/api-exception.js';
import { doorAccountStore } from '../platform/accounts.repository.js';

/**
 * The account a provisioning door names may still be set up (DEL-1 plan 2.6; ADR-0015): a
 * `provisioned`, `active` or `suspended` account accepts its first site, zones and coverage; a
 * `closed` one answers `409 invalid_transition` with its status and version. Read on the
 * cross-tenant door's own platform transaction (PLAT-13 lead ruling on 8.2 #11), no lock: the
 * closure door and this one serialise on nothing they both write.
 */
export async function assertProvisionable(): Promise<void> {
  const accountId = getContext().accountId;
  const account = await doorAccountStore().run((accounts) => accounts.find(accountId));
  if (account === undefined) throw new ApiException('not_found');
  if (account.status === 'closed') {
    throw new ApiException('invalid_transition', {
      details: { current_status: account.status, version: account.version },
    });
  }
}
