import { errorCodes } from '@eeasy-logistics/contracts/unions';
import { describe, expect, it } from 'vitest';
import { locales, messages } from '../src/index';

// Web §5: the `errors` namespace has exactly one key per error code of docs/contracts/errors.md,
// as generated into the ErrorCode union (PLAT-15). The parity test covers the other locale.
describe('errors namespace', () => {
  it.each(locales)('has exactly the ErrorCode set in %s', (locale) => {
    const keys = Object.keys(messages[locale].errors).sort();
    expect(keys).toEqual([...errorCodes].sort());
  });
});
