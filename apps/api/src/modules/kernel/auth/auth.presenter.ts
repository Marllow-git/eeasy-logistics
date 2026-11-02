import type { PlatformMe, PlatformRole } from '@eeasy-logistics/contracts/platform/schemas';
import type { LoginResponse, Me, Role, User } from '@eeasy-logistics/contracts/staff/schemas';
import type { MembershipRow, UserRow } from '../platform/identity.repository.js';
import type { PlatformMeView, StaffMeView } from './me.js';
import type { SignInStep } from './sign-in.js';

// Contract shapes of the auth doors (PLAT-11; A-17: contract types only in controllers and
// presenters). Never a password hash, a token version or a second-factor phone.

export function presentUser(user: UserRow): User {
  return {
    id: user.id,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    locale: user.locale,
    second_factor_enabled: user.secondFactorEnabled,
  };
}

/** Membership roles are bundle keys of the staff surface; the contract's `Role` enum lists them. */
function presentRoles(roles: readonly string[]): Role[] {
  return roles as Role[];
}

function presentMembership(
  membership: MembershipRow,
  user: UserRow,
): NonNullable<Me['membership']> {
  return {
    id: membership.id,
    created_at: membership.createdAt.toISOString(),
    updated_at: membership.updatedAt.toISOString(),
    user: presentUser(user),
    roles: presentRoles(membership.roles),
    site_ids: [...membership.siteIds],
    status: membership.status,
  };
}

export function presentMe(view: StaffMeView): Me {
  const { account } = view.membership;
  return {
    user: presentUser(view.user),
    membership: presentMembership(view.membership, view.user),
    account: {
      id: account.id,
      created_at: account.createdAt.toISOString(),
      updated_at: account.updatedAt.toISOString(),
      name: account.name,
      status: account.status as NonNullable<NonNullable<Me['account']>['status']>,
    },
    permissions: [...view.permissions],
    features: [...view.features],
  };
}

export function presentPlatformMe(view: PlatformMeView): PlatformMe {
  return {
    user: {
      ...presentUser(view.user),
      roles: [`platform_${view.staff.role}` as PlatformRole],
      totp_enrolled: view.staff.totpEnrolled,
    },
    permissions: [...view.permissions],
  };
}

/** `LoginResponse` (staff.yaml): exactly one of the session, the selection or a factor step. */
export function presentLoginStep(step: SignInStep): LoginResponse {
  const none = {
    second_factor_required: false,
    account_selection_required: false,
    enrolment_required: false,
  };
  switch (step.kind) {
    case 'session':
      return { ...none, me: presentMe(step.me) };
    case 'selection':
      return {
        ...none,
        account_selection_required: true,
        selection_token: step.selectionToken,
        memberships: step.memberships.map((membership) => ({
          membership_id: membership.id,
          account_id: membership.accountId,
          account_name: membership.account.name,
          roles: presentRoles(membership.roles),
        })),
        me: null,
      };
    case 'second_factor':
      return { ...none, second_factor_required: true, challenge_id: step.challengeId, me: null };
    case 'enrolment':
      return { ...none, enrolment_required: true, enrolment_token: step.enrolmentToken, me: null };
  }
}
