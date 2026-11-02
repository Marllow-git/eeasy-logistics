import * as Updates from 'expo-updates';
import { DevSettings, I18nManager } from 'react-native';

// Layout direction (driver app §10): React Native applies it only at start, so a change is forced
// and the JS bundle reloaded (expo-updates in a release build, the dev menu's reload in development).

/** Forces the direction for the next start; true when the running layout does not match yet. */
export function forceDirection(rtl: boolean): boolean {
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return I18nManager.isRTL !== rtl;
}

export async function reloadApp(): Promise<void> {
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  await Updates.reloadAsync();
}

/** `<version>+<update id>` for Sentry (driver app §11); `embedded` before any OTA update. */
export function releaseName(version: string): string {
  return `${version}+${Updates.updateId ?? 'embedded'}`;
}
