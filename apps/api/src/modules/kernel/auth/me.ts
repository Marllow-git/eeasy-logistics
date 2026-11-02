import { ApiException } from '../errors/api-exception.js';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { visibleFeatures } from '../features/feature-rules.js';
import { featureStateIn } from '../platform/features.repository.js';
import type {
  IdentityTransaction,
  MembershipRow,
  PlatformStaffRow,
  UserRow,
} from '../platform/identity.repository.js';
import type { Principal } from './principal.js';

// `Me` and `PlatformMe` (PLAT-11 plan 2.4; components.yaml `Me`, platform.yaml `PlatformMe`): the
// user, the membership and its account (staff), the permissions the session's roles grant (PLAT-10
// `PermissionResolver`, the same grants the guard enforces) and the visible features (PLAT-13 plan
// 2.5: K-6 over the rollout modes and the account's flags, the rules the feature gate applies).

export interface StaffMeView {
  readonly user: UserRow;
  readonly membership: MembershipRow;
  readonly permissions: readonly string[];
  readonly features: readonly string[];
}

export interface PlatformMeView {
  readonly user: UserRow;
  readonly staff: PlatformStaffRow;
  readonly permissions: readonly string[];
}

/** The permissions a principal's roles grant, sorted; none without a resolver. */
export function permissionsOf(
  resolver: Pick<PermissionResolver, 'grantsOf'> | undefined,
  principal: Principal,
): string[] {
  if (resolver === undefined) throw new ApiException('internal_error');
  return [...resolver.grantsOf(principal).keys()].sort();
}

/** The staff principal a session's claims make, for the permissions of a fresh `Me`. */
export function staffPrincipal(
  userId: string,
  membership: Pick<MembershipRow, 'id' | 'accountId' | 'roles' | 'siteIds'>,
  tokenVersion: number,
): Principal {
  return {
    kind: 'staff',
    userId,
    accountId: membership.accountId,
    membershipId: membership.id,
    roles: membership.roles,
    sites: membership.siteIds,
    scopes: '',
    tokenVersion,
  };
}

/** The feature keys visible to `accountId` (K-6), read in the identity transaction. */
export async function featuresOf(tx: IdentityTransaction, accountId: string): Promise<string[]> {
  const { modes, flags } = await featureStateIn(tx.uow, accountId);
  return visibleFeatures(modes, flags);
}

/** `Me` of a staff principal; `401 unauthenticated` when its user or membership is gone. */
export async function staffMe(
  tx: IdentityTransaction,
  principal: Principal,
  resolver: Pick<PermissionResolver, 'grantsOf'> | undefined,
): Promise<StaffMeView> {
  if (principal.kind !== 'staff') throw new ApiException('unauthenticated');
  const user = await tx.users.find(principal.userId);
  const membership = await tx.memberships.findOfUser(principal.membershipId, principal.userId);
  if (
    user === undefined ||
    membership === undefined ||
    membership.accountId !== principal.accountId
  ) {
    throw new ApiException('unauthenticated');
  }
  return {
    user,
    membership,
    permissions: permissionsOf(resolver, principal),
    features: await featuresOf(tx, membership.accountId),
  };
}

/** `PlatformMe` of a platform principal; `401 unauthenticated` when the staff row is gone. */
export async function platformMe(
  tx: IdentityTransaction,
  principal: Principal,
  resolver: Pick<PermissionResolver, 'grantsOf'> | undefined,
): Promise<PlatformMeView> {
  if (principal.kind !== 'platform') throw new ApiException('unauthenticated');
  const user = await tx.users.find(principal.userId);
  const staff = await tx.platformStaff.find(principal.userId);
  if (user === undefined || staff === undefined) throw new ApiException('unauthenticated');
  return { user, staff, permissions: permissionsOf(resolver, principal) };
}
