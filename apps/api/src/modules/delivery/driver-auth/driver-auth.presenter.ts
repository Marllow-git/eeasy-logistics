import type {
  DriverDevice,
  DriverSession,
  TokenPair,
} from '@eeasy-logistics/contracts/driver/schemas';
import type { IssuedSession } from '../../kernel/public/index.js';
import type { DriverDeviceRow } from '../drivers/drivers.repository.js';
import { presentDriver } from '../drivers/drivers.presenter.js';
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

/** `DriverSession` (`driverVerifyOtp`, plan 2.7). */
export function presentDriverSession(started: DriverSessionStarted): DriverSession {
  return {
    tokens: presentTokens(started.session),
    driver: presentDriver(started.driver),
    device: presentOwnDevice(started.device),
    cash_pin_set: started.cashPinSet,
  };
}
