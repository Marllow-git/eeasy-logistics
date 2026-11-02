import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { grantableRoles, memberLock, ownerRoleLock } from './member-rules.ts';

// The member rules the screens show (PLAT-12 §8.2 #27, #41; WEB-3 plan 2.7).
// node:test returns promises the runner awaits; `void` marks them for no-floating-promises.

const owner = { membershipId: 'm-owner', roles: ['owner'] };
const admin = { membershipId: 'm-admin', roles: ['admin'] };
const target = (id: string, roles: string[], status = 'active') => ({ id, roles, status });

void describe('memberLock', () => {
  void it('locks the caller out of their own membership, owner or not', () => {
    assert.equal(memberLock(owner, target('m-owner', ['owner'])), 'self');
    assert.equal(memberLock(admin, target('m-admin', ['admin'])), 'self');
  });

  void it("locks an owner's membership for a non-owner, whatever the change", () => {
    assert.equal(memberLock(admin, target('m-2', ['owner', 'dispatcher'])), 'owner_only');
    assert.equal(memberLock(owner, target('m-2', ['owner'])), undefined);
  });

  void it('leaves other memberships open', () => {
    assert.equal(memberLock(admin, target('m-3', ['viewer'])), undefined);
    assert.equal(memberLock(owner, target('m-3', ['viewer'], 'invited')), undefined);
  });

  void it('never matches a session without a membership id to a target', () => {
    assert.equal(
      memberLock({ membershipId: undefined, roles: ['admin'] }, target('m-3', [])),
      undefined,
    );
  });
});

void describe('ownerRoleLock', () => {
  void it('keeps the owner role out of reach of a non-owner', () => {
    assert.equal(ownerRoleLock(admin, target('m-3', ['viewer']), false), 'owner_grant');
    assert.equal(ownerRoleLock(admin, undefined, false), 'owner_grant');
  });

  void it('keeps the role on the last active owner', () => {
    assert.equal(ownerRoleLock(owner, target('m-owner', ['owner']), true), 'last_owner');
    assert.equal(ownerRoleLock(owner, target('m-2', ['owner']), false), undefined);
    assert.equal(ownerRoleLock(owner, target('m-2', ['owner'], 'invited'), true), undefined);
  });
});

void describe('grantableRoles', () => {
  void it('offers owner locked to a non-owner and open to an owner', () => {
    const roles = ['owner', 'viewer'] as const;
    assert.deepEqual(grantableRoles(admin, roles), [
      { role: 'owner', locked: true },
      { role: 'viewer', locked: false },
    ]);
    assert.deepEqual(grantableRoles(owner, roles), [
      { role: 'owner', locked: false },
      { role: 'viewer', locked: false },
    ]);
  });
});
