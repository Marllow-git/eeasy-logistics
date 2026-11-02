import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Secret } from '@eeasy-logistics/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { GeocoderInputError } from './geocoder.js';
import {
  HudhudGeocoder,
  composeQuery,
  reversePath,
  searchConfidence,
  searchPath,
  shortCodePath,
} from './hudhud-geocoder.js';

// INT-2 plan 2.2, 2.10: the Hudhud adapter against a local HTTP server that answers with the shapes
// of Hudhud's documentation (docs/research/hudhud-geocoding-2026-11.md §1.3, §1.4, read 2026-11-02).

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: unknown;
}

type Answer = (seen: Seen, response: ServerResponse, n: number) => void;

let server: Server;
let baseUrl: string;
let answer: Answer;
let seen: Seen[] = [];

const json = (response: ServerResponse, status: number, body: unknown, headers = {}) => {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
};

const ok = (data: unknown) => ({ ok: true, data, error: null });

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (raw += chunk));
    request.on('end', () => {
      const entry: Seen = {
        method: request.method ?? '',
        path: request.url ?? '',
        headers: request.headers,
        body: raw === '' ? null : (JSON.parse(raw) as unknown),
      };
      seen.push(entry);
      answer(entry, response, seen.length);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  answer = (_seen, response) => json(response, 200, ok({ results: [] }));
});

const geocoder = (options: Partial<ConstructorParameters<typeof HudhudGeocoder>[0]> = {}) =>
  new HudhudGeocoder({ baseUrl, apiKey: new Secret('fake-hudhud-secret-key'), ...options });

async function failureOf(promise: Promise<unknown>): Promise<ProviderFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderFailure) return error;
    throw error;
  }
  throw new Error('expected a ProviderFailure');
}

// The search example of Hudhud's documentation, trimmed to the documented fields.
const zoo = {
  name: 'Riyadh Zoo',
  display_name: 'Riyadh Zoo, Al Malaz, Riyadh, Saudi Arabia',
  lat: 24.6716,
  lon: 46.7372,
  place_id: 123456,
  category: 'tourism',
  type: 'zoo',
  address_type: 'tourism',
  bounding_box: { min_lat: 24.67, max_lat: 24.673, min_lon: 46.735, max_lon: 46.739 },
};

describe('composeQuery', () => {
  it('appends the city when it is not already in the text, case-insensitive', () => {
    expect(composeQuery('King Fahd Road, Al Olaya', 'Riyadh')).toBe(
      'King Fahd Road, Al Olaya, Riyadh',
    );
    expect(composeQuery('King Fahd Road, Al Olaya, riyadh', 'Riyadh')).toBe(
      'King Fahd Road, Al Olaya, riyadh',
    );
    expect(composeQuery('حي العليا', 'الرياض')).toBe('حي العليا, الرياض');
    expect(composeQuery('حي العليا الرياض', 'الرياض')).toBe('حي العليا الرياض');
  });

  it('trims and collapses whitespace and ignores an empty city', () => {
    expect(composeQuery('  King   Fahd\tRoad ', undefined)).toBe('King Fahd Road');
    expect(composeQuery('Al Olaya', '  ')).toBe('Al Olaya');
    expect(composeQuery('Al Olaya', '  Riyadh ')).toBe('Al Olaya, Riyadh');
  });
});

describe('searchConfidence', () => {
  it('is 0.9 for a single result and 0.7 for the first of several', () => {
    expect(searchConfidence(1, 'tourism')).toBe(0.9);
    expect(searchConfidence(5, 'house')).toBe(0.7);
  });

  it.each(['city', 'region', 'country', 'state', 'City'])(
    'is lowered by 0.2 for a settlement-level match (%s)',
    (addressType) => {
      expect(searchConfidence(1, addressType)).toBe(0.7);
      expect(searchConfidence(3, addressType)).toBe(0.5);
    },
  );

  it('stays within 0.1..1 and rounds to two decimals', () => {
    for (const count of [1, 2, 50]) {
      for (const type of [undefined, 'city', 'house']) {
        const value = searchConfidence(count, type);
        expect(value).toBeGreaterThanOrEqual(0.1);
        expect(value).toBeLessThanOrEqual(1);
        expect(Math.round(value * 100) / 100).toBe(value);
      }
    }
  });
});

describe('HudhudGeocoder.geocode', () => {
  it('posts only the query with the bearer key and maps the first result', async () => {
    answer = (_seen, response) => json(response, 200, ok({ results: [zoo] }));
    const result = await geocoder().geocode({
      text: '  Riyadh   Zoo ',
      city: 'Riyadh',
      locale: 'ar',
    });
    expect(result).toEqual({
      kind: 'found',
      point: { lat: 24.6716, lng: 46.7372 },
      confidence: 0.9,
      formatted: 'Riyadh Zoo, Al Malaz, Riyadh, Saudi Arabia',
      provider: 'hudhud',
    });
    expect(seen).toHaveLength(1);
    const [request] = seen;
    expect(request?.method).toBe('POST');
    expect(request?.path).toBe(searchPath);
    expect(request?.headers.authorization).toBe('Bearer fake-hudhud-secret-key');
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers.accept).toBe('application/json');
    // Nothing but the query leaves the process (integrations §6.1): no locale, account or name.
    expect(request?.body).toEqual({ query: 'Riyadh Zoo' });
  });

  it('appends the city to the query and takes 0.7 for the first of several', async () => {
    answer = (_seen, response) =>
      json(response, 200, ok({ results: [zoo, { ...zoo, name: 'Other', lat: 24.7 }] }));
    const result = await geocoder().geocode({ text: 'Zoo', city: 'Riyadh', locale: 'en' });
    expect(seen[0]?.body).toEqual({ query: 'Zoo, Riyadh' });
    expect(result).toMatchObject({ kind: 'found', confidence: 0.7, point: { lat: 24.6716 } });
  });

  it('lowers a settlement-level match', async () => {
    answer = (_seen, response) =>
      json(response, 200, ok({ results: [{ ...zoo, address_type: 'city' }] }));
    expect(await geocoder().geocode({ text: 'Riyadh', locale: 'en' })).toMatchObject({
      confidence: 0.7,
    });
  });

  it('answers not_found for an empty result list', async () => {
    expect(await geocoder().geocode({ text: 'nowhere at all', locale: 'en' })).toEqual({
      kind: 'not_found',
    });
  });

  it('treats a result without a usable point as a bad answer', async () => {
    answer = (_seen, response) =>
      json(response, 200, ok({ results: [{ ...zoo, lat: '24.6716' }] }));
    const failure = await failureOf(geocoder().geocode({ text: 'Zoo', locale: 'en' }));
    expect(failure).toMatchObject({ reason: 'transient', status: 'BAD_RESPONSE' });
    answer = (_seen, response) => json(response, 200, ok({ results: [{ ...zoo, lat: 91 }] }));
    expect(await failureOf(geocoder().geocode({ text: 'Zoo', locale: 'en' }))).toMatchObject({
      status: 'BAD_RESPONSE',
    });
    answer = (_seen, response) => json(response, 200, ok({}));
    expect(await failureOf(geocoder().geocode({ text: 'Zoo', locale: 'en' }))).toMatchObject({
      status: 'BAD_RESPONSE',
    });
  });
});

describe('HudhudGeocoder.lookupShortCode', () => {
  const lookup = {
    shortcode: 'REMA7572',
    address_en: 'Al Olaya, Riyadh 12211, Saudi Arabia',
    address_ar: 'العليا، الرياض 12211، المملكة العربية السعودية',
    location: { lat: 24.6957, lon: 46.6844 },
  };

  it('posts the normalised code and maps both addresses with confidence 1', async () => {
    answer = (_seen, response) => json(response, 200, ok(lookup));
    const result = await geocoder().lookupShortCode('rema ٧٥٧٢');
    expect(seen[0]?.path).toBe(shortCodePath);
    expect(seen[0]?.body).toEqual({ shortcode: 'REMA7572' });
    expect(result).toEqual({
      kind: 'found',
      point: { lat: 24.6957, lng: 46.6844 },
      confidence: 1,
      addressAr: 'العليا، الرياض 12211، المملكة العربية السعودية',
      addressEn: 'Al Olaya, Riyadh 12211, Saudi Arabia',
      shortCode: 'REMA7572',
      provider: 'hudhud',
    });
  });

  it('answers not_found for the documented 404', async () => {
    answer = (_seen, response) =>
      json(response, 404, { ok: false, data: null, error: 'Shortcode not found' });
    expect(await geocoder().lookupShortCode('ABCD1234')).toEqual({ kind: 'not_found' });
    expect(seen).toHaveLength(1);
  });

  it('refuses a malformed code without a call', async () => {
    await expect(geocoder().lookupShortCode('REMA757')).rejects.toBeInstanceOf(GeocoderInputError);
    expect(seen).toHaveLength(0);
  });
});

describe('HudhudGeocoder.reverse', () => {
  // The reverse example's shape: coordinates as strings, the address object.
  const place = {
    address: {
      city: 'Riyadh',
      country: 'Saudi Arabia',
      country_code: 'sa',
      municipality: 'Riyadh Municipality',
      neighbourhood: 'Al Olaya',
      postcode: '12211',
      province: 'Riyadh Province',
      road: 'King Fahd Road',
      suburb: 'Olaya Sub-Municipality',
    },
    display_name: 'King Fahd Road, Al Olaya, Riyadh 12211, Saudi Arabia',
    name: 'King Fahd Road',
    lat: '24.6957',
    lon: '46.6844',
    place_id: 99,
    boundingbox: ['24.69', '24.70', '46.68', '46.69'],
  };

  it('posts lat and lon and maps the address', async () => {
    answer = (_seen, response) => json(response, 200, ok(place));
    const result = await geocoder().reverse({ lat: 24.6957, lng: 46.6844 });
    expect(seen[0]?.path).toBe(reversePath);
    expect(seen[0]?.body).toEqual({ lat: 24.6957, lon: 46.6844 });
    expect(result).toEqual({
      kind: 'found',
      formatted: 'King Fahd Road, Al Olaya, Riyadh 12211, Saudi Arabia',
      district: 'Al Olaya',
      city: 'Riyadh',
      postcode: '12211',
      provider: 'hudhud',
    });
  });

  it('takes the suburb when there is no neighbourhood and leaves out absent fields', async () => {
    answer = (_seen, response) =>
      json(
        response,
        200,
        ok({ ...place, address: { suburb: 'Al Malaz' }, display_name: 'Al Malaz, Saudi Arabia' }),
      );
    expect(await geocoder().reverse({ lat: 24.66, lng: 46.73 })).toEqual({
      kind: 'found',
      formatted: 'Al Malaz, Saudi Arabia',
      district: 'Al Malaz',
      provider: 'hudhud',
    });
  });

  it('answers not_found for an answer without a display name (open sea, desert)', async () => {
    answer = (_seen, response) => json(response, 200, ok({}));
    expect(await geocoder().reverse({ lat: 26, lng: 51 })).toEqual({ kind: 'not_found' });
  });
});

describe('HudhudGeocoder failures', () => {
  const call = (g = geocoder()) => g.geocode({ text: 'Zoo', locale: 'en' });

  it('maps a 200 envelope with ok false to transient with the error, cut to 120 characters', async () => {
    const error = `quota exceeded ${'x'.repeat(200)}`;
    answer = (_seen, response) => json(response, 200, { ok: false, data: null, error });
    const failure = await failureOf(call());
    expect(failure.reason).toBe('transient');
    expect(failure.status).toBe(200);
    expect(failure.message).toBe(error.slice(0, 120));
    expect(seen).toHaveLength(1);
  });

  it.each([
    [400, 'permanent'],
    [401, 'unauthorised'],
    [403, 'unauthorised'],
    [404, 'permanent'],
    [422, 'permanent'],
    [500, 'transient'],
    [503, 'transient'],
  ] as const)('maps %i to %s without a retry', async (status, reason) => {
    answer = (_seen, response) =>
      json(response, status, { ok: false, data: null, error: 'refused' });
    const failure = await failureOf(call());
    expect(failure).toMatchObject({ reason, status });
    expect(seen).toHaveLength(1);
  });

  it('maps 429 to rate_limited at Retry-After, else 10 s', async () => {
    answer = (_seen, response) => json(response, 429, {}, { 'retry-after': '42' });
    expect(await failureOf(call())).toMatchObject({
      reason: 'rate_limited',
      status: 429,
      retryAfterS: 42,
    });
    answer = (_seen, response) => json(response, 429, {});
    expect(await failureOf(call())).toMatchObject({ reason: 'rate_limited', retryAfterS: 10 });
    expect(seen).toHaveLength(2);
  });

  it('retries a timeout once, and answers when the retry does', async () => {
    answer = (_seen, response, n) => {
      if (n === 1) setTimeout(() => json(response, 200, ok({ results: [zoo] })), 400);
      else json(response, 200, ok({ results: [zoo] }));
    };
    const result = await geocoder({ timeoutMs: 100 }).geocode({ text: 'Zoo', locale: 'en' });
    expect(result).toMatchObject({ kind: 'found' });
    expect(seen).toHaveLength(2);
  });

  it('maps two timeouts to transient TIMEOUT', async () => {
    answer = (_seen, response) => {
      setTimeout(() => json(response, 200, ok({ results: [zoo] })), 400);
    };
    const failure = await failureOf(call(geocoder({ timeoutMs: 100 })));
    expect(failure).toMatchObject({ reason: 'transient', status: 'TIMEOUT' });
    expect(seen).toHaveLength(2);
  });

  it('retries a dropped connection once', async () => {
    answer = (_seen, response, n) => {
      if (n === 1) response.socket?.destroy();
      else json(response, 200, ok({ results: [zoo] }));
    };
    expect(await call()).toMatchObject({ kind: 'found' });
    expect(seen).toHaveLength(2);
  });

  it('maps an unreachable service to transient NETWORK', async () => {
    const failure = await failureOf(
      call(new HudhudGeocoder({ baseUrl: 'http://127.0.0.1:1', apiKey: new Secret('k') })),
    );
    expect(failure).toMatchObject({ reason: 'transient', status: 'NETWORK' });
  });

  it('maps a body that is not JSON to transient', async () => {
    answer = (_seen, response) => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<html>gateway</html>');
    };
    expect(await failureOf(call())).toMatchObject({ reason: 'transient', status: 'BAD_RESPONSE' });
  });

  it('never puts the key or the query in a failure message', async () => {
    answer = (_seen, response) => json(response, 401, { ok: false, error: 'Missing or invalid' });
    const failure = await failureOf(geocoder().geocode({ text: 'Secret Street 7', locale: 'en' }));
    expect(failure.message).not.toContain('fake-hudhud-secret-key');
    expect(failure.message).not.toContain('Secret Street');
  });
});
