import type { Secret } from '@eeasy-logistics/config';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { retryAfterSeconds } from '../push/expo-push-sender.js';
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
import { badAnswer, geocoderFailure } from './source-http.js';

// The Hudhud adapter (INT-2 plan 2.2; integrations §2.2, §6.1; ADR-0010). Three JSON calls on
// Hudhud's documented API (docs/research/hudhud-geocoding-2026-11.md §1, read 2026-11-02), each a
// `POST` with the secret key as a bearer token and the envelope `{ ok, data, error }`: search
// (`{ query }` → `data.results[]`, numbers), short-code lookup (`{ shortcode }` → `data`, 404 =
// not found), reverse (`{ lat, lon }` → `data`, coordinates as strings). 2 s per request, one retry
// on a network error or a timeout only. Hudhud publishes no confidence: the adapter derives one.
// Only the query text, the code or the point leaves the process; none of them reaches a span, a
// log line or a failure message.

export const searchPath = '/v1/geocoding/search';
export const shortCodePath = '/v1/geocoding/lookup_shortcode';
export const reversePath = '/v1/geocoding/reverse';
/** Integrations §2.2: 2 s per request. */
export const hudhudTimeoutMs = 2_000;
/** Answers longer than this are not read (a search answer is a few kilobytes). */
const maxAnswerBytes = 512 * 1024;
/** `address_type` values of a settlement-level match, not a building (plan 2.2). */
const settlementTypes: ReadonlySet<string> = new Set(['city', 'region', 'country', 'state']);

export interface HudhudGeocoderOptions {
  /** `HUDHUD_API_URL`: `https://b.hudhud.sa`, or a local server in tests. */
  readonly baseUrl: string;
  /** `HUDHUD_API_KEY`, the secret key. */
  readonly apiKey: Secret;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
  /** For an HTTP-date `Retry-After`. */
  readonly now?: () => Date;
}

/**
 * The search text: whitespace collapsed, and `, <city>` appended when a city is given and the text
 * does not already contain it (case-insensitive). Hudhud's search has no city field.
 */
export function composeQuery(text: string, city: string | undefined): string {
  const collapse = (value: string) => value.trim().replace(/\s+/g, ' ');
  const query = collapse(text);
  const place = city === undefined ? '' : collapse(city);
  if (place === '' || query.toLowerCase().includes(place.toLowerCase())) return query;
  return `${query}, ${place}`;
}

/**
 * The derived confidence of a search answer (plan 2.2, §7 #3): 0.9 for a single result, 0.7 for
 * the first of several, 0.2 less for a settlement-level match, never below 0.1.
 */
export function searchConfidence(resultCount: number, addressType: string | undefined): number {
  let confidence = resultCount === 1 ? 0.9 : 0.7;
  if (addressType !== undefined && settlementTypes.has(addressType.toLowerCase())) {
    confidence -= 0.2;
  }
  return Math.round(Math.max(0.1, Math.min(1, confidence)) * 100) / 100;
}

/** A WGS84 coordinate pair, numbers only (search, lookup). */
function numericPoint(lat: unknown, lon: unknown): GeoPoint | undefined {
  if (typeof lat !== 'number' || typeof lon !== 'number') return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lng: lon };
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

type Method = 'geocode' | 'lookup_short_code' | 'reverse';

/** Hudhud's answer envelope (research note §1.3). */
interface Envelope {
  readonly ok?: unknown;
  readonly data?: unknown;
  readonly error?: unknown;
}

export class HudhudGeocoder implements Geocoder {
  readonly provider = 'hudhud' as const;
  readonly #base: string;
  readonly #key: Secret;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(options: HudhudGeocoderOptions) {
    this.#base = options.baseUrl.replace(/\/+$/, '');
    this.#key = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? hudhudTimeoutMs;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async geocode(query: GeocodeQuery): Promise<GeocodeResult | NotFound> {
    // `locale` has no field in Hudhud's search (research note §1.7).
    const answer = await this.#post('geocode', searchPath, {
      query: composeQuery(query.text, query.city),
    });
    const results = (answer as { results?: unknown } | null)?.results;
    if (!Array.isArray(results)) throw badAnswer();
    if (results.length === 0) return notFound;
    const first = results[0] as Record<string, unknown> | null;
    const point = numericPoint(first?.lat, first?.lon);
    const formatted = text(first?.display_name) ?? text(first?.name);
    if (point === undefined || formatted === undefined) throw badAnswer();
    const addressType = typeof first?.address_type === 'string' ? first.address_type : undefined;
    return {
      kind: 'found',
      point,
      confidence: searchConfidence(results.length, addressType),
      formatted,
      provider: this.provider,
    };
  }

  async lookupShortCode(code: string): Promise<ShortCodeResult | NotFound> {
    const shortCode = normaliseShortCode(code);
    if (shortCode === undefined) throw new GeocoderInputError('code');
    const answer = await this.#post('lookup_short_code', shortCodePath, { shortcode: shortCode });
    if (answer === notFound) return notFound;
    const data = answer as Record<string, unknown> | null;
    const location = data?.location as Record<string, unknown> | undefined;
    const point = numericPoint(location?.lat, location?.lon);
    const addressAr = text(data?.address_ar);
    const addressEn = text(data?.address_en);
    if (point === undefined || addressAr === undefined || addressEn === undefined) {
      throw badAnswer();
    }
    return {
      kind: 'found',
      point,
      confidence: 1,
      addressAr,
      addressEn,
      shortCode,
      provider: this.provider,
    };
  }

  async reverse(point: GeoPoint): Promise<ReverseResult | NotFound> {
    const answer = await this.#post('reverse', reversePath, { lat: point.lat, lon: point.lng });
    const data = answer as Record<string, unknown> | null;
    // No documented "nothing here" answer: an answer without a display name is taken as one. The
    // answer's own `lat`/`lon` (strings) are not needed: the port's reverse returns no point.
    const formatted = text(data?.display_name);
    if (formatted === undefined) return notFound;
    const address = (data?.address ?? {}) as Record<string, unknown>;
    const district = text(address.neighbourhood) ?? text(address.suburb);
    const city = text(address.city);
    const postcode = text(address.postcode);
    return {
      kind: 'found',
      formatted,
      ...(district === undefined ? {} : { district }),
      ...(city === undefined ? {} : { city }),
      ...(postcode === undefined ? {} : { postcode }),
      provider: this.provider,
    };
  }

  /**
   * One POST under its port span, retried once on a network error or a timeout; the `data` of a
   * successful envelope, `notFound` for the short-code lookup's 404, else the mapped failure.
   */
  #post(method: Method, path: string, body: Record<string, unknown>): Promise<unknown> {
    return withPortSpan({ port: 'geocoder', method, provider: this.provider }, async (span) => {
      let response: Response;
      let raw: string;
      for (let attempt = 1; ; attempt += 1) {
        try {
          response = await this.#fetch(`${this.#base}${path}`, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
              authorization: `Bearer ${this.#key.reveal()}`,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.#timeoutMs),
          });
          raw = await response.text();
          break;
        } catch (error) {
          if (attempt < 2) continue;
          const timedOut = error instanceof Error && error.name === 'TimeoutError';
          throw new ProviderFailure(
            'transient',
            timedOut ? 'the geocoder timed out' : 'the geocoder is unreachable',
            { status: timedOut ? 'TIMEOUT' : 'NETWORK' },
          );
        }
      }
      span.setHttpStatus(response.status);
      if (method === 'lookup_short_code' && response.status === 404) return notFound;
      if (!response.ok) {
        const retryAfter = retryAfterSeconds(response.headers.get('retry-after'), this.#now());
        throw geocoderFailure(response.status, retryAfter);
      }
      let envelope: Envelope | null = null;
      if (raw.length <= maxAnswerBytes) {
        try {
          envelope = JSON.parse(raw) as Envelope | null;
        } catch {
          envelope = null;
        }
      }
      if (envelope === null || typeof envelope !== 'object') throw badAnswer();
      if (envelope.ok !== true) {
        // A 200 that says it failed: Hudhud's own words, cut short (plan 2.2).
        const message =
          typeof envelope.error === 'string' && envelope.error !== ''
            ? envelope.error.slice(0, 120)
            : 'the geocoder answered ok: false';
        throw new ProviderFailure('transient', message, { status: response.status });
      }
      return envelope.data;
    });
  }
}
