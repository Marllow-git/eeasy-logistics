import { describe, expect, it } from 'vitest';
import { accountStatuses } from '../schema/accounts.js';
import type { LifecycleAction } from './account-lifecycle.js';
import { lifecycleTransition } from './account-lifecycle.js';

// PLAT-13 plan 2.7, 2.12: the transition table of the platform's account doors over every state.

const allowed: Readonly<Record<LifecycleAction, Record<string, string>>> = {
  suspend: { active: 'suspended' },
  reactivate: { suspended: 'active' },
  // Adversary L-3: a provisioned account whose owner never accepted can be closed.
  close: { suspended: 'closed', provisioned: 'closed' },
};

describe('account lifecycle transitions (plan 2.7)', () => {
  for (const action of ['suspend', 'reactivate', 'close'] as const) {
    for (const status of accountStatuses) {
      const to = allowed[action][status];
      it(`${action} from ${status} ${to === undefined ? 'is refused' : `moves to ${to}`}`, () => {
        expect(lifecycleTransition(action, status)?.to).toBe(to);
      });
    }
  }

  it('names the event of each arrow', () => {
    expect(lifecycleTransition('suspend', 'active')?.event).toBe('core.account.suspended');
    expect(lifecycleTransition('reactivate', 'suspended')?.event).toBe('core.account.reactivated');
    expect(lifecycleTransition('close', 'suspended')?.event).toBe('core.account.closed');
    expect(lifecycleTransition('close', 'provisioned')?.event).toBe('core.account.closed');
  });

  it('never closes an active account, and never reopens a closed one', () => {
    expect(lifecycleTransition('close', 'active')).toBeUndefined();
    expect(lifecycleTransition('reactivate', 'closed')).toBeUndefined();
    expect(lifecycleTransition('suspend', 'closed')).toBeUndefined();
    expect(lifecycleTransition('suspend', 'provisioned')).toBeUndefined();
  });
});
