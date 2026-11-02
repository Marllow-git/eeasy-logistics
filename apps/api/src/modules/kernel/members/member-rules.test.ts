import { describe, expect, it } from 'vitest';
import type { MemberChange } from './member-rules.js';
import { memberChangeRefusal } from './member-rules.js';

// The owner rules of updateMember and revokeMember (PLAT-12 plan 2.8, 2.14).

const owner = { id: 'caller', roles: ['owner'] };
const admin = { id: 'caller', roles: ['admin'] };
const change = (overrides: Partial<MemberChange>): MemberChange => ({
  caller: owner,
  target: { id: 'target', roles: ['dispatcher'], status: 'active' },
  roles: ['viewer'],
  revoking: false,
  activeOwners: 2,
  ...overrides,
});

describe('memberChangeRefusal', () => {
  it('refuses a change of the caller’s own membership, an owner’s too', () => {
    const self = { id: 'caller', roles: ['owner'], status: 'active' as const };
    expect(memberChangeRefusal(change({ target: self, roles: ['owner'] }))).toBe('self');
    expect(memberChangeRefusal(change({ target: self, revoking: true }))).toBe('self');
  });

  it('lets only an owner grant or remove owner, a revocation of an owner included', () => {
    expect(memberChangeRefusal(change({ caller: admin, roles: ['owner'] }))).toBe('owner_rule');
    const anOwner = { id: 'target', roles: ['owner', 'admin'], status: 'active' as const };
    expect(memberChangeRefusal(change({ caller: admin, target: anOwner, roles: ['admin'] }))).toBe(
      'owner_rule',
    );
    expect(memberChangeRefusal(change({ caller: admin, target: anOwner, revoking: true }))).toBe(
      'owner_rule',
    );
    // An owner is changed in any way only by an owner, even when owner stays (adversary M-3).
    expect(
      memberChangeRefusal(change({ caller: admin, target: anOwner, roles: ['owner', 'viewer'] })),
    ).toBe('owner_rule');
    expect(
      memberChangeRefusal(change({ caller: admin, target: anOwner, roles: anOwner.roles })),
    ).toBe('owner_rule');
    expect(
      memberChangeRefusal(change({ target: anOwner, roles: ['owner', 'viewer'] })),
    ).toBeUndefined();
    expect(memberChangeRefusal(change({ roles: ['owner'] }))).toBeUndefined();
    expect(memberChangeRefusal(change({ caller: admin }))).toBeUndefined();
    expect(memberChangeRefusal(change({ caller: admin, revoking: true }))).toBeUndefined();
  });

  it('keeps owner on the last active owner', () => {
    const last = { id: 'target', roles: ['owner'], status: 'active' as const };
    expect(memberChangeRefusal(change({ target: last, activeOwners: 1 }))).toBe('last_owner');
    expect(memberChangeRefusal(change({ target: last, activeOwners: 1, revoking: true }))).toBe(
      'last_owner',
    );
    expect(memberChangeRefusal(change({ target: last, activeOwners: 2 }))).toBeUndefined();
    // An invited or revoked owner is not one of the active owners.
    const invited = { ...last, status: 'invited' as const };
    expect(memberChangeRefusal(change({ target: invited, activeOwners: 1 }))).toBeUndefined();
  });
});
