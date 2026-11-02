import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Device facts the API reads (driver app §7.1, DEL-4 plan 8.2 #32): the build version for
// `X-App-Version` and `DeviceInfo.app_version`, the platform for `X-App-Platform`. No hardware
// identifier is read; the device id is a random UUID (sync/device-id.ts).

/** The app version in the form the API's guard compares (`1.4.0`). */
export function appVersion(): string {
  return Constants.expoConfig?.version ?? '0.0.0';
}

export type AppPlatform = 'ios' | 'android';

export function appPlatform(): AppPlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/** A random UUID v4 (Hermes has no `crypto.randomUUID`). */
export function randomUuid(): string {
  return Crypto.randomUUID();
}

/**
 * Gives Hermes the Web Crypto `getRandomValues` (from expo-crypto) that packages/contracts' `uuidv7`
 * and `defaultRequestId` call; Hermes has no `globalThis.crypto`.
 */
export function installRandomValues(): void {
  const scope = globalThis as { crypto?: Partial<Crypto> };
  scope.crypto ??= {};
  scope.crypto.getRandomValues ??= Crypto.getRandomValues as Crypto['getRandomValues'];
}

/** Cryptographically random bytes. */
export function randomBytes(length: number): Uint8Array {
  return Crypto.getRandomBytes(length);
}
