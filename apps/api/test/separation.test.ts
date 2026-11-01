import { roleBundles } from '@eeasy-logistics/contracts/unions';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../src/modules/kernel/errors/api-exception.js';
import { assertRoleCombination, assertSeparation } from '../src/modules/kernel/authz/separation.js';

// PLAT-10 plan 2.7, against the real bundles of roles.yaml: driver never with a cash role (M9);
// the approver is never the counter or the requester (W-16).

const bundles = new Map(
  Object.entries(roleBundles).map(([key, bundle]) => [
    key,
    { permissions: new Set<string>(bundle.permissions) },
  ]),
);

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error instanceof ApiException ? error.code : 'not an ApiException';
  }
}

describe('assertRoleCombination', () => {
  it('refuses driver with every role that handles cash (receive, deposit, close, liability)', () => {
    for (const role of ['owner', 'admin', 'cashier']) {
      expect(
        codeOf(() => assertRoleCombination(['driver', role], bundles)),
        role,
      ).toBe('role_combination_forbidden');
      expect(
        codeOf(() => assertRoleCombination([role, 'driver'], bundles)),
        role,
      ).toBe('role_combination_forbidden');
    }
  });

  it('counts each cash-handling permission on its own, and not delivery.cash.read', () => {
    for (const permission of [
      'delivery.cash.receive',
      'delivery.cash.deposit',
      'delivery.cash.close_report',
      'delivery.liability.record',
    ]) {
      const one = new Map([['clerk', { permissions: new Set([permission]) }]]);
      expect(
        codeOf(() => assertRoleCombination(['driver', 'clerk'], one)),
        permission,
      ).toBe('role_combination_forbidden');
    }
    const reader = new Map([['reader', { permissions: new Set(['delivery.cash.read']) }]]);
    expect(codeOf(() => assertRoleCombination(['driver', 'reader'], reader))).toBeUndefined();
  });

  it('allows driver alone, with roles that only read cash or hold none, and lists without driver', () => {
    expect(codeOf(() => assertRoleCombination(['driver'], bundles))).toBeUndefined();
    // Lead ruling on PR #70: reading cash handles none (viewer and dispatcher hold delivery.cash.read).
    for (const role of ['viewer', 'dispatcher']) {
      expect(
        codeOf(() => assertRoleCombination(['driver', role], bundles)),
        role,
      ).toBeUndefined();
    }
    expect(
      codeOf(() => assertRoleCombination(['driver', 'site_staff', 'warehouse_staff'], bundles)),
    ).toBeUndefined();
    expect(codeOf(() => assertRoleCombination(['cashier', 'owner'], bundles))).toBeUndefined();
    expect(codeOf(() => assertRoleCombination(['driver', 'unknown'], bundles))).toBeUndefined();
  });
});

describe('assertSeparation', () => {
  const [a, b, c] = ['user-a', 'user-b', 'user-c'];

  it('refuses the counter or the requester as approver', () => {
    expect(codeOf(() => assertSeparation({ approver: a, counter: a }))).toBe(
      'separation_of_duties',
    );
    expect(codeOf(() => assertSeparation({ approver: a, counter: b, requester: a }))).toBe(
      'separation_of_duties',
    );
  });

  it('allows a third person, and steps the flow does not have', () => {
    expect(
      codeOf(() => assertSeparation({ approver: a, counter: b, requester: c })),
    ).toBeUndefined();
    expect(codeOf(() => assertSeparation({ approver: a }))).toBeUndefined();
    expect(codeOf(() => assertSeparation({ approver: a, counter: null, requester: null }))).toBe(
      undefined,
    );
  });
});
