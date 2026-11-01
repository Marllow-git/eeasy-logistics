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
  it('refuses driver with every role that holds a delivery.cash permission', () => {
    for (const role of ['owner', 'admin', 'dispatcher', 'cashier', 'viewer']) {
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

  it('allows driver alone, with roles without cash, and any list without driver', () => {
    expect(codeOf(() => assertRoleCombination(['driver'], bundles))).toBeUndefined();
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
