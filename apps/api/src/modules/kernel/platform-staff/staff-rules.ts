import type { PlatformStaffRole } from '../schema/identity.js';

// The platform staff rules (PLAT-13 plan 2.9; identity and tenancy §3.3; ADR-0006): super-admin
// rights come only from a super admin, nobody changes or resets themselves, and the last super
// admin keeps the role. The caller's role here is the one stored now (the staff row), never the
// token's, so a role removed since the token was minted no longer counts. Every refusal is `403
// forbidden` with no detail (PLAT-10); the reason is logged for the operator.

/** The contract's `PlatformRole` values and the stored roles they name. */
export const contractRoles: Readonly<Record<string, PlatformStaffRole>> = Object.freeze({
  platform_super_admin: 'super_admin',
  platform_admin: 'admin',
  platform_support: 'support',
});

export function contractRoleOf(role: PlatformStaffRole): string {
  return `platform_${role}`;
}

export type StaffRefusal =
  'self' | 'super_admin_by_super_admin_only' | 'last_super_admin' | 'super_admin_only';

/** `platformInviteStaff`: only a super admin invites a super admin. */
export function inviteRefusal(
  callerRole: PlatformStaffRole,
  invited: PlatformStaffRole,
): StaffRefusal | undefined {
  return invited === 'super_admin' && callerRole !== 'super_admin'
    ? 'super_admin_by_super_admin_only'
    : undefined;
}

export interface RoleChange {
  readonly callerId: string;
  readonly callerRole: PlatformStaffRole;
  readonly targetId: string;
  /** The target's live role, or null when its row is revoked. */
  readonly current: PlatformStaffRole | null;
  /** The new role, or null to revoke (`roles: []`). */
  readonly next: PlatformStaffRole | null;
  /** Live super admins now, the target included when it is one. */
  readonly liveSuperAdmins: number;
}

/**
 * `platformSetStaffRoles`: never on oneself; granting or removing `super_admin` only by a super
 * admin; the last live super admin cannot lose the role.
 */
export function roleChangeRefusal(change: RoleChange): StaffRefusal | undefined {
  if (change.callerId === change.targetId) return 'self';
  const touchesSuperAdmin = (change.current === 'super_admin') !== (change.next === 'super_admin');
  if (touchesSuperAdmin && change.callerRole !== 'super_admin') {
    return 'super_admin_by_super_admin_only';
  }
  if (
    change.current === 'super_admin' &&
    change.next !== 'super_admin' &&
    change.liveSuperAdmins <= 1
  ) {
    return 'last_super_admin';
  }
  return undefined;
}

/** `platformResetStaffTotp`: a super admin only, never on oneself. */
export function totpResetRefusal(
  callerId: string,
  callerRole: PlatformStaffRole,
  targetId: string,
): StaffRefusal | undefined {
  if (callerId === targetId) return 'self';
  return callerRole === 'super_admin' ? undefined : 'super_admin_only';
}
