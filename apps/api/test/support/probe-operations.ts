// Real contract operations for test-only probe routes (PLAT-10 plan 2.9): every non-public route
// binds a generated operation of its surface (`OperationRoutesCheck`), and the permission guard
// takes the required permission from it, so the probes use operations of the contracts and the
// test signer's default bundles (owner, driver, platform super admin) hold their permissions.
import { operationSchemas as driver } from '@eeasy-logistics/contracts/driver/schemas';
import { operationSchemas as platform } from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas as recipient } from '@eeasy-logistics/contracts/recipient/schemas';
import { operationSchemas as staff } from '@eeasy-logistics/contracts/staff/schemas';

export const probeOperations = {
  /** `core.auth.anonymous`: a sign-in door, the only kind of operation a public staff route binds. */
  staffDoor: staff.login,
  /** `core.sites.read`: owner, admin, dispatcher, site staff, cashier, viewer. */
  staffRead: staff.listSites,
  /** `core.sites.manage`: owner and admin only. */
  staffWrite: staff.createSite,
  /** `delivery.driver.work`: the driver bundle. */
  driverWork: driver.driverGetMe,
  /** `platform.accounts.read`: every platform bundle. */
  platformRead: platform.platformListAccounts,
  /** `platform.accounts.provision`: super admin and admin. */
  platformWrite: platform.platformProvisionAccount,
  /** `platform.accounts.read`, declared `x-cross-tenant`. */
  platformCrossTenant: platform.platformGetAccount,
  /** `delivery.tracking.view`: granted by the recipient token's purpose, not a role. */
  recipientRead: recipient.recipientGetTracking,
} as const;
