import { ApiException } from '../errors/api-exception.js';

// Separation of duties (PLAT-10 plan 2.7; identity and tenancy §2; errors.md §2, §4). The ledgers
// need two of them: the role that confirms a cash handover is never the role that holds the cash
// (M9), and nobody approves what they counted or requested (W-16). Both are pure checks for the
// orders that write memberships (PLAT-12) and approvals (WMS orders).

/** The cash permissions of a bundle make it a cash role (`delivery.cash.*`). */
const cashPrefix = 'delivery.cash.';

/**
 * Refuses a membership's role list that combines `driver` with any role holding a cash permission:
 * `422 role_combination_forbidden` (M9). `bundles` is the resolver's map (`PermissionResolver
 * .bundles`); a role it does not know is left to the caller's own validation.
 */
export function assertRoleCombination(
  roles: readonly string[],
  bundles: ReadonlyMap<string, { readonly permissions: ReadonlySet<string> }>,
): void {
  if (!roles.includes('driver')) return;
  for (const role of roles) {
    if (role === 'driver') continue;
    const permissions = bundles.get(role)?.permissions;
    if (permissions === undefined) continue;
    for (const permission of permissions) {
      if (permission.startsWith(cashPrefix)) {
        throw new ApiException('role_combination_forbidden');
      }
    }
  }
}

/** The people of one approval: user ids, `null` or absent where the flow has no such step. */
export interface ApprovalParties {
  readonly approver: string;
  readonly counter?: string | null;
  readonly requester?: string | null;
}

/**
 * Refuses an approval by the person who counted or requested it: `403 separation_of_duties`
 * (W-16; the stock-adjustment threshold that decides when an approval is needed is wave 3's).
 */
export function assertSeparation({ approver, counter, requester }: ApprovalParties): void {
  if (approver === counter || approver === requester) {
    throw new ApiException('separation_of_duties');
  }
}
