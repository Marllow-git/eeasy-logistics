// The `errors` namespace (PLAT-6 plan 2.2): one message per error code of
// docs/contracts/errors.md, in both locales, for the API's `Error.message`. A separate entry from
// `.`: the API loads it through Node's own module loader, which needs the JSON import attribute.
import arErrors from '../ar/errors.json' with { type: 'json' };
import enErrors from '../en/errors.json' with { type: 'json' };
import type { Locale } from './locales.ts';

export { defaultLocale, isLocale, locales, type Locale } from './locales.ts';

// The Arabic catalogue is the reference shape: an English catalogue missing a key fails typecheck,
// and test/parity.test.ts fails on a key present in one locale only.
type ErrorsCatalogue = typeof arErrors;
const errors: Record<Locale, ErrorsCatalogue> = { ar: arErrors, en: enErrors };

export type ErrorMessageCode = keyof ErrorsCatalogue['codes'];
export type FieldMessageCode = keyof ErrorsCatalogue['fields'];

/** The message for an error code, e.g. `errorMessage('en', 'not_found')`. */
export function errorMessage(locale: Locale, code: ErrorMessageCode): string {
  return errors[locale].codes[code];
}

/** The message for one problem inside `details.fields[]`. */
export function fieldMessage(locale: Locale, code: FieldMessageCode): string {
  return errors[locale].fields[code];
}

/** Every error code that has a message; the API's parity test compares it with errors.md. */
export const errorMessageCodes = Object.keys(arErrors.codes) as readonly ErrorMessageCode[];
