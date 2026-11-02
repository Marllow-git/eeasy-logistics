import type { UnitOfWork } from '@eeasy-logistics/db';
import { getContext } from '@eeasy-logistics/db';
import { ApiException } from '../../kernel/public/index.js';
import type { DriverDeviceRow, DriverRow } from './drivers.repository.js';
import { DriverDevicesRepository, DriversRepository } from './drivers.repository.js';

// The signed-in driver behind a bearer token (DEL-4 plan 2.8, 2.9; adversary M-2). An access token
// lives 15 minutes after a suspension or a device revocation, so every driver door that reads the
// driver re-checks both on the rows: the membership's driver (another account's never matches)
// must be `active`, and the token's device row must exist and not be revoked.

/**
 * The token's driver and device: no driver row is `404`; a driver not `active` is `401
 * token_invalid`; a revoked or vanished device is `401 device_revoked` (as at refresh).
 */
export async function tokenDriver(
  uow: UnitOfWork,
): Promise<{ driver: DriverRow; device: DriverDeviceRow }> {
  const { membershipId, deviceId } = getContext();
  if (membershipId === null || deviceId === null) throw new ApiException('unauthenticated');
  const driver = await new DriversRepository(uow).findOfMembership(membershipId);
  if (driver === undefined) throw new ApiException('not_found');
  if (driver.status !== 'active') throw new ApiException('token_invalid');
  const device = await new DriverDevicesRepository(uow).find(driver.id, deviceId);
  if (device === undefined || device.revokedAt !== null) throw new ApiException('device_revoked');
  return { driver, device };
}
