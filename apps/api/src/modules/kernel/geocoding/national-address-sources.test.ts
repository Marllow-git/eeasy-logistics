import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Secret } from '@eeasy-logistics/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { GeocoderInputError } from './geocoder.js';
import {
  SayyarGeocoder,
  sayyarDetailsPath,
  sayyarNationalAddressPath,
  sayyarSearchPath,
} from './sayyar-geocoder.js';
import {
  SplGeocoder,
  decryptPoiBody,
  poiKeyPath,
  poiReversePath,
  splShortCodePath,
} from './spl-geocoder.js';

// INT-2 plan 2.10, 2.11: the `spl` and `sayyar` sources against a local HTTP server answering the
// shapes eeasynew records for the official National Address API, the POI reverse lookup (its body
// encrypted here by the same OpenSSL derivation) and the Sayyar mirror (read 2026-11-02).

interface Seen {
  readonly path: string;
  readonly query: URLSearchParams;
  readonly headers: IncomingMessage['headers'];
}

type Answer = (seen: Seen, response: ServerResponse) => void;

let server: Server;
let baseUrl: string;
let answer: Answer;
let seen: Seen[] = [];

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
};

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://local');
    const entry: Seen = { path: url.pathname, query: url.searchParams, headers: request.headers };
    seen.push(entry);
    request.resume();
    request.on('end', () => answer(entry, response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  answer = (_seen, response) => json(response, 500, {});
});

async function failureOf(promise: Promise<unknown>): Promise<ProviderFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderFailure) return error;
    throw error;
  }
  throw new Error('expected a ProviderFailure');
}

/** What the POI API does: OpenSSL "Salted__", EVP_BytesToKey (MD5), AES-256-CBC, base64. */
function encryptPoiBody(value: unknown, passphrase: Buffer): string {
  const salt = randomBytes(8);
  const blocks: Buffer[] = [];
  let block = Buffer.alloc(0);
  while (blocks.length < 3) {
    block = createHash('md5')
      .update(Buffer.concat([block, passphrase, salt]))
      .digest();
    blocks.push(block);
  }
  const derived = Buffer.concat(blocks);
  const cipher = createCipheriv('aes-256-cbc', derived.subarray(0, 32), derived.subarray(32, 48));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('Salted__', 'latin1'), salt, body]).toString('base64');
}

/** The `spl` source with the key, or without one (`null`). */
const spl = (key: string | null = 'fake-national-address-key') =>
  new SplGeocoder({
    apiUrl: `${baseUrl}/`,
    poiUrl: baseUrl,
    apiKey: key === null ? undefined : new Secret(key),
  });

// The official API's `Addresses[0]` as eeasynew reads it.
const official = {
  Latitude: '24.69570000',
  Longitude: '46.68440000',
  District: 'Al Olaya Dist.',
  District_L2: 'العليا',
  City: 'RIYADH',
  City_L2: 'الرياض',
  PostCode: '12211',
  Street: 'King Fahd Road',
  Street_L2: 'طريق الملك فهد',
  BuildingNumber: '7572',
  CityId: '3',
  DistrictID: '10100003020',
  Address1: '7572 King Fahd Road',
  Address2: 'Al Olaya Dist. RIYADH 12211',
};

describe('SplGeocoder.lookupShortCode (the official API)', () => {
  it('sends the code and the key as the API expects and maps both languages', async () => {
    answer = (_seen, response) => json(response, 200, { Addresses: [official] });
    const result = await spl().lookupShortCode?.('rema 7572');
    const [request] = seen;
    expect(request?.path).toBe(splShortCodePath);
    expect(Object.fromEntries(request?.query ?? [])).toEqual({
      format: 'json',
      language: 'E',
      page: '1',
      encode: 'utf8',
      shortaddress: 'REMA7572',
      api_key: 'fake-national-address-key',
    });
    expect(result).toEqual({
      kind: 'found',
      point: { lat: 24.6957, lng: 46.6844 },
      confidence: 1,
      addressEn: '7572 King Fahd Road, Al Olaya, Riyadh 12211',
      addressAr: '7572 طريق الملك فهد، العليا، الرياض 12211',
      shortCode: 'REMA7572',
      provider: 'spl',
    });
  });

  it('answers not_found for an empty Addresses list or a 404', async () => {
    answer = (_seen, response) => json(response, 200, { Addresses: [] });
    expect(await spl().lookupShortCode?.('ABCD1234')).toEqual({ kind: 'not_found' });
    answer = (_seen, response) => json(response, 404, {});
    expect(await spl().lookupShortCode?.('ABCD1234')).toEqual({ kind: 'not_found' });
  });

  it('has no short-code lookup without the key', () => {
    expect(spl(null).lookupShortCode).toBeUndefined();
  });

  it('refuses a malformed code without a call', async () => {
    await expect(spl().lookupShortCode?.('ABC123')).rejects.toBeInstanceOf(GeocoderInputError);
    expect(seen).toHaveLength(0);
  });

  it('maps a 401, a 500 and an answer without coordinates, never naming the key', async () => {
    answer = (_seen, response) => json(response, 401, {});
    const refused = await failureOf(spl().lookupShortCode!('REMA7572'));
    expect(refused).toMatchObject({ reason: 'unauthorised', status: 401 });
    expect(refused.message).not.toContain('fake-national-address-key');
    answer = (_seen, response) => json(response, 500, {});
    expect(await failureOf(spl().lookupShortCode!('REMA7572'))).toMatchObject({
      reason: 'transient',
      status: 500,
    });
    answer = (_seen, response) =>
      json(response, 200, { Addresses: [{ ...official, Latitude: '' }] });
    expect(await failureOf(spl().lookupShortCode!('REMA7572'))).toMatchObject({
      status: 'BAD_RESPONSE',
    });
  });

  it('maps a timeout to transient TIMEOUT without a retry', async () => {
    answer = (_seen, response) => {
      setTimeout(() => json(response, 200, { Addresses: [official] }), 300);
    };
    const slow = new SplGeocoder({
      apiUrl: baseUrl,
      poiUrl: baseUrl,
      apiKey: new Secret('k'),
      timeoutMs: 50,
    });
    expect(await failureOf(slow.lookupShortCode!('REMA7572'))).toMatchObject({
      reason: 'transient',
      status: 'TIMEOUT',
    });
    expect(seen).toHaveLength(1);
  });
});

describe('SplGeocoder.reverse (the POI API)', () => {
  const passphrase = Buffer.from('a9f3c1d2e4b5a6c7d8e9f0a1b2c3d4e5', 'utf8');
  const properties = {
    emirate_id: '{11111111-1111-1111-1111-111111111111}',
    city_id: '{22222222-2222-2222-2222-222222222222}',
    district_id: '{D1204E03-0000-0000-0000-000000000000}',
    emirate_english: 'Riyadh',
    emirate_arabic: 'الرياض',
    city_english: 'RIYADH',
    city_arabic: 'الرياض',
    district_english: 'Al Olaya Dist.',
    district_arabic: 'العليا',
    postal_code: '12211',
    short_address: 'REMA7572',
  };

  const poi = (body: (seen: Seen) => string, key = passphrase) => {
    answer = (entry, response) => {
      if (entry.path === poiKeyPath) json(response, 200, { data: key.toString('hex') });
      else {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end(body(entry));
      }
    };
  };

  it('fetches the passphrase, sends the point with the map Referer and decrypts the answer', async () => {
    poi(() => encryptPoiBody({ data: { properties } }, passphrase));
    const result = await spl(null).reverse({ lat: 24.6957, lng: 46.6844 });
    expect(result).toEqual({
      kind: 'found',
      formatted: 'Al Olaya, Riyadh 12211',
      district: 'Al Olaya',
      city: 'Riyadh',
      postcode: '12211',
      provider: 'spl',
    });
    expect(seen.map((entry) => entry.path)).toEqual([poiReversePath, poiKeyPath]);
    const lookup = seen[0];
    expect(Object.fromEntries(lookup?.query ?? [])).toEqual({ lat: '24.6957', lng: '46.6844' });
    expect(lookup?.headers.referer).toBe('https://maps.address.gov.sa/');
  });

  it('keeps the passphrase, and fetches it once more when a kept one stops decrypting', async () => {
    const source = spl(null);
    poi(() => encryptPoiBody({ data: { properties } }, passphrase));
    await source.reverse({ lat: 24.6957, lng: 46.6844 });
    await source.reverse({ lat: 24.6957, lng: 46.6844 });
    expect(seen.filter((entry) => entry.path === poiKeyPath)).toHaveLength(1);
    // The key rotates.
    const rotated = Buffer.from('0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'utf8');
    seen = [];
    poi(() => encryptPoiBody({ data: { properties } }, rotated), rotated);
    expect(await source.reverse({ lat: 24.6957, lng: 46.6844 })).toMatchObject({
      district: 'Al Olaya',
    });
    expect(seen.filter((entry) => entry.path === poiKeyPath)).toHaveLength(1);
  });

  it('answers not_found for empty properties and fails on a body that never decrypts', async () => {
    poi(() => encryptPoiBody({ data: { properties: [] } }, passphrase));
    expect(await spl(null).reverse({ lat: 26, lng: 51 })).toEqual({ kind: 'not_found' });
    poi(() => 'U2FsdGVkX19ub3QgYSByZWFsIGJvZHkgYXQgYWxsLi4u');
    expect(await failureOf(spl(null).reverse({ lat: 26, lng: 51 }))).toMatchObject({
      reason: 'transient',
      status: 'BAD_RESPONSE',
    });
  });

  it('decrypts what OpenSSL encrypts and refuses anything else', () => {
    const body = encryptPoiBody({ ok: 1 }, passphrase);
    expect(decryptPoiBody(body, passphrase)).toEqual({ ok: 1 });
    expect(decryptPoiBody(`"${body}"`, passphrase)).toEqual({ ok: 1 });
    expect(decryptPoiBody(body, Buffer.from('another passphrase'))).toBeUndefined();
    expect(decryptPoiBody('not base64 at all!', passphrase)).toBeUndefined();
    expect(decryptPoiBody(Buffer.from('plain text body').toString('base64'), passphrase)).toBe(
      undefined,
    );
  });
});

describe('SayyarGeocoder', () => {
  const sayyar = () => new SayyarGeocoder({ baseUrl });

  // The national-address answer as eeasynew reads it.
  const national = {
    latitude: 21.5651,
    longitude: '39.1552',
    city: 'جدة',
    city_en: 'JEDDAH',
    district: 'الروضة',
    district_en: 'Al Rawdah Dist.',
    region_name: 'منطقة مكة المكرمة',
    region_name_en: 'Makkah Region',
    post_code: '23432',
    street: 'شارع الأمير سلطان',
    street_en: 'Prince Sultan Street',
    short_address: 'JRWA3105',
    building_number: '3105',
    additional_number: '7788',
  };

  it('looks up a short code with the browser headers and maps both languages at 0.95', async () => {
    answer = (_seen, response) => json(response, 200, national);
    const result = await sayyar().lookupShortCode('jrwa-3105');
    const [request] = seen;
    expect(request?.path).toBe(sayyarNationalAddressPath);
    expect(Object.fromEntries(request?.query ?? [])).toEqual({ short_address: 'JRWA3105' });
    expect(request?.headers.referer).toContain('https://sayyar.com/checkout/guest');
    expect(request?.headers['user-agent']).toContain('Chrome/146');
    expect(result).toEqual({
      kind: 'found',
      point: { lat: 21.5651, lng: 39.1552 },
      confidence: 0.95,
      addressEn: '3105 Prince Sultan Street, Al Rawdah, Jeddah 23432',
      addressAr: '3105 شارع الأمير سلطان، الروضة، جدة 23432',
      shortCode: 'JRWA3105',
      provider: 'sayyar',
    });
  });

  it.each([
    ['an error object', { error: { message: 'not found' } }],
    ['an empty short address', { ...national, short_address: '' }],
    ['an empty answer', {}],
  ])('answers not_found for %s', async (_name, body) => {
    answer = (_seen, response) => json(response, 200, body);
    expect(await sayyar().lookupShortCode('JRWA3105')).toEqual({ kind: 'not_found' });
  });

  it('answers not_found for a 404 and maps a 429', async () => {
    answer = (_seen, response) => json(response, 404, {});
    expect(await sayyar().lookupShortCode('JRWA3105')).toEqual({ kind: 'not_found' });
    answer = (_seen, response) => json(response, 429, {});
    expect(await failureOf(sayyar().lookupShortCode('JRWA3105'))).toMatchObject({
      reason: 'rate_limited',
      retryAfterS: 10,
    });
  });

  const details = (extra: Record<string, unknown> = {}) => ({
    lat: '21.5651',
    lng: 39.1552,
    city: 'جدة',
    district: 'الروضة',
    nationalAddress: {
      district: 'الروضة',
      districtL2: 'Al Rawdah Dist.',
      city: 'جدة',
      cityL2: 'JEDDAH',
      postCode: '23432',
      shortAddress: 'JRWA3105',
      buildingNumber: '3105',
    },
    ...extra,
  });

  it('searches the text with the city, then reads the details of the first located result', async () => {
    answer = (entry, response) => {
      if (entry.path === sayyarSearchPath) {
        json(response, 200, {
          results: [
            { id: 'p-1', description: 'Al Rawdah, Jeddah', terms: ['Al Rawdah', 'Jeddah'] },
            { id: 'p-2', description: 'Other' },
          ],
        });
      } else if (entry.path === `${sayyarDetailsPath}p-1`) {
        json(response, 200, details({ lat: null }));
      } else json(response, 200, details());
    };
    const result = await sayyar().geocode({ text: 'Al Rawdah', city: 'Jeddah', locale: 'en' });
    expect(Object.fromEntries(seen[0]?.query ?? [])).toEqual({
      query: 'Al Rawdah, Jeddah',
      session_token: 'server',
    });
    expect(seen.map((entry) => entry.path)).toEqual([
      sayyarSearchPath,
      `${sayyarDetailsPath}p-1`,
      `${sayyarDetailsPath}p-2`,
    ]);
    expect(result).toEqual({
      kind: 'found',
      point: { lat: 21.5651, lng: 39.1552 },
      confidence: 0.8,
      formatted: 'Other',
      district: 'Al Rawdah',
      city: 'Jeddah',
      provider: 'sayyar',
    });
  });

  it('answers in Arabic for the ar locale and at 0.6 without a short address or building', async () => {
    answer = (entry, response) => {
      if (entry.path === sayyarSearchPath) {
        json(response, 200, { results: [{ id: 'p-1', description: 'الروضة، جدة' }] });
      } else json(response, 200, details({ nationalAddress: { districtL2: 'Al Rawdah Dist.' } }));
    };
    expect(await sayyar().geocode({ text: 'حي الروضة', locale: 'ar' })).toMatchObject({
      confidence: 0.6,
      formatted: 'الروضة، جدة',
      district: 'الروضة',
      city: 'جدة',
    });
  });

  it('answers not_found for no results, or no located result among the first three', async () => {
    answer = (_seen, response) => json(response, 200, { results: [] });
    expect(await sayyar().geocode({ text: 'nowhere', locale: 'en' })).toEqual({
      kind: 'not_found',
    });
    seen = [];
    answer = (entry, response) => {
      if (entry.path === sayyarSearchPath) {
        json(response, 200, {
          results: ['a', 'b', 'c', 'd'].map((id) => ({ id, description: id })),
        });
      } else json(response, 404, {});
    };
    expect(await sayyar().geocode({ text: 'somewhere', locale: 'en' })).toEqual({
      kind: 'not_found',
    });
    expect(seen).toHaveLength(4);
  });

  it('has no reverse lookup', () => {
    expect((sayyar() as { reverse?: unknown }).reverse).toBeUndefined();
  });
});
