import { describe, expect, it } from 'vitest';
import type { RoleChange } from './staff-rules.js';
import { inviteRefusal, roleChangeRefusal, totpResetRefusal } from './staff-rules.js';

// PLAT-13 plan 2.9, 2.12: the role rules of the platform staff doors.

const change = (overrides: Partial<RoleChange>): RoleChange => ({
  callerId: 'caller',
  callerRole: 'super_admin',
  targetId: 'target',
  current: 'admin',
  next: 'support',
  liveSuperAdmins: 2,
  ...overrides,
});

describe('platform staff rules (plan 2.9)', () => {
  it('lets only a super admin invite a super admin', () => {
    expect(inviteRefusal('super_admin', 'super_admin')).toBeUndefined();
    expect(inviteRefusal('admin', 'super_admin')).toBe('super_admin_by_super_admin_only');
    expect(inviteRefusal('support', 'super_admin')).toBe('super_admin_by_super_admin_only');
    expect(inviteRefusal('admin', 'admin')).toBeUndefined();
    expect(inviteRefusal('admin', 'support')).toBeUndefined();
  });

  it('never changes oneself, whatever the change', () => {
    expect(roleChangeRefusal(change({ targetId: 'caller' }))).toBe('self');
    expect(roleChangeRefusal(change({ targetId: 'caller', next: null }))).toBe('self');
    expect(
      roleChangeRefusal(
        change({ targetId: 'caller', current: 'super_admin', next: 'super_admin' }),
      ),
    ).toBe('self');
  });

  it('grants and removes super_admin only by a super admin', () => {
    expect(roleChangeRefusal(change({ next: 'super_admin' }))).toBeUndefined();
    expect(roleChangeRefusal(change({ callerRole: 'admin', next: 'super_admin' }))).toBe(
      'super_admin_by_super_admin_only',
    );
    expect(
      roleChangeRefusal(change({ callerRole: 'admin', current: 'super_admin', next: 'admin' })),
    ).toBe('super_admin_by_super_admin_only');
    expect(
      roleChangeRefusal(change({ callerRole: 'admin', current: 'super_admin', next: null })),
    ).toBe('super_admin_by_super_admin_only');
    // Re-granting super_admin to a revoked row is a grant too.
    expect(
      roleChangeRefusal(change({ callerRole: 'admin', current: null, next: 'super_admin' })),
    ).toBe('super_admin_by_super_admin_only');
    // Changes that never touch super_admin are not a super admin's privilege.
    expect(roleChangeRefusal(change({ callerRole: 'admin' }))).toBeUndefined();
    expect(roleChangeRefusal(change({ callerRole: 'admin', next: null }))).toBeUndefined();
  });

  it('keeps the last live super admin', () => {
    const lastOne = { current: 'super_admin', liveSuperAdmins: 1 } as const;
    expect(roleChangeRefusal(change({ ...lastOne, next: 'admin' }))).toBe('last_super_admin');
    expect(roleChangeRefusal(change({ ...lastOne, next: null }))).toBe('last_super_admin');
    expect(roleChangeRefusal(change({ ...lastOne, next: 'super_admin' }))).toBeUndefined();
    expect(
      roleChangeRefusal(change({ current: 'super_admin', next: 'admin', liveSuperAdmins: 2 })),
    ).toBeUndefined();
  });

  it('resets a TOTP only as a super admin and never one’s own', () => {
    expect(totpResetRefusal('caller', 'super_admin', 'target')).toBeUndefined();
    expect(totpResetRefusal('caller', 'super_admin', 'caller')).toBe('self');
    expect(totpResetRefusal('caller', 'admin', 'target')).toBe('super_admin_only');
    expect(totpResetRefusal('caller', 'support', 'target')).toBe('super_admin_only');
  });
});
