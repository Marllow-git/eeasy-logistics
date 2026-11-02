import { describe, expect, it } from 'vitest';
import { createProblems, normalisePlate, plateProblem } from './vehicle-input.js';

// DEL-4 plan 2.6: the plate normaliser and the create body's required fields.

describe('normalisePlate', () => {
  it('trims, collapses white space and upper-cases', () => {
    expect(normalisePlate('  abc   1234 ')).toBe('ABC 1234');
    expect(normalisePlate('abc\t\n1234')).toBe('ABC 1234');
    expect(normalisePlate('أ ب ج ١٢٣٤')).toBe('أ ب ج ١٢٣٤');
  });
});

describe('plateProblem', () => {
  it('takes 1 to 20 characters once normalised', () => {
    expect(plateProblem('a')).toBeUndefined();
    expect(plateProblem(`  ${'x'.repeat(20)}  `)).toBeUndefined();
    expect(plateProblem('   ')).toEqual({ pointer: '/body/plate', code: 'too_short' });
    expect(plateProblem('x'.repeat(21))).toEqual({ pointer: '/body/plate', code: 'too_long' });
  });

  it('refuses a control character', () => {
    expect(plateProblem('ABC\u00001')).toEqual({ pointer: '/body/plate', code: 'invalid' });
    expect(plateProblem('ABC\u001b1')).toEqual({ pointer: '/body/plate', code: 'invalid' });
  });
});

describe('createProblems', () => {
  it('requires the plate, the kind and the capacity', () => {
    expect(createProblems({})).toEqual([
      { pointer: '/body/plate', code: 'required' },
      { pointer: '/body/kind', code: 'required' },
      { pointer: '/body/capacity_parcels', code: 'required' },
    ]);
    expect(createProblems({ plate: 'ABC 1', kind: 'van', capacity_parcels: 0 })).toEqual([]);
    expect(createProblems({ plate: '', kind: 'car', capacity_parcels: 1 })).toEqual([
      { pointer: '/body/plate', code: 'too_short' },
    ]);
  });
});
