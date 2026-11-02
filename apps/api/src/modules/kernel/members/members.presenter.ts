import type { Membership, Role } from '@eeasy-logistics/contracts/staff/schemas';
import type { Member } from './members.service.js';

/**
 * `Membership` (components.yaml) with its `User` (PLAT-12 plan 2.7): the person the membership shows
 * (`MembersService`: the user's stored fields once `active`, the invitation's before; adversary
 * M-2), `phone` null (staff sign in by email; the second-factor phone is never shown). Never a
 * password hash or a token version.
 */
export function presentMember({ row, person }: Member): Membership {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    user: {
      id: person.id,
      created_at: person.createdAt.toISOString(),
      updated_at: person.updatedAt.toISOString(),
      name: person.name,
      email: person.email,
      phone: null,
      locale: person.locale,
      second_factor_enabled: person.secondFactorEnabled,
    },
    // Membership roles are bundle keys of the staff surface; the contract's `Role` enum lists them.
    roles: row.roles as Role[],
    site_ids: [...row.siteIds],
    status: row.status,
  };
}
