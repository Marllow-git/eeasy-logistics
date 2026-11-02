import type { AppDatabase } from '@eeasy-logistics/db';
import { getUnitOfWork, isUuid, withUnitOfWork } from '@eeasy-logistics/db';
import type { PushTokenInvalidationHandler } from '../../kernel/public/index.js';
import { DriverDevicesRepository } from './drivers.repository.js';

// Push token invalidation (DEL-4 plan 2.11; INT-4 plan 2.5; integrations §2.5): when Expo says a
// token no longer reaches its device, the token is cleared on that device row, in a tenant
// transaction for the account the registry names. Nothing is audited (INT-4 counts it); a device
// that is not found, or whose token is already gone, is a no-op.

export function driverPushInvalidation(app: AppDatabase): PushTokenInvalidationHandler {
  return async ({ accountId, deviceId }) => {
    if (!isUuid(accountId) || !isUuid(deviceId)) return;
    await withUnitOfWork(
      app,
      {
        accountId,
        membershipId: null,
        userId: null,
        deviceId: null,
        actingCrossTenant: false,
      },
      () => new DriverDevicesRepository(getUnitOfWork()).clearPushToken(deviceId),
    );
  };
}
