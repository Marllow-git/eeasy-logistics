import { describe, expect, it } from 'vitest';
import { deviceLimits, deviceProblems, pushTokenProblem } from './device-input.js';

const device = { device_id: 'a1b2c3', platform: 'ios', app_version: '1.4.0' } as const;

describe('device input (DEL-4 plan 2.7)', () => {
  it('accepts a device with or without a push token', () => {
    expect(deviceProblems(device)).toEqual([]);
    expect(deviceProblems({ ...device, push_token: 'ExponentPushToken[abc]' })).toEqual([]);
  });

  it('refuses an empty, too long or control-character device id at its pointer', () => {
    for (const deviceId of ['', 'x'.repeat(deviceLimits.deviceId + 1), 'ab\ncd', 'a\u0085b']) {
      expect(deviceProblems({ ...device, device_id: deviceId })).toEqual([
        { pointer: '/body/device/device_id', code: 'invalid' },
      ]);
    }
    expect(deviceProblems({ ...device, device_id: 'x'.repeat(deviceLimits.deviceId) })).toEqual([]);
  });

  it('refuses an app version or push token the table would refuse, every field at once', () => {
    expect(
      deviceProblems({
        ...device,
        app_version: 'v'.repeat(deviceLimits.appVersion + 1),
        push_token: '',
      }).map((problem) => problem.pointer),
    ).toEqual(['/body/device/app_version', '/body/device/push_token']);
    expect(pushTokenProblem('t'.repeat(deviceLimits.pushToken))).toBeUndefined();
    expect(pushTokenProblem('t'.repeat(deviceLimits.pushToken + 1))).toEqual({
      pointer: '/body/push_token',
      code: 'invalid',
    });
  });
});
