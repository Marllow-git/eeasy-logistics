import { readFileSync } from 'node:fs';
import type { ProviderFailure } from '../outbox/provider-failure.js';
import { withPortSpan } from '../telemetry/port-span.js';
import type {
  GeoPoint,
  GeocodeQuery,
  GeocodeResult,
  Geocoder,
  NotFound,
  ReverseResult,
  ShortCodeResult,
} from './geocoder.js';
import { GeocoderInputError, normaliseShortCode, notFound } from './geocoder.js';

// The fixture stub (INT-2 plan 2.5; integrations §2.2 "Stub", §9: local and ci only). No network:
// it answers from `apps/api/resources/geocode-fixture.json`, districts of Riyadh and Jeddah with
// approximate centroids and six fixture short codes, authored by hand. A district matches when its
// name, in either language, appears in the text after `حي` and "district" are stripped and the
// Arabic letter forms folded; the city (given, or named in the text) narrows the set. Its answers
// are never cached (the fixture is the cache).

export interface FixtureDistrict {
  readonly id: string;
  readonly name_ar: string;
  readonly name_en: string;
  readonly city_ar: string;
  readonly city_en: string;
  readonly lat: number;
  readonly lng: number;
}

export interface GeocodeFixture {
  readonly about: string;
  readonly licence: string;
  readonly districts: readonly FixtureDistrict[];
  readonly short_codes: Readonly<Record<string, string>>;
}

/** `reverse` answers the nearest district within this distance (plan 2.5). */
export const stubReverseRadiusKm = 15;
/** A district match in one city; a name several cities share, with no city to tell them apart. */
const unambiguousConfidence = 0.8;
const ambiguousConfidence = 0.5;

let fixtureCache: GeocodeFixture | undefined;

/** The fixture, read once (the first lookup, not the boot: only local and ci run the stub). */
export function loadGeocodeFixture(): GeocodeFixture {
  fixtureCache ??= JSON.parse(
    readFileSync(new URL('../../../../resources/geocode-fixture.json', import.meta.url), 'utf8'),
  ) as GeocodeFixture;
  return fixtureCache;
}

/**
 * Text for matching: lower case, Arabic diacritics and tatweel removed, alef forms, teh marbuta
 * and alef maqsura folded, punctuation (Arabic comma included) and hyphens to spaces, `حي` and
 * "district" dropped, spaces collapsed, padded with one space each side for whole-word matches.
 */
export function matchText(value: string): string {
  const folded = value
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((word) => word !== '' && word !== 'حي' && word !== 'district' && word !== 'dist')
    .join(' ');
  return ` ${folded} `;
}

/** The names a district answers to: both languages, and the English one without "Al". */
function districtKeys(district: FixtureDistrict): string[] {
  const english = matchText(district.name_en);
  const keys = [matchText(district.name_ar), english];
  if (english.startsWith(' al ') && english.length > 8) keys.push(` ${english.slice(4)}`);
  return keys;
}

const cityKeys = (district: FixtureDistrict) => [
  matchText(district.city_ar),
  matchText(district.city_en),
];

/** Great-circle distance in kilometres (haversine, mean Earth radius). */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const pointOf = (district: FixtureDistrict): GeoPoint => ({ lat: district.lat, lng: district.lng });

export class StubGeocoder implements Geocoder {
  readonly provider = 'stub' as const;
  #nextFailure: ProviderFailure | undefined;

  /** The next lookup throws `failure` (any `ProviderFailure`), then lookups resume. */
  failNext(failure: ProviderFailure): void {
    this.#nextFailure = failure;
  }

  geocode(query: GeocodeQuery): Promise<GeocodeResult | NotFound> {
    return this.#run('geocode', () => {
      const { districts } = loadGeocodeFixture();
      const text = matchText(query.text);
      let candidates = districts;
      if (query.city !== undefined && matchText(query.city).trim() !== '') {
        const city = matchText(query.city);
        candidates = candidates.filter((district) =>
          cityKeys(district).some((key) => city.includes(key)),
        );
      } else {
        const named = candidates.filter((district) =>
          cityKeys(district).some((key) => text.includes(key)),
        );
        if (named.length > 0) candidates = named;
      }
      // The longest matching name wins ("Obhur Al Shamaliyah" over a shorter one inside it).
      const matches = candidates
        .map((district) => ({
          district,
          length: Math.max(
            0,
            ...districtKeys(district)
              .filter((key) => text.includes(key))
              .map((key) => key.length),
          ),
        }))
        .filter((match) => match.length > 0);
      if (matches.length === 0) return notFound;
      const longest = Math.max(...matches.map((match) => match.length));
      const best = matches.filter((match) => match.length === longest);
      const district = best[0]!.district;
      const cities = new Set(best.map((match) => match.district.city_en));
      const ar = query.locale === 'ar';
      const name = ar ? district.name_ar : district.name_en;
      const city = ar ? district.city_ar : district.city_en;
      return {
        kind: 'found',
        point: pointOf(district),
        confidence: cities.size === 1 ? unambiguousConfidence : ambiguousConfidence,
        formatted: ar ? `${name}، ${city}` : `${name}, ${city}`,
        district: name,
        city,
        provider: this.provider,
      };
    });
  }

  lookupShortCode(code: string): Promise<ShortCodeResult | NotFound> {
    return this.#run('lookup_short_code', () => {
      const shortCode = normaliseShortCode(code);
      if (shortCode === undefined) throw new GeocoderInputError('code');
      const fixture = loadGeocodeFixture();
      const id = Object.hasOwn(fixture.short_codes, shortCode)
        ? fixture.short_codes[shortCode]
        : undefined;
      const district = fixture.districts.find((entry) => entry.id === id);
      if (district === undefined) return notFound;
      return {
        kind: 'found',
        point: pointOf(district),
        confidence: 1,
        addressAr: `${district.name_ar}، ${district.city_ar}`,
        addressEn: `${district.name_en}, ${district.city_en}`,
        shortCode,
        provider: this.provider,
      };
    });
  }

  reverse(point: GeoPoint): Promise<ReverseResult | NotFound> {
    return this.#run('reverse', () => {
      let nearest: { district: FixtureDistrict; km: number } | undefined;
      for (const district of loadGeocodeFixture().districts) {
        const km = distanceKm(point, pointOf(district));
        if (nearest === undefined || km < nearest.km) nearest = { district, km };
      }
      if (nearest === undefined || nearest.km > stubReverseRadiusKm) return notFound;
      const { district } = nearest;
      return {
        kind: 'found',
        formatted: `${district.name_en}, ${district.city_en}`,
        district: district.name_en,
        city: district.city_en,
        provider: this.provider,
      };
    });
  }

  #run<T>(method: string, lookup: () => T): Promise<T> {
    return withPortSpan({ port: 'geocoder', method, provider: this.provider }, () => {
      const failure = this.#nextFailure;
      if (failure !== undefined) {
        this.#nextFailure = undefined;
        return Promise.reject(failure);
      }
      return Promise.resolve(lookup());
    });
  }
}
