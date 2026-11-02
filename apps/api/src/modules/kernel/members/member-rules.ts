import type { MembershipStatus } from '../schema/identity.js';

// The owner rules of a membership change (PLAT-12 plan 2.8, §7 #4; identity and tenancy §2, §6):
// nobody changes or revokes their own membership; only an owner grants `owner`, and only an owner
// changes a membership that holds it in any way (roles, sites, revocation, second-factor reset;
// adversary M-3, L-1); the last active owner keeps it. Every refusal is `403 forbidden`, which
// carries no detail (PLAT-10); the reason is for the tests and the log.

export type MemberChangeRefusal = 'self' | 'owner_rule' | 'last_owner';

export interface MemberChange {
  /** The caller's membership as stored now (not the token's roles). */
  readonly caller: { readonly id: string; readonly roles: readonly string[] };
  readonly target: {
    readonly id: string;
    readonly roles: readonly string[];
    readonly status: MembershipStatus;
  };
  /** The target's roles after an update (its roles as they are for a factor reset). */
  readonly roles: readonly string[];
  readonly revoking: boolean;
  /** The account's `active` memberships holding `owner`, read under the write lock. */
  readonly activeOwners: number;
}

export function memberChangeRefusal(change: MemberChange): MemberChangeRefusal | undefined {
  const { caller, target } = change;
  if (target.id === caller.id) return 'self';
  const wasOwner = target.roles.includes('owner');
  const staysOwner = !change.revoking && change.roles.includes('owner');
  if ((wasOwner || staysOwner) && !caller.roles.includes('owner')) return 'owner_rule';
  if (wasOwner && !staysOwner && target.status === 'active' && change.activeOwners <= 1) {
    return 'last_owner';
  }
  return undefined;
}
