import { describe, expect, it } from 'vitest';
import type { RolloutModeValue } from '../schema/rollout.js';
import type { FlagState } from './feature-rules.js';
import { featureVisible, flagGrants, visibleFeatures } from './feature-rules.js';

// K-6 over every rollout mode and flag state (PLAT-13 plan 2.5, 2.12).

const flags: Record<string, FlagState | undefined> = {
  none: undefined,
  disabled: { enabled: false, provisionedBy: null },
  disabledBySomeone: { enabled: false, provisionedBy: 'u1' },
  enabledWithoutProvisioner: { enabled: true, provisionedBy: null },
  enabled: { enabled: true, provisionedBy: 'u1' },
};

const expected: Record<RolloutModeValue | 'missing', Record<string, boolean>> = {
  off: {
    none: false,
    disabled: false,
    disabledBySomeone: false,
    enabledWithoutProvisioner: false,
    enabled: false,
  },
  allowlist: {
    none: false,
    disabled: false,
    disabledBySomeone: false,
    enabledWithoutProvisioner: false,
    enabled: true,
  },
  all: {
    none: true,
    disabled: true,
    disabledBySomeone: true,
    enabledWithoutProvisioner: true,
    enabled: true,
  },
  // No rollout row reads as the default, `allowlist`.
  missing: {
    none: false,
    disabled: false,
    disabledBySomeone: false,
    enabledWithoutProvisioner: false,
    enabled: true,
  },
};

describe('K-6 (featureVisible)', () => {
  for (const [mode, row] of Object.entries(expected)) {
    for (const [state, visible] of Object.entries(row)) {
      it(`${mode} with flag ${state} is ${visible ? 'visible' : 'hidden'}`, () => {
        const value = mode === 'missing' ? undefined : (mode as RolloutModeValue);
        expect(featureVisible(value, flags[state])).toBe(visible);
      });
    }
  }

  it('counts a flag only when enabled by a platform user', () => {
    expect(flagGrants(flags.enabled)).toBe(true);
    expect(flagGrants(flags.enabledWithoutProvisioner)).toBe(false);
    expect(flagGrants(undefined)).toBe(false);
  });

  it('lists the visible registered keys in registry order', () => {
    const modes = new Map<string, RolloutModeValue>([
      ['delivery', 'allowlist'],
      ['wms', 'all'],
      ['retired', 'all'],
    ]);
    expect(visibleFeatures(modes, new Map())).toEqual(['wms']);
    expect(
      visibleFeatures(modes, new Map([['delivery', { enabled: true, provisionedBy: 'u1' }]])),
    ).toEqual(['delivery', 'wms']);
    expect(visibleFeatures(new Map([['wms', 'off']]), new Map())).toEqual([]);
  });
});
