import type { DriverDevice } from '@eeasy-logistics/contracts/staff/schemas';
import type { DriverDeviceRow } from './drivers.repository.js';

/**
 * `DriverDevice` (components.yaml; domain model §3.5) as the staff surface shows it: the push token
 * and the app's device id are left out (data §10: a dispatcher needs whether a device is live, not
 * its push address or the app's install id, adversary M-3; both fields are optional in the
 * contract). The driver's own answer keeps both (`presentOwnDevice`).
 */
export function presentDriverDevice(row: DriverDeviceRow): DriverDevice {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    platform: row.platform,
    app_version: row.appVersion,
    revoked_at: row.revokedAt?.toISOString() ?? null,
  };
}
