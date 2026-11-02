import { describe, expect, it } from 'vitest';
import { normaliseShortCode } from './geocoder.js';

// INT-2 plan 2.3, 2.10: the short-code normaliser, with the research note's examples (REMA7572,
// RRHC2680 from Hudhud's documentation; RAGI and 2929 from SPL's page).

describe('normaliseShortCode', () => {
  it.each([
    ['REMA7572', 'REMA7572'],
    ['RRHC2680', 'RRHC2680'],
    ['  rema7572 ', 'REMA7572'],
    ['Rema7572', 'REMA7572'],
    ['REMA 7572', 'REMA7572'],
    ['R E M A 7 5 7 2', 'REMA7572'],
    ['REMA-7572', 'REMA7572'],
    ['ragi - 2929', 'RAGI2929'],
    ['REMA\t7572', 'REMA7572'],
    // Arabic-Indic digits (U+0660..0669).
    ['REMA٧٥٧٢', 'REMA7572'],
    ['ragi ٢٩٢٩', 'RAGI2929'],
    // Eastern Arabic-Indic digits (U+06F0..06F9).
    ['REMA۷۵۷۲', 'REMA7572'],
    ['RRHC۲۶۸۰', 'RRHC2680'],
  ])('normalises %j to %s', (input, expected) => {
    expect(normaliseShortCode(input)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['REM7572'],
    ['REMA757'],
    ['REMA75721'],
    ['REMAA7572'],
    ['RE1A7572'],
    ['7572REMA'],
    ['REMA_7572'],
    ['REMA.7572'],
    // Arabic letters are not short-code letters.
    ['ابجد1234'],
    // Only ASCII letters are upper-cased: the dotless i must not become I.
    ['ıRMA7572'],
    // Full-width letters are not ASCII.
    ['ＲＥＭＡ7572'],
    ['REMA' + ' '.repeat(40) + '7572'],
  ])('refuses %j', (input) => {
    expect(normaliseShortCode(input)).toBeUndefined();
  });

  it('refuses a value that is not a string', () => {
    expect(normaliseShortCode(7572 as unknown as string)).toBeUndefined();
  });
});
