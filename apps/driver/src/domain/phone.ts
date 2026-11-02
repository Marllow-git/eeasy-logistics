// The phone field (driver app §7.1): the server normalises to E.164; the app strips spaces and
// separators, turns Arabic-Indic and Persian digits into Western ones, and offers the +966 prefix,
// so a driver may type `05X…`, `5X…` or the full international form.

export const saudiPrefix = '+966';

const easternDigits = /[٠-٩۰-۹]/g;

/** Arabic-Indic and Persian digits as Western ones (an Arabic keyboard may type either). */
export function westernDigits(value: string): string {
  return value.replace(easternDigits, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Western digits only, keeping a leading `+`. */
export function cleanPhoneInput(value: string): string {
  const western = westernDigits(value).trim();
  const plus = western.startsWith('+') ? '+' : '';
  return plus + western.replace(/\D/g, '');
}

/** The number to send: the typed national number behind the prefix, or a full number as typed. */
export function composePhone(input: string): string {
  const cleaned = cleanPhoneInput(input);
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.startsWith('00')) return `+${cleaned.slice(2)}`;
  if (cleaned.startsWith('966')) return `+${cleaned}`;
  const national = cleaned.startsWith('0') ? cleaned.slice(1) : cleaned;
  return `${saudiPrefix}${national}`;
}

/** Enough digits to be worth sending (the server is the judge of the rest). */
export function isPlausiblePhone(input: string): boolean {
  const digits = composePhone(input).slice(1);
  return digits.length >= 11 && digits.length <= 15;
}
