import { oneLineTextProblem } from '../contract/text-rules.js';
import type { FieldProblem } from '../errors/api-exception.js';
import { ApiException } from '../errors/api-exception.js';
import type { OpeningHours, SiteKind } from '../schema/sites.js';

// The editable fields of a site (PLAT-12 plan 2.5; ADR-0018; data §2.1, §8) and the rules the
// contract's `Site` schema cannot say. `createSite` and `updateSite` both send the whole site:
// an optional field left out is cleared (no address, no short code, no point, no opening hours).

/** A point as the contract carries it; stored as `ST_SetSRID(ST_MakePoint(lng, lat), 4326)`. */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** The site body as the contract's schema parsed it (`Site` less its read-only fields). */
export interface SiteBody {
  readonly kind: SiteKind;
  readonly name_ar: string;
  readonly name_en: string;
  readonly address_text?: string | undefined;
  readonly national_address_short_code?: string | undefined;
  readonly point?: LatLng | undefined;
  readonly opening_hours?:
    | readonly {
        readonly weekday?: number | undefined;
        readonly opens?: string | undefined;
        readonly closes?: string | undefined;
      }[]
    | undefined;
}

/** A site's editable fields after the rules: every optional one present, null when cleared. */
export interface SiteFields {
  readonly kind: SiteKind;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly addressText: string | null;
  readonly nationalAddressShortCode: string | null;
  readonly point: LatLng | null;
  readonly openingHours: readonly OpeningHours[];
}

export const maxNameLength = 120;
export const maxAddressLength = 500;
export const maxOpeningHours = 14;
/** National Address short code: four letters, four digits (data §2.1 CHECK). */
const shortCodePattern = /^[A-Z]{4}[0-9]{4}$/;
/** `HH:MM`, 24 hours. */
const clockTime = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * The fields of `body` under plan 2.5's rules, or `400 validation_failed` with every problem: both
 * names 1 to 120 characters on one line, the address at most 500 characters, the short code
 * upper-cased and `^[A-Z]{4}[0-9]{4}$`, at most 14 opening rows each with a weekday and `HH:MM`
 * times (`closes` before `opens` is an overnight window).
 */
export function siteFields(body: SiteBody): SiteFields {
  const problems: FieldProblem[] = [];
  const add = (problem: FieldProblem | undefined) => {
    if (problem !== undefined) problems.push(problem);
  };
  add(oneLineTextProblem('/body/name_ar', body.name_ar, maxNameLength));
  add(oneLineTextProblem('/body/name_en', body.name_en, maxNameLength));
  const address = body.address_text ?? null;
  if (address !== null && Array.from(address).length > maxAddressLength) {
    add({ pointer: '/body/address_text', code: 'too_long' });
  }
  const shortCode = body.national_address_short_code?.toUpperCase() ?? null;
  if (shortCode !== null && !shortCodePattern.test(shortCode)) {
    add({ pointer: '/body/national_address_short_code', code: 'invalid' });
  }
  const rows = body.opening_hours ?? [];
  if (rows.length > maxOpeningHours) add({ pointer: '/body/opening_hours', code: 'invalid' });
  const openingHours: OpeningHours[] = [];
  rows.forEach((row, index) => {
    const at = `/body/opening_hours/${index}`;
    const { weekday, opens, closes } = row;
    if (weekday === undefined) add({ pointer: `${at}/weekday`, code: 'required' });
    for (const [name, value] of [
      ['opens', opens],
      ['closes', closes],
    ] as const) {
      if (value === undefined) add({ pointer: `${at}/${name}`, code: 'required' });
      else if (!clockTime.test(value)) add({ pointer: `${at}/${name}`, code: 'invalid' });
    }
    if (weekday !== undefined && opens !== undefined && closes !== undefined) {
      openingHours.push({ weekday, opens, closes });
    }
  });
  if (problems.length > 0) throw new ApiException('validation_failed', { fields: problems });
  return {
    kind: body.kind,
    nameAr: body.name_ar,
    nameEn: body.name_en,
    addressText: address,
    nationalAddressShortCode: shortCode,
    point: body.point === undefined ? null : { lat: body.point.lat, lng: body.point.lng },
    openingHours,
  };
}
