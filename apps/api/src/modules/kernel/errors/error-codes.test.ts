import { readFileSync } from 'node:fs';
import { errorMessage, errorMessageCodes } from '@eeasy-logistics/i18n/errors';
import { describe, expect, it } from 'vitest';
import { errorStatus } from './error-codes.js';
import { resolveLocale } from './locale.js';

// Parity (PLAT-6 item A): the code table here, the code tables of docs/contracts/errors.md and the
// `errors` catalogues of packages/i18n hold exactly the same codes, with the same HTTP status.

const errorsMd = readFileSync(
  new URL('../../../../../../docs/contracts/errors.md', import.meta.url),
  'utf8',
);
const documented = new Map(
  [...errorsMd.matchAll(/^\| `([a-z_]+)` \| (\d{3}) \|/gm)].map((m) => [m[1], Number(m[2])]),
);

describe('error codes', () => {
  it('reads the code tables of errors.md', () => {
    expect(documented.size).toBeGreaterThan(60);
  });

  it('lists every code of errors.md with its HTTP status, and nothing else', () => {
    expect(Object.fromEntries(Object.entries(errorStatus))).toEqual(Object.fromEntries(documented));
  });

  it('has a message for every code in ar and en, and no message without a code', () => {
    expect([...errorMessageCodes].sort()).toEqual(Object.keys(errorStatus).sort());
    for (const code of Object.keys(errorStatus) as (keyof typeof errorStatus)[]) {
      expect(errorMessage('ar', code)).not.toEqual(errorMessage('en', code));
    }
  });
});

describe('resolveLocale (Accept-Language)', () => {
  it.each([
    [undefined, 'ar'],
    ['', 'ar'],
    ['en', 'en'],
    ['en-GB,en;q=0.9', 'en'],
    ['fr-FR, en;q=0.5', 'en'],
    ['en;q=0.4, ar;q=0.8', 'ar'],
    ['de', 'ar'],
    ['en;q=0', 'ar'],
    ['AR-sa', 'ar'],
  ])('%s gives %s', (header, locale) => {
    expect(resolveLocale(header)).toBe(locale);
  });
});
