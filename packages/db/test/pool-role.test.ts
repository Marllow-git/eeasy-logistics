import { describe, expect, it } from 'vitest';
import { isPlainPoolRole } from '../src/pools.ts';

// The decision behind verifyPoolRole (review M-6, N-2). The query itself runs in the api
// integration suite (/ready and the seed); a role granted elx_owner membership is not created
// there because roles are cluster-wide and would affect concurrent tests.
describe('isPlainPoolRole', () => {
  const plain = { who: 'elx_app', superuser: false, bypass: false, ownerMember: false };

  it('accepts a plain login as the expected role', () => {
    expect(isPlainPoolRole(plain, 'elx_app')).toBe(true);
    expect(isPlainPoolRole({ ...plain, who: 'elx_platform' }, 'elx_platform')).toBe(true);
  });

  it.each([
    ['another login', { ...plain, who: 'elx_platform' }],
    ['a superuser', { ...plain, superuser: true }],
    ['a BYPASSRLS role', { ...plain, bypass: true }],
    ['a member of elx_owner', { ...plain, ownerMember: true }],
    ['no row at all', undefined],
  ])('refuses %s', (_label, facts) => {
    expect(isPlainPoolRole(facts, 'elx_app')).toBe(false);
  });
});
