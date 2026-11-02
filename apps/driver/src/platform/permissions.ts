import { Camera } from 'expo-camera';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

// The OS permissions of the setup step (driver app §6.3, DRV-1 plan 2.7). The choices live in the
// OS only. The permissions screen calls this module directly (an OS prompt is UI; DRV-1 §8.2).

export type PermissionName = 'location' | 'background' | 'notifications' | 'camera';
export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

interface Answer {
  status: string;
  canAskAgain?: boolean;
}

function statusOf(answer: Answer): PermissionStatus {
  if (answer.status === 'granted') return 'granted';
  if (answer.status === 'denied') return 'denied';
  return 'undetermined';
}

/** Whether the OS would still show its prompt (false: only system settings can change it). */
export type PermissionState = { status: PermissionStatus; canAskAgain: boolean };

const readers: Record<PermissionName, () => Promise<Answer>> = {
  location: () => Location.getForegroundPermissionsAsync(),
  background: () => Location.getBackgroundPermissionsAsync(),
  notifications: () => Notifications.getPermissionsAsync(),
  camera: () => Camera.getCameraPermissionsAsync(),
};

const requesters: Record<PermissionName, () => Promise<Answer>> = {
  location: () => Location.requestForegroundPermissionsAsync(),
  // iOS asks "Always" after "While Using"; Android 11+ sends the driver to system settings (§6.3).
  background: () => Location.requestBackgroundPermissionsAsync(),
  notifications: () => Notifications.requestPermissionsAsync(),
  camera: () => Camera.requestCameraPermissionsAsync(),
};

export async function permissionState(name: PermissionName): Promise<PermissionState> {
  const answer = await readers[name]();
  return { status: statusOf(answer), canAskAgain: answer.canAskAgain ?? true };
}

export async function requestPermission(name: PermissionName): Promise<PermissionState> {
  const answer = await requesters[name]();
  return { status: statusOf(answer), canAskAgain: answer.canAskAgain ?? true };
}

export function openSystemSettings(): Promise<void> {
  return Linking.openSettings();
}

/**
 * The Expo push token, when notifications are allowed and the build has an EAS project id; else
 * undefined (wave 1 has no EAS project, DRV-1 §8.2).
 */
export async function expoPushToken(): Promise<string | undefined> {
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  if (projectId === undefined) return undefined;
  if (!(await Notifications.getPermissionsAsync()).granted) return undefined;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return undefined;
  }
}

/** Calls `listener` when Expo rotates the device's push token. */
export function onPushTokenChange(listener: () => void): () => void {
  const subscription = Notifications.addPushTokenListener(listener);
  return () => subscription.remove();
}
