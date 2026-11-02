// The member door rules the screens show before the API applies them (PLAT-12 plan 2.7, 2.8, 2.10,
// §8.2 #27, #41; WEB-3 plan 2.7): nobody changes their own membership, only an owner changes a
// membership that holds or would hold `owner`, and the account's last active owner keeps the role.
// The UI disables the control and names the rule; the API refuses anyway (403 forbidden). Pure and
// free of runtime imports so `node --test` runs it as is.

/** Who acts: the session's membership. */
export interface Caller {
  readonly membershipId: string | undefined;
  readonly roles: readonly string[];
}

/** The membership acted on. */
export interface Target {
  readonly id: string;
  readonly roles: readonly string[];
  readonly status: string | undefined;
}

/** Why a whole membership is locked for the caller: their own, or an owner's for a non-owner. */
export type MemberLock = 'self' | 'owner_only';

/** Why the owner role of a membership cannot be ticked or unticked by the caller. */
export type OwnerRoleLock = 'owner_grant' | 'last_owner';

const isOwner = (roles: readonly string[]) => roles.includes('owner');

/** The lock on changing, revoking or resetting `target`, if any. */
export function memberLock(caller: Caller, target: Target): MemberLock | undefined {
  if (caller.membershipId !== undefined && caller.membershipId === target.id) return 'self';
  if (isOwner(target.roles) && !isOwner(caller.roles)) return 'owner_only';
  return undefined;
}

/**
 * The lock on the owner role of `target`: a non-owner may neither grant nor remove it; the last
 * active owner keeps it (`onlyActiveOwner`: no other active membership holds `owner`).
 */
export function ownerRoleLock(
  caller: Caller,
  target: Target | undefined,
  onlyActiveOwner: boolean,
): OwnerRoleLock | undefined {
  if (!isOwner(caller.roles)) return 'owner_grant';
  if (
    target !== undefined &&
    target.status === 'active' &&
    isOwner(target.roles) &&
    onlyActiveOwner
  ) {
    return 'last_owner';
  }
  return undefined;
}

/** The roles an invitation or an edit may offer: `owner` only to an owner (PLAT-12 2.7). */
export function grantableRoles<Role extends string>(
  caller: Caller,
  roles: readonly Role[],
): { role: Role; locked: boolean }[] {
  return roles.map((role) => ({ role, locked: role === 'owner' && !isOwner(caller.roles) }));
}
