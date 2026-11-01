import { ApiException } from '../errors/api-exception.js';

// Separation of duties (PLAT-10 plan 2.7; identity and tenancy §2; errors.md §2, §4). The ledgers
// need two of them: the role that confirms a cash handover is never the role that holds the cash
// (M9), and nobody approves what they counted or requested (W-16). Both are pure checks for the
// orders that write memberships (PLAT-12) and approvals (WMS orders).

/**
 * The cash-handling permissions (M9, lead ruling on PR #70): receiving, depositing and closing
 * cash, and recording driver liability. Reading cash (`delivery.cash.read`) handles none, so a
 * viewer or dispatcher may also be a driver.
 */
export const cashHandlingPermissions: ReadonlySet<string> = new Set([
  'delivery.cash.receive',
  'delivery.cash.deposit',
  'delivery.cash.close_report',
  'delivery.liability.record',
]);

/**
 * Refuses a membership's role list that combines `driver` with any role holding a cash-handling
 * permission: `422 role_combination_forbidden` (M9). `bundles` is the resolver's map
 * (`PermissionResolver.bundles`); a role it does not know is left to the caller's own validation.
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
      if (cashHandlingPermissions.has(permission)) {
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
