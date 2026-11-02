import { describe, expect, it } from 'vitest';
import { coverageAnswer, isCovered } from './coverage-query.js';

// DEL-1 plan 2.5, §7 #3: of the covering zones (smallest first, as the query orders them) the
// first answers; no covering site means not covered, whatever the zones.

describe('coverageAnswer', () => {
  it('answers the smallest zone with the union of sites', () => {
    const answer = coverageAnswer([{ id: 'small' }, { id: 'big' }], ['site-a', 'site-b']);
    expect(answer).toEqual({ zoneId: 'small', siteIds: ['site-a', 'site-b'] });
    expect(isCovered(answer)).toBe(true);
  });

  it('is not covered without a zone or without a site', () => {
    expect(coverageAnswer([], [])).toEqual({ zoneId: null, siteIds: [] });
    const noSite = coverageAnswer([{ id: 'zone' }], []);
    expect(noSite).toEqual({ zoneId: null, siteIds: [] });
    expect(isCovered(noSite)).toBe(false);
  });
});
