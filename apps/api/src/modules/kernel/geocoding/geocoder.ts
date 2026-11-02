// The geocoder port (INT-2 plan 2.1; integrations §2.2, §6.2): an address text, a National Address
// short code or a point turned into a located answer. Synchronous and read-only, so no outbox
// (ADR-0024). Nothing found is the value `{ kind: 'not_found' }`, never an exception; a failed
// provider call is PLAT-8's `ProviderFailure`. Sources (plan 2.11): the official National Address
// API (`spl`), the Sayyar mirror (`sayyar`) and Hudhud, run in order by `ChainGeocoder` in staging
// and production, and the fixture stub in local and ci. Callers inject `GeocoderService`
// (`GEOCODER`), which validates, caches and offers the degraded path.

export type GeocoderProviderName = 'spl' | 'sayyar' | 'hudhud' | 'stub';
export type GeocodeLocale = 'ar' | 'en';

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface GeocodeQuery {
  /** The address text: 1 to 500 characters, one line. */
  readonly text: string;
  /** The city, at most 120 characters; narrows the search (Hudhud: appended to the query). */
  readonly city?: string;
  /** The answer's language where the adapter has one (the stub); Hudhud has no such field. */
  readonly locale: GeocodeLocale;
}

export interface GeocodeResult {
  readonly kind: 'found';
  readonly point: GeoPoint;
  /** 0..1, derived by the adapter (Hudhud publishes none; plan 2.2). */
  readonly confidence: number;
  readonly formatted: string;
  readonly district?: string;
  readonly city?: string;
  readonly provider: GeocoderProviderName;
}

export interface ShortCodeResult {
  readonly kind: 'found';
  readonly point: GeoPoint;
  /**
   * A short code names one building (integrations §6.2: 1.0 by design): 1 from the register and
   * Hudhud, 0.95 from the Sayyar mirror (plan 2.11).
   */
  readonly confidence: number;
  readonly addressAr: string;
  readonly addressEn: string;
  /** The normalised code (`^[A-Z]{4}[0-9]{4}$`). */
  readonly shortCode: string;
  readonly provider: GeocoderProviderName;
}

export interface ReverseResult {
  readonly kind: 'found';
  readonly formatted: string;
  readonly district?: string;
  readonly city?: string;
  readonly postcode?: string;
  readonly provider: GeocoderProviderName;
}

export interface NotFound {
  readonly kind: 'not_found';
}

/** The degraded answer (plan 2.6): the provider failed or geocoding is disabled. */
export interface Unavailable {
  readonly kind: 'unavailable';
  readonly reason:
    'disabled' | 'no_source' | 'rate_limited' | 'unauthorised' | 'permanent' | 'transient';
}

export const notFound: NotFound = Object.freeze({ kind: 'not_found' });

/**
 * One source. A source answers the lookups it has (Sayyar has no reverse, SPL no free text); inputs
 * reach it validated and normalised by `GeocoderService`.
 */
export interface GeocoderSource {
  readonly provider: GeocoderProviderName;
  geocode?(query: GeocodeQuery): Promise<GeocodeResult | NotFound>;
  lookupShortCode?(code: string): Promise<ShortCodeResult | NotFound>;
  reverse?(point: GeoPoint): Promise<ReverseResult | NotFound>;
}

/** A source with every lookup (Hudhud, the stub). */
export interface Geocoder extends GeocoderSource {
  geocode(query: GeocodeQuery): Promise<GeocodeResult | NotFound>;
  lookupShortCode(code: string): Promise<ShortCodeResult | NotFound>;
  reverse(point: GeoPoint): Promise<ReverseResult | NotFound>;
}

/** An input the port refuses before any lookup; the caller answers `validation_failed`. */
export class GeocoderInputError extends Error {
  constructor(readonly field: 'text' | 'city' | 'code' | 'point') {
    super(`invalid geocoder input: ${field}`);
    this.name = 'GeocoderInputError';
  }
}

// Arabic-Indic (U+0660..0669) and Eastern Arabic-Indic (U+06F0..06F9) digits to Western.
function westernDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * The National Address short code of `input` (plan 2.3): trimmed, internal spaces and hyphens
 * removed, ASCII letters upper-cased, Arabic-Indic digits made Western, then `^[A-Z]{4}[0-9]{4}$`
 * (four letters from the postal code, four digits of the building number; SPL, read 2026-11-02).
 * Anything else is undefined.
 */
export function normaliseShortCode(input: string): string | undefined {
  if (typeof input !== 'string' || input.length > 40) return undefined;
  const code = westernDigits(input.trim())
    .replace(/[\s-]+/g, '')
    .replace(/[a-z]/g, (letter) => letter.toUpperCase());
  return /^[A-Z]{4}[0-9]{4}$/.test(code) ? code : undefined;
}
