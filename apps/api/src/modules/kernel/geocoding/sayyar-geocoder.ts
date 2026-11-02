import { withPortSpan } from '../telemetry/port-span.js';
import type {
  GeocodeQuery,
  GeocodeResult,
  GeocoderSource,
  NotFound,
  ShortCodeResult,
} from './geocoder.js';
import { GeocoderInputError, normaliseShortCode, notFound } from './geocoder.js';
import { composeQuery } from './hudhud-geocoder.js';
import {
  badAnswer,
  coordinateOf,
  getAnswer,
  joinParts,
  parseJson,
  sourceTimeoutMs,
  textOf,
  titleCase,
  withoutDistSuffix,
} from './source-http.js';

// The `sayyar` source (INT-2 plan 2.11, 2.12): the Sayyar checkout's location API, a mirror of the
// National Address, undocumented and keyless; called as eeasynew's SayyarAddressService calls it
// (read 2026-11-02), with the headers a browser on Sayyar's checkout sends.
// - Short code: `GET <SAYYAR_URL>/api/v1/locations/national-address?short_address=<code>` → flat
//   `latitude`, `longitude`, `city`, `city_en`, `district`, `district_en`, `post_code`, `street`,
//   `street_en`, `short_address`, `building_number`; an `error` object, an empty `short_address`
//   or a 404 is not found. Confidence 0.95.
// - Text: `GET …/api/v1/locations/search?query=<text>&session_token=server` → `results[] { id,
//   description, terms }`, then `GET …/api/v1/locations/<id>?session_token=server` → `{ lat, lng,
//   city, district, nationalAddress { district, districtL2, city, cityL2, postCode, shortAddress,
//   buildingNumber } }` for the first results until one carries coordinates. Confidence 0.8 when
//   the details carry a short address or a building number, else 0.6.
// No reverse lookup. Nothing but the code or the query text is sent.

export const sayyarNationalAddressPath = '/api/v1/locations/national-address';
export const sayyarSearchPath = '/api/v1/locations/search';
export const sayyarDetailsPath = '/api/v1/locations/';
/** Details asked for at most this many search results (each is a request). */
const maxDetailCalls = 3;

/** What a browser on Sayyar's checkout sends (eeasynew's recorded header set). */
export const sayyarHeaders: Readonly<Record<string, string>> = {
  accept: 'application/json',
  'accept-language': 'en-US,en;q=0.9,ar;q=0.8',
  'content-type': 'application/json',
  referer:
    'https://sayyar.com/checkout/guest?redirect_to=%2Fcheckout%2Fchoose-address-and-shipping',
  'sec-ch-ua': '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
};

export interface SayyarGeocoderOptions {
  /** `SAYYAR_URL` (`https://sayyar.com`). */
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export class SayyarGeocoder implements GeocoderSource {
  readonly provider = 'sayyar' as const;
  readonly #base: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(options: SayyarGeocoderOptions) {
    this.#base = options.baseUrl.replace(/\/+$/, '');
    this.#timeoutMs = options.timeoutMs ?? sourceTimeoutMs;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  #get(path: string, query: Record<string, string>, notFoundStatus?: number) {
    return getAnswer(
      {
        url: `${this.#base}${path}?${new URLSearchParams(query).toString()}`,
        headers: sayyarHeaders,
        timeoutMs: this.#timeoutMs,
        fetch: this.#fetch,
        now: this.#now,
      },
      notFoundStatus,
    );
  }

  async lookupShortCode(code: string): Promise<ShortCodeResult | NotFound> {
    const shortCode = normaliseShortCode(code);
    if (shortCode === undefined) throw new GeocoderInputError('code');
    return withPortSpan(
      { port: 'geocoder', method: 'lookup_short_code', provider: this.provider },
      async (span) => {
        const answer = await this.#get(
          sayyarNationalAddressPath,
          { short_address: shortCode },
          404,
        );
        span.setHttpStatus(answer.status);
        if (answer.status === 404) return notFound;
        const data = parseJson(answer.body);
        if (data === null || typeof data !== 'object' || Array.isArray(data)) return notFound;
        const d = data as Record<string, unknown>;
        if (d.error !== undefined || textOf(d.short_address) === undefined) return notFound;
        const lat = coordinateOf(d.latitude, 90);
        const lng = coordinateOf(d.longitude, 180);
        if (lat === undefined || lng === undefined) throw badAnswer();
        const building = textOf(d.building_number);
        const postCode = textOf(d.post_code);
        const addressEn = joinParts(
          [
            joinParts([building, textOf(d.street_en)], ' '),
            withoutDistSuffix(textOf(d.district_en)),
            joinParts([titleCase(textOf(d.city_en)), postCode], ' '),
          ],
          ', ',
        );
        const addressAr = joinParts(
          [
            joinParts([building, textOf(d.street)], ' '),
            textOf(d.district),
            joinParts([textOf(d.city), postCode], ' '),
          ],
          '، ',
        );
        if (addressEn === '' || addressAr === '') throw badAnswer();
        return {
          kind: 'found',
          point: { lat, lng },
          // Plan 2.11: a mirror's answer is trusted a little less than the register's.
          confidence: 0.95,
          addressAr,
          addressEn,
          shortCode,
          provider: this.provider,
        };
      },
    );
  }

  geocode(query: GeocodeQuery): Promise<GeocodeResult | NotFound> {
    return withPortSpan(
      { port: 'geocoder', method: 'geocode', provider: this.provider },
      async (span) => {
        const search = await this.#get(sayyarSearchPath, {
          query: composeQuery(query.text, query.city),
          session_token: 'server',
        });
        span.setHttpStatus(search.status);
        const results = (parseJson(search.body) as { results?: unknown } | undefined)?.results;
        if (results === undefined || results === null) return notFound;
        if (!Array.isArray(results)) throw badAnswer();
        const candidates = results
          .map((entry) => entry as Record<string, unknown> | null)
          .filter((entry) => textOf(entry?.id) !== undefined)
          .slice(0, maxDetailCalls);
        for (const candidate of candidates) {
          const details = await this.#get(
            `${sayyarDetailsPath}${encodeURIComponent(textOf(candidate?.id) ?? '')}`,
            { session_token: 'server' },
            404,
          );
          if (details.status === 404) continue;
          const data = parseJson(details.body) as Record<string, unknown> | undefined;
          if (data === null || typeof data !== 'object' || data.error !== undefined) continue;
          const lat = coordinateOf(data.lat, 90);
          const lng = coordinateOf(data.lng, 180);
          if (lat === undefined || lng === undefined) continue;
          const na = (data.nationalAddress ?? {}) as Record<string, unknown>;
          const ar = query.locale === 'ar';
          const district = ar
            ? (textOf(data.district) ?? textOf(na.district))
            : withoutDistSuffix(textOf(na.districtL2));
          const city = ar ? (textOf(data.city) ?? textOf(na.city)) : titleCase(textOf(na.cityL2));
          const formatted =
            textOf(candidate?.description) ?? joinParts([district, city], ar ? '، ' : ', ');
          if (formatted === '') continue;
          const precise =
            textOf(na.shortAddress) !== undefined || textOf(na.buildingNumber) !== undefined;
          return {
            kind: 'found',
            point: { lat, lng },
            confidence: precise ? 0.8 : 0.6,
            formatted,
            ...(district === undefined ? {} : { district }),
            ...(city === undefined ? {} : { city }),
            provider: this.provider,
          };
        }
        return notFound;
      },
    );
  }
}
