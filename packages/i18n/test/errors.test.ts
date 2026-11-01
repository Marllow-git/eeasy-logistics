import { errorCodes } from '@eeasy-logistics/contracts/unions';
import { describe, expect, it } from 'vitest';
import { locales, messages } from '../src/index';

// Web §5: the `errors` namespace has exactly one message per error code of docs/contracts/errors.md
// (`errors.codes`, PLAT-6), as generated into the ErrorCode union (PLAT-15). The parity test covers
// the other locale.
describe('errors namespace', () => {
  it.each(locales)('has exactly the ErrorCode set in %s', (locale) => {
    const keys = Object.keys(messages[locale].errors.codes).sort();
    expect(keys).toEqual([...errorCodes].sort());
  });
});
