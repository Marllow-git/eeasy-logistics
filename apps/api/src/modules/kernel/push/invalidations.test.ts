import { describe, expect, it } from 'vitest';
import type { PushTokenInvalidation } from './invalidations.js';
import { PushTokenInvalidations } from './invalidations.js';

// INT-4 plan 2.5, 2.10: the registry DEL-4 fills with "clear push_token on that device row".

const invalidation: PushTokenInvalidation = {
  accountId: '00000000-0000-4000-8000-0000000000a1',
  deviceId: '00000000-0000-4000-8000-0000000000d1',
  reason: 'device_not_registered',
};

function recordingLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      log: (m: string) => lines.push(`log ${m}`),
      warn: (m: string) => lines.push(`warn ${m}`),
    },
  };
}

describe('PushTokenInvalidations', () => {
  it('runs every registered handler once with the device, and logs the device id only', async () => {
    const { lines, logger } = recordingLogger();
    const registry = new PushTokenInvalidations(logger);
    const calls: PushTokenInvalidation[] = [];
    registry.register((i) => {
      calls.push(i);
      return Promise.resolve();
    });
    expect(registry.size).toBe(1);
    expect(await registry.invalidate(invalidation)).toBe(1);
    expect(calls).toEqual([invalidation]);
    expect(lines).toEqual([
      `log push token invalidated device_id=${invalidation.deviceId} reason=device_not_registered handlers=1`,
    ]);
  });

  it('logs and survives a failing handler, and still runs the others', async () => {
    const { lines, logger } = recordingLogger();
    const registry = new PushTokenInvalidations(logger);
    let ran = 0;
    registry.register(() => Promise.reject(new TypeError('ExponentPushToken[secret] gone')));
    registry.register(() => {
      ran += 1;
      return Promise.resolve();
    });
    expect(await registry.invalidate(invalidation)).toBe(1);
    expect(ran).toBe(1);
    expect(lines.at(-1)).toBe(
      `warn push token invalidation handler failed device_id=${invalidation.deviceId}: TypeError`,
    );
    expect(lines.join('\n')).not.toContain('ExponentPushToken');
  });

  it('does nothing but log before DEL-4 registers a handler', async () => {
    const { lines, logger } = recordingLogger();
    expect(await new PushTokenInvalidations(logger).invalidate(invalidation)).toBe(0);
    expect(lines).toHaveLength(1);
  });
});
