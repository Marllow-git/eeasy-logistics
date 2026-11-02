import { describe, expect, it } from 'vitest';
import { geocodeKey, reverseKey, roundedPoint, shortCodeKey } from './cache-key.js';

// INT-2 plan 2.4, 2.10: the cache key derivation.

const hex = (key: Buffer) => key.toString('hex');

describe('geocode cache keys', () => {
  it('are SHA-256 digests (32 bytes)', () => {
    expect(geocodeKey({ text: 'Al Olaya', locale: 'en' })).toHaveLength(32);
    expect(shortCodeKey('REMA7572')).toHaveLength(32);
    expect(reverseKey({ lat: 24.7, lng: 46.7 })).toHaveLength(32);
  });

  it('collapse two spellings of one address (case, spaces, the city in the text)', () => {
    const key = hex(geocodeKey({ text: 'King Fahd Road, Al Olaya', city: 'Riyadh', locale: 'en' }));
    expect(
      hex(geocodeKey({ text: '  KING FAHD   road, al olaya ', city: ' riyadh', locale: 'en' })),
    ).toBe(key);
    expect(hex(geocodeKey({ text: 'King Fahd Road, Al Olaya, Riyadh', locale: 'en' }))).toBe(key);
  });

  it('keep different addresses, cities, locales and methods apart', () => {
    const base = hex(geocodeKey({ text: 'Al Rawdah', city: 'Riyadh', locale: 'en' }));
    expect(hex(geocodeKey({ text: 'Al Rawdah', city: 'Jeddah', locale: 'en' }))).not.toBe(base);
    expect(hex(geocodeKey({ text: 'Al Rawdah', city: 'Riyadh', locale: 'ar' }))).not.toBe(base);
    expect(hex(geocodeKey({ text: 'Al Rawda', city: 'Riyadh', locale: 'en' }))).not.toBe(base);
    expect(hex(shortCodeKey('REMA7572'))).not.toBe(hex(shortCodeKey('REMA7573')));
  });

  it('round the point to 5 decimals', () => {
    expect(roundedPoint({ lat: 24.695712, lng: 46.684449 })).toEqual({
      lat: 24.69571,
      lng: 46.68445,
    });
    expect(hex(reverseKey({ lat: 24.695712, lng: 46.684449 }))).toBe(
      hex(reverseKey({ lat: 24.695714, lng: 46.684451 })),
    );
    expect(hex(reverseKey({ lat: 24.69571, lng: 46.68445 }))).not.toBe(
      hex(reverseKey({ lat: 24.69572, lng: 46.68445 })),
    );
  });
});
