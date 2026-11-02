import { createHash } from 'node:crypto';
import type { GeoPoint, GeocodeQuery } from './geocoder.js';
import { composeQuery } from './hudhud-geocoder.js';

// The cache key of a lookup (INT-2 plan 2.4): the SHA-256 of `<method>\n<normalised input>`. Two
// spellings of one address that differ only in case or spacing share a key; the city joins the
// text as the sources' query does; the point is rounded to 5 decimals (about a metre). The text
// key carries the locale because the Sayyar source answers district and city in the asked
// language (plan 2.11). The key is a hash: no address text, code or point is stored in it, and a
// log line shows only its first 8 hex characters.

/** The point the sources are asked for: rounded to 5 decimals, as the key. */
export function roundedPoint(point: GeoPoint): GeoPoint {
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  return { lat: round(point.lat), lng: round(point.lng) };
}

export function geocodeKey(query: GeocodeQuery): Buffer {
  return hash(`geocode\n${query.locale}\n${composeQuery(query.text, query.city).toLowerCase()}`);
}

/** `code` already normalised (`normaliseShortCode`). */
export function shortCodeKey(code: string): Buffer {
  return hash(`shortcode\n${code}`);
}

export function reverseKey(point: GeoPoint): Buffer {
  const rounded = roundedPoint(point);
  return hash(`reverse\n${rounded.lat.toFixed(5)},${rounded.lng.toFixed(5)}`);
}

function hash(input: string): Buffer {
  return createHash('sha256').update(input, 'utf8').digest();
}
