import type { Membership, Role } from '@eeasy-logistics/contracts/staff/schemas';
import type { UserRow } from '../platform/identity.repository.js';
import type { MemberRow } from './members.repository.js';

/**
 * `Membership` (components.yaml) with its `User` (PLAT-12 plan 2.7): the email, `phone` null (staff
 * sign in by email; the second-factor phone is never shown), `second_factor_enabled`. Never a
 * password hash or a token version.
 */
export function presentMember(member: MemberRow, user: UserRow): Membership {
  return {
    id: member.id,
    created_at: member.createdAt.toISOString(),
    updated_at: member.updatedAt.toISOString(),
    user: {
      id: user.id,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
      name: user.name,
      email: user.email,
      phone: null,
      locale: user.locale,
      second_factor_enabled: user.secondFactorEnabled,
    },
    // Membership roles are bundle keys of the staff surface; the contract's `Role` enum lists them.
    roles: member.roles as Role[],
    site_ids: [...member.siteIds],
    status: member.status,
  };
}
