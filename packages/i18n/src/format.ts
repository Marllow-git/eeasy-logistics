import type { Locale } from './locales.ts';

// The one formatting module for dates, numbers and money (web §5, ADR-0016), shared by the web apps
// and the driver app. The Unicode extension keys are mandatory: bare `ar-SA` may resolve to the Umm
// al-Qura calendar and Arabic-Indic digits, which ADR-0016 forbids. No date library.

/** BCP 47 tags with Gregorian calendar and Western (Latin) digits forced. */
export const intlLocale: Record<Locale, string> = {
  ar: 'ar-SA-u-ca-gregory-nu-latn',
  en: 'en-SA-u-ca-gregory-nu-latn',
};

/** Every instant is shown in Riyadh time, whatever the browser's zone. */
export const timeZone = 'Asia/Riyadh';

const businessDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const e164Pattern = /^\+[1-9]\d{6,14}$/;
const lrm = '\u200e';

function toDate(value: Date | string | number): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Not a valid instant: ${String(value)}`);
  }
  return date;
}

/** An instant (ISO 8601 timestamp or `Date`) as date and time in Riyadh. */
export function formatDateTime(
  locale: Locale,
  value: Date | string | number,
  options: Pick<Intl.DateTimeFormatOptions, 'dateStyle' | 'timeStyle'> = {
    dateStyle: 'medium',
    timeStyle: 'short',
  },
): string {
  return new Intl.DateTimeFormat(intlLocale[locale], { ...options, timeZone }).format(
    toDate(value),
  );
}

/**
 * A business date (`YYYY-MM-DD`, document 3 §3) as a calendar date. It is formatted in UTC from its
 * own parts, so no zone can shift it to the previous or next day.
 */
export function formatDate(
  locale: Locale,
  businessDate: string,
  options: Pick<Intl.DateTimeFormatOptions, 'dateStyle'> = { dateStyle: 'medium' },
): string {
  const match = businessDatePattern.exec(businessDate);
  if (!match) {
    throw new RangeError(`Not a business date (YYYY-MM-DD): ${businessDate}`);
  }
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError(`Not a calendar date: ${businessDate}`);
  }
  return new Intl.DateTimeFormat(intlLocale[locale], { ...options, timeZone: 'UTC' }).format(date);
}

/** A number with Western digits and the locale's separators. */
export function formatNumber(
  locale: Locale,
  value: number,
  options: Pick<Intl.NumberFormatOptions, 'minimumFractionDigits' | 'maximumFractionDigits'> = {},
): string {
  return new Intl.NumberFormat(intlLocale[locale], options).format(value);
}

/**
 * Integer halalas as SAR text with the currency code, e.g. `SAR 150.00` for 15000 (for text-only
 * contexts such as labels and exports). Screens use the `<Money>` component, which draws the riyal
 * sign as an SVG and calls `formatMoneyAmount`.
 */
export function formatMoney(locale: Locale, halalas: number): string {
  return new Intl.NumberFormat(intlLocale[locale], {
    style: 'currency',
    currency: 'SAR',
    currencyDisplay: 'code',
  }).format(toRiyals(halalas));
}

/** Integer halalas as the amount alone with two decimals, e.g. `150.00`. */
export function formatMoneyAmount(locale: Locale, halalas: number): string {
  return new Intl.NumberFormat(intlLocale[locale], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toRiyals(halalas));
}

function toRiyals(halalas: number): number {
  if (!Number.isSafeInteger(halalas)) {
    throw new RangeError(`Money is integer halalas: ${halalas}`);
  }
  return halalas / 100;
}

/**
 * An E.164 number for display, grouped for Saudi numbers (`+966 50 123 4567`) and wrapped in
 * left-to-right marks so the `+` stays in front inside Arabic text.
 */
export function formatPhone(e164: string): string {
  if (!e164Pattern.test(e164)) {
    throw new RangeError(`Not an E.164 number: ${e164}`);
  }
  const saudi = /^\+966(\d{2})(\d{3})(\d{4})$/.exec(e164);
  const display = saudi ? `+966 ${saudi[1]} ${saudi[2]} ${saudi[3]}` : e164;
  return `${lrm}${display}${lrm}`;
}
