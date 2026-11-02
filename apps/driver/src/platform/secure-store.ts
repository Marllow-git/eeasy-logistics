import * as SecureStore from 'expo-secure-store';

// The OS secure store (driver app §2, §7.2; ADR-0034): iOS keychain with
// AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, so the background task can read the refresh token while the
// phone is locked after the first unlock and nothing is restored to another phone; Android Keystore
// (excluded from backup by the expo-secure-store plugin, app.json). Values never reach SQLite, logs
// or analytics.
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/** The keys the app keeps in the secure store, and nothing else. */
export const secretKeys = {
  deviceId: 'device_id',
  refreshToken: 'refresh_token',
  driverId: 'driver_id',
  accountId: 'account_id',
  pinVerifier: 'cash_pin_verifier',
} as const;

export type SecretKey = (typeof secretKeys)[keyof typeof secretKeys];

/** The secure store as the sync layer sees it; tests pass an in-memory one. */
export interface SecretStore {
  get(key: SecretKey): Promise<string | null>;
  set(key: SecretKey, value: string): Promise<void>;
  delete(key: SecretKey): Promise<void>;
}

export const secureStore: SecretStore = {
  get: (key) => SecureStore.getItemAsync(key, options),
  set: (key, value) => SecureStore.setItemAsync(key, value, options),
  delete: (key) => SecureStore.deleteItemAsync(key, options),
};
