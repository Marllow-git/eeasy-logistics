import { ParseError, parsePhoneNumberWithError } from 'libphonenumber-js';

// Phone numbers (identity and tenancy §3.2; data §1.3): normalised to E.164 before anything else,
// so two spellings of one Saudi number share one budget, one cooldown and one challenge (an
// eeasynew hardening finding). libphonenumber-js with its default metadata, Saudi Arabia as the
// country of a national-format number; the whole input must be the number (`extract: false`).

/** The E.164 shape: a plus and 8 to 15 digits, the first not zero (the opt-out table's check). */
export const e164Pattern = /^\+[1-9][0-9]{7,14}$/;

/** The E.164 form of `input`, or undefined when it is not a valid phone number. */
export function normalisePhone(input: string): string | undefined {
  if (typeof input !== 'string' || input.length > 40) return undefined;
  try {
    const parsed = parsePhoneNumberWithError(input, { defaultCountry: 'SA', extract: false });
    if (!parsed.isValid()) return undefined;
    return e164Pattern.test(parsed.number) ? parsed.number : undefined;
  } catch (error) {
    if (error instanceof ParseError) return undefined;
    throw error;
  }
}

/** What a log line may show of a phone (PLAT-9 plan 2.10): its last two digits only. */
export function phoneTail(phone: string): string {
  return `…${phone.slice(-2)}`;
}
