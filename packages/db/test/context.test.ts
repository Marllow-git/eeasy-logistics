import { describe, expect, it } from 'vitest';
import type { RequestContext } from '../src/context.ts';
import { checkContext } from '../src/context.ts';

// PLAT-10 adversary A-2: the sites of a site-scoped request travel on the context itself, so any
// copy of it keeps them.

const base: RequestContext = {
  accountId: '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3e',
  membershipId: null,
  userId: null,
  deviceId: null,
  actingCrossTenant: false,
};
const site = '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3f';

describe('checkContext siteIds', () => {
  it('copies siteIds frozen, and a copy of the checked context keeps them', () => {
    const given = [site];
    const checked = checkContext({ ...base, siteIds: given });
    expect(checked.siteIds).toEqual([site]);
    expect(Object.isFrozen(checked.siteIds)).toBe(true);
    given.push('0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d40');
    expect(checked.siteIds).toEqual([site]);
    expect(checkContext({ ...checked }).siteIds).toEqual([site]);
  });

  it('keeps an empty list (sees nothing) apart from no list (not site-scoped)', () => {
    expect(checkContext({ ...base, siteIds: [] }).siteIds).toEqual([]);
    expect(checkContext(base).siteIds).toBeUndefined();
  });

  it('refuses a site id that is not a lowercase UUID', () => {
    expect(() => checkContext({ ...base, siteIds: [site.toUpperCase()] })).toThrow('site id');
    expect(() => checkContext({ ...base, siteIds: ['site-1'] })).toThrow('site id');
  });
});
