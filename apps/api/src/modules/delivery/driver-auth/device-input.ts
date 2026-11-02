import type { DevicePlatform, FieldProblem } from '../../kernel/public/index.js';

// The device a driver signs in on (DEL-4 plan 2.7; `DeviceInfo`; data §2.1 `del_driver_devices`):
// the contract bounds `device_id` at 200 characters and nothing else; the table's CHECKs bound the
// rest (8.2 #2), so a value they would refuse is a `400` here, never a failed insert.

/** `DeviceInfo` and `PushTokenRequest` after the contract's schema. */
export interface DeviceInput {
  readonly device_id: string;
  readonly platform: DevicePlatform;
  readonly app_version: string;
  readonly push_token?: string | undefined;
}

export const deviceLimits = { deviceId: 200, appVersion: 64, pushToken: 4096 } as const;

/** Any C0 or C1 control character (a device id, a version or a token is one printable line). */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function textProblem(pointer: string, value: string, max: number): FieldProblem | undefined {
  if (value.length === 0 || value.length > max || hasControlCharacter(value)) {
    return { pointer, code: 'invalid' };
  }
  return undefined;
}

/** The fields of a sign-in's `device` the table would refuse, at their pointers. */
export function deviceProblems(device: DeviceInput, at = '/body/device'): FieldProblem[] {
  return [
    textProblem(`${at}/device_id`, device.device_id, deviceLimits.deviceId),
    textProblem(`${at}/app_version`, device.app_version, deviceLimits.appVersion),
    device.push_token === undefined
      ? undefined
      : pushTokenProblem(device.push_token, `${at}/push_token`),
  ].filter((problem): problem is FieldProblem => problem !== undefined);
}

/** A push token the table would refuse (`driverUpdatePushToken`, and the sign-in's). */
export function pushTokenProblem(
  token: string,
  pointer = '/body/push_token',
): FieldProblem | undefined {
  return textProblem(pointer, token, deviceLimits.pushToken);
}
