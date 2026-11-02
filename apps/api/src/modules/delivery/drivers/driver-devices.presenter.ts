import type { DriverDevice } from '@eeasy-logistics/contracts/staff/schemas';
import type { DriverDeviceRow } from './drivers.repository.js';

/**
 * `DriverDevice` (components.yaml; domain model §3.5) as the staff surface shows it: the push token
 * is left out (data §10: a dispatcher needs whether a device is live, not its push address; the
 * field is optional in the contract).
 */
export function presentDriverDevice(row: DriverDeviceRow): DriverDevice {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    device_id: row.deviceId,
    platform: row.platform,
    app_version: row.appVersion,
    revoked_at: row.revokedAt?.toISOString() ?? null,
  };
}
