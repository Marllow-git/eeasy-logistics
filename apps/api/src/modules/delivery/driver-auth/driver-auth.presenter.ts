import type {
  DriverDevice,
  DriverMe,
  DriverSession,
  TokenPair,
} from '@eeasy-logistics/contracts/driver/schemas';
import type { IssuedSession } from '../../kernel/public/index.js';
import type { DriverDeviceRow } from '../drivers/drivers.repository.js';
import { presentDriver } from '../drivers/drivers.presenter.js';
import { presentShift } from '../shifts/shifts.presenter.js';
import type { DriverSelf } from './driver-self.service.js';
import type { DriverSessionStarted } from './driver-sessions.service.js';

/** `TokenPair`: the bearer pair of the driver app (no cookies; identity and tenancy §4). */
export function presentTokens(session: IssuedSession): TokenPair {
  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_in: session.accessTtlSeconds,
  };
}

/**
 * `DriverDevice` as the driver's own app sees it: its push token included (it is the app's own;
 * the staff surface leaves it out, 8.2 #18).
 */
export function presentOwnDevice(row: DriverDeviceRow): DriverDevice {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    device_id: row.deviceId,
    platform: row.platform,
    app_version: row.appVersion,
    push_token: row.pushToken,
    revoked_at: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * `DriverMe` (`driverGetMe`, plan 2.8): the live shift (DEL-5 plan 2.4), cash figures zero before DEL-8's
 * ledgers (the block state is the row's), the account's proof policy, the minimum app versions.
 */
export function presentDriverMe(self: DriverSelf): DriverMe {
  return {
    driver: presentDriver({ row: self.driver, person: self.person }),
    device: presentOwnDevice(self.device),
    current_shift: self.currentShift === undefined ? null : presentShift(self.currentShift),
    cash: {
      cash_in_hand: { amount: 0, currency: 'SAR' },
      oldest_collected_business_date: null,
      liability_balance: { amount: 0, currency: 'SAR' },
      cash_blocked: self.driver.cashBlockedAt !== null,
    },
    cash_pin_set: self.driver.cashPinHash !== null,
    proof_policy: self.proofPolicy,
    min_app_version: { ...self.minAppVersion },
  };
}

/** `DriverSession` (`driverVerifyOtp`, plan 2.7). */
export function presentDriverSession(started: DriverSessionStarted): DriverSession {
  return {
    tokens: presentTokens(started.session),
    driver: presentDriver(started.driver),
    device: presentOwnDevice(started.device),
    cash_pin_set: started.cashPinSet,
  };
}
