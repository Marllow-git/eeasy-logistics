import type { StaffRole } from '@eeasy-logistics/contracts/staff';

/** The roles grantable on the staff surface, in the contract's order (`StaffRole`; no driver). */
export const staffRoles = [
  'owner',
  'admin',
  'dispatcher',
  'site_staff',
  'warehouse_staff',
  'cashier',
  'viewer',
] as const satisfies readonly StaffRole[];

// A role the contract adds fails typecheck here until it is listed (and labelled in `settings.roles`).
type Unlisted = Exclude<StaffRole, (typeof staffRoles)[number]>;
export const everyStaffRoleListed: [Unlisted] extends [never] ? true : never = true;
