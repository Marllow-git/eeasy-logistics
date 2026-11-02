import { createDecipheriv, createHash } from 'node:crypto';
import type { Secret } from '@eeasy-logistics/config';
import { withPortSpan } from '../telemetry/port-span.js';
import type {
  GeoPoint,
  GeocoderSource,
  NotFound,
  ReverseResult,
  ShortCodeResult,
} from './geocoder.js';
import { GeocoderInputError, normaliseShortCode, notFound } from './geocoder.js';
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

// The `spl` source (INT-2 plan 2.11, 2.12): Saudi Post's National Address.
// - Short code, the official API with `NATIONAL_ADDRESS_API_KEY` (as eeasynew's
//   AddressLookupService calls it, read 2026-11-02): `GET <SPL_API_URL>/NationalAddress/
//   FullNAByShortAddress/FullNAByShortAddress?format=json&language=E&page=1&encode=utf8&
//   shortaddress=<code>&api_key=<key>` → `Addresses[0]` (`Latitude`, `Longitude`, `District`,
//   `District_L2`, `City`, `City_L2`, `PostCode`, `Street`, `Street_L2`, `BuildingNumber`); an empty
//   `Addresses` or a 404 is not found. The key travels in the query string (the API's own design):
//   no URL reaches a span, a log or a message.
// - Reverse, the POI API of the National Address map (undocumented, no key; eeasynew's
//   SaudiNationalAddressService): `GET <SPL_POI_URL>/core/poi-service/v1/encrypt-key` → `{ data:
//   <hex passphrase> }`, then `GET …/addresses/coordinates_lookup_v3?lat=&lng=` → a base64
//   OpenSSL "Salted__" body, AES-256-CBC under the EVP_BytesToKey (MD5) derivation of that
//   passphrase, holding `{ data: { properties } }` (`district_english`, `district_arabic`,
//   `city_english`, `city_arabic`, `postal_code`, `short_address`); empty properties are not found.
//   The passphrase is kept an hour and fetched again once when a body does not decrypt (rotation).

export const splShortCodePath = '/NationalAddress/FullNAByShortAddress/FullNAByShortAddress';
export const poiKeyPath = '/core/poi-service/v1/encrypt-key';
export const poiReversePath = '/core/poi-service/v1/addresses/coordinates_lookup_v3';
/** The National Address map sends this `Referer`; the POI API expects it (eeasynew). */
export const poiReferer = 'https://maps.address.gov.sa/';
const passphraseTtlMs = 60 * 60 * 1000;

export interface SplGeocoderOptions {
  /** `SPL_API_URL` (`https://apina.address.gov.sa`). */
  readonly apiUrl: string;
  /** `SPL_POI_URL` (`https://beta-api.address.gov.sa`). */
  readonly poiUrl: string;
  /** `NATIONAL_ADDRESS_API_KEY`; without it the source has no short-code lookup. */
  readonly apiKey?: Secret | undefined;
  readonly timeoutMs?: number;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

/** OpenSSL's EVP_BytesToKey with MD5, one iteration: a 32-byte key and a 16-byte IV. */
function evpBytesToKey(passphrase: Buffer, salt: Buffer): { key: Buffer; iv: Buffer } {
  const blocks: Buffer[] = [];
  let block = Buffer.alloc(0);
  while (blocks.length * 16 < 48) {
    block = createHash('md5')
      .update(Buffer.concat([block, passphrase, salt]))
      .digest();
    blocks.push(block);
  }
  const derived = Buffer.concat(blocks);
  return { key: derived.subarray(0, 32), iv: derived.subarray(32, 48) };
}

/** The JSON inside a POI body, or undefined when it does not decrypt under `passphrase`. */
export function decryptPoiBody(body: string, passphrase: Buffer): unknown {
  const text = body.trim().replace(/^"|"$/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return undefined;
  const data = Buffer.from(text, 'base64');
  if (data.length < 32 || data.subarray(0, 8).toString('latin1') !== 'Salted__') return undefined;
  const { key, iv } = evpBytesToKey(passphrase, data.subarray(8, 16));
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    const plain = Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]);
    return parseJson(plain.toString('utf8'));
  } catch {
    return undefined;
  }
}

/** `data.properties` of a decrypted POI answer, when it is a non-empty object. */
function poiProperties(value: unknown): Record<string, unknown> | undefined {
  const field = (object: unknown, name: string): unknown =>
    object !== null && typeof object === 'object' && !Array.isArray(object)
      ? (object as Record<string, unknown>)[name]
      : undefined;
  const properties = field(field(value, 'data'), 'properties');
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
    return undefined;
  }
  return Object.keys(properties).length === 0 ? undefined : (properties as Record<string, unknown>);
}

export class SplGeocoder implements GeocoderSource {
  readonly provider = 'spl' as const;
  readonly #apiUrl: string;
  readonly #poiUrl: string;
  readonly #key: Secret | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  #passphrase: { value: Buffer; until: number } | undefined;

  /** Present only with the API key (plan 2.11: a source missing its key is skipped). */
  readonly lookupShortCode: ((code: string) => Promise<ShortCodeResult | NotFound>) | undefined;

  constructor(options: SplGeocoderOptions) {
    this.#apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.#poiUrl = options.poiUrl.replace(/\/+$/, '');
    this.#key = options.apiKey;
    this.#timeoutMs = options.timeoutMs ?? sourceTimeoutMs;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? (() => new Date());
    this.lookupShortCode =
      options.apiKey === undefined ? undefined : (code) => this.#lookupShortCode(code);
  }

  #request(url: string, headers: Record<string, string>) {
    return { url, headers, timeoutMs: this.#timeoutMs, fetch: this.#fetch, now: this.#now };
  }

  async #lookupShortCode(code: string): Promise<ShortCodeResult | NotFound> {
    const shortCode = normaliseShortCode(code);
    if (shortCode === undefined) throw new GeocoderInputError('code');
    const key = this.#key;
    if (key === undefined) throw new GeocoderInputError('code');
    return withPortSpan(
      { port: 'geocoder', method: 'lookup_short_code', provider: this.provider },
      async (span) => {
        const query = new URLSearchParams({
          format: 'json',
          language: 'E',
          page: '1',
          encode: 'utf8',
          shortaddress: shortCode,
          api_key: key.reveal(),
        });
        const answer = await getAnswer(
          this.#request(`${this.#apiUrl}${splShortCodePath}?${query.toString()}`, {
            accept: 'application/json',
          }),
          404,
        );
        span.setHttpStatus(answer.status);
        if (answer.status === 404) return notFound;
        const addresses = (parseJson(answer.body) as { Addresses?: unknown } | undefined)
          ?.Addresses;
        if (addresses === undefined || addresses === null) return notFound;
        if (!Array.isArray(addresses)) throw badAnswer();
        if (addresses.length === 0) return notFound;
        const first = addresses[0] as Record<string, unknown> | null;
        const lat = coordinateOf(first?.Latitude, 90);
        const lng = coordinateOf(first?.Longitude, 180);
        if (lat === undefined || lng === undefined) throw badAnswer();
        const building = textOf(first?.BuildingNumber);
        const postCode = textOf(first?.PostCode);
        const districtEn = withoutDistSuffix(textOf(first?.District));
        const cityEn = titleCase(textOf(first?.City));
        const addressEn = joinParts(
          [
            joinParts([building, textOf(first?.Street)], ' '),
            districtEn,
            joinParts([cityEn, postCode], ' '),
          ],
          ', ',
        );
        const addressAr = joinParts(
          [
            joinParts([building, textOf(first?.Street_L2)], ' '),
            textOf(first?.District_L2),
            joinParts([textOf(first?.City_L2), postCode], ' '),
          ],
          '، ',
        );
        if (addressEn === '' || addressAr === '') throw badAnswer();
        return {
          kind: 'found',
          point: { lat, lng },
          confidence: 1,
          addressAr,
          addressEn,
          shortCode,
          provider: this.provider,
        };
      },
    );
  }

  reverse(point: GeoPoint): Promise<ReverseResult | NotFound> {
    return withPortSpan(
      { port: 'geocoder', method: 'reverse', provider: this.provider },
      async (span) => {
        const query = new URLSearchParams({ lat: String(point.lat), lng: String(point.lng) });
        const answer = await getAnswer(
          this.#request(`${this.#poiUrl}${poiReversePath}?${query.toString()}`, this.#poiHeaders()),
        );
        span.setHttpStatus(answer.status);
        const passphrase = await this.#poiPassphrase(false);
        let decrypted: unknown = decryptPoiBody(answer.body, passphrase.value);
        // The passphrase rotates: one fresh fetch when a kept one does not decrypt (eeasynew).
        if (decrypted === undefined && passphrase.kept) {
          decrypted = decryptPoiBody(answer.body, (await this.#poiPassphrase(true)).value);
        }
        if (decrypted === undefined) throw badAnswer();
        const p = poiProperties(decrypted);
        if (p === undefined) return notFound;
        const district = withoutDistSuffix(textOf(p.district_english));
        const city = titleCase(textOf(p.city_english));
        const postcode = textOf(p.postal_code);
        if (district === undefined && city === undefined) return notFound;
        return {
          kind: 'found',
          formatted: joinParts([district, joinParts([city, postcode], ' ')], ', '),
          ...(district === undefined ? {} : { district }),
          ...(city === undefined ? {} : { city }),
          ...(postcode === undefined ? {} : { postcode }),
          provider: this.provider,
        };
      },
    );
  }

  #poiHeaders(): Record<string, string> {
    return { accept: 'application/json', referer: poiReferer, 'x-correlation-id': 'elx-geocode' };
  }

  /** The POI passphrase (hex-decoded), kept an hour; `fresh` fetches it again. */
  async #poiPassphrase(fresh: boolean): Promise<{ value: Buffer; kept: boolean }> {
    const now = this.#now().getTime();
    if (!fresh && this.#passphrase !== undefined && this.#passphrase.until > now) {
      return { value: this.#passphrase.value, kept: true };
    }
    const answer = await getAnswer(
      this.#request(`${this.#poiUrl}${poiKeyPath}`, this.#poiHeaders()),
    );
    const hex = (parseJson(answer.body) as { data?: unknown } | undefined)?.data;
    if (typeof hex !== 'string' || !/^(?:[0-9a-fA-F]{2}){8,256}$/.test(hex)) throw badAnswer();
    const value = Buffer.from(hex, 'hex');
    this.#passphrase = { value, until: now + passphraseTtlMs };
    return { value, kept: false };
  }
}
