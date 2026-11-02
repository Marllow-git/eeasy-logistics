import { client } from '@eeasy-logistics/contracts/driver';
import { uuidv7 } from '@eeasy-logistics/contracts/http';
import { expoPushToken, onPushTokenChange } from '../platform/permissions';
import { driverApp } from './driver-app';

// Push token registration (driver app §7.1, §8.2; DRV-1 plan 2.7): sent with the sign-in when
// notification permission is already granted, then with `driverUpdatePushToken` when it is granted
// later or when Expo rotates the token. Push handling itself is DRV-5's.

let lastSent: string | undefined;

/** The current Expo push token, or undefined without permission or an EAS project id. */
export function currentPushToken(): Promise<string | undefined> {
  return expoPushToken();
}

/** Sends the token when it changed since the last send of this run. */
export async function registerPushToken(): Promise<void> {
  const token = await expoPushToken();
  if (token === undefined || token === lastSent) return;
  const { fetcher } = driverApp();
  try {
    await client.driverUpdatePushToken(
      { push_token: token },
      { fetcher, headers: { 'Idempotency-Key': uuidv7() } },
    );
    lastSent = token;
  } catch {
    // Offline or refused: the next foreground or rotation tries again.
  }
}

/** Re-registers on rotation; returns the unsubscribe. */
export function watchPushToken(): () => void {
  return onPushTokenChange(() => void registerPushToken());
}
