import { describe, expect, it } from 'vitest';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { GeocoderInputError } from './geocoder.js';
import { StubGeocoder, distanceKm, loadGeocodeFixture } from './stub-geocoder.js';

// INT-2 plan 2.5, 2.10: the fixture stub (apps/api/resources/geocode-fixture.json).

const stub = new StubGeocoder();

describe('the geocode fixture', () => {
  it('holds about 25 districts per city, both languages, inside Saudi Arabia', () => {
    const fixture = loadGeocodeFixture();
    for (const city of ['Riyadh', 'Jeddah']) {
      const districts = fixture.districts.filter((district) => district.city_en === city);
      expect(districts.length).toBeGreaterThanOrEqual(20);
      expect(districts.length).toBeLessThanOrEqual(30);
    }
    const ids = new Set<string>();
    for (const district of fixture.districts) {
      expect(district.name_ar).toMatch(/[؀-ۿ]/);
      expect(district.city_ar).toMatch(/[؀-ۿ]/);
      expect(district.name_en).toMatch(/^[A-Za-z][A-Za-z ']+$/);
      expect(district.lat).toBeGreaterThan(16);
      expect(district.lat).toBeLessThan(33);
      expect(district.lng).toBeGreaterThan(34);
      expect(district.lng).toBeLessThan(56);
      expect(ids.has(district.id)).toBe(false);
      ids.add(district.id);
    }
    expect(Object.keys(fixture.short_codes)).toHaveLength(6);
    for (const [code, id] of Object.entries(fixture.short_codes)) {
      expect(code).toMatch(/^[A-Z]{4}[0-9]{4}$/);
      expect(ids.has(id)).toBe(true);
    }
    expect(fixture.about).toMatch(/authored by hand/);
  });
});

describe('StubGeocoder.geocode', () => {
  it('matches an Arabic district name after stripping حي, and answers in Arabic', async () => {
    const result = await stub.geocode({ text: 'حي العليا، شارع التحلية', locale: 'ar' });
    expect(result).toEqual({
      kind: 'found',
      point: { lat: 24.695, lng: 46.685 },
      confidence: 0.8,
      formatted: 'العليا، الرياض',
      district: 'العليا',
      city: 'الرياض',
      provider: 'stub',
    });
  });

  it('matches an English name with or without "Al" and "district", and answers in English', async () => {
    for (const text of ['Al Olaya district', 'olaya', 'Tahlia St, AL-OLAYA']) {
      expect(await stub.geocode({ text, locale: 'en' })).toMatchObject({
        kind: 'found',
        formatted: 'Al Olaya, Riyadh',
        district: 'Al Olaya',
        city: 'Riyadh',
      });
    }
  });

  it('folds the Arabic letter forms (alef with hamza, teh marbuta, diacritics)', async () => {
    expect(await stub.geocode({ text: 'الاندلس', locale: 'ar' })).toMatchObject({
      district: 'الأندلس',
      city: 'جدة',
    });
    expect(await stub.geocode({ text: 'حي الصحافه', locale: 'ar' })).toMatchObject({
      district: 'الصحافة',
    });
  });

  it('narrows by the city in either language, given or in the text', async () => {
    expect(await stub.geocode({ text: 'Al Rawdah', city: 'Jeddah', locale: 'en' })).toMatchObject({
      point: { lat: 21.565, lng: 39.155 },
      city: 'Jeddah',
      confidence: 0.8,
    });
    expect(await stub.geocode({ text: 'الروضة', city: 'الرياض', locale: 'ar' })).toMatchObject({
      point: { lat: 24.735, lng: 46.77 },
      city: 'الرياض',
    });
    expect(await stub.geocode({ text: 'Al Rawdah, Jeddah', locale: 'en' })).toMatchObject({
      city: 'Jeddah',
    });
  });

  it('answers an ambiguous name with lower confidence', async () => {
    expect(await stub.geocode({ text: 'Al Rawdah', locale: 'en' })).toMatchObject({
      kind: 'found',
      confidence: 0.5,
    });
  });

  it('answers not_found for unknown text or a city with no such district', async () => {
    expect(await stub.geocode({ text: 'Baker Street 221b', locale: 'en' })).toEqual({
      kind: 'not_found',
    });
    expect(await stub.geocode({ text: 'Al Olaya', city: 'Jeddah', locale: 'en' })).toEqual({
      kind: 'not_found',
    });
    expect(await stub.geocode({ text: 'Al Olaya', city: 'Dammam', locale: 'en' })).toEqual({
      kind: 'not_found',
    });
  });
});

describe('StubGeocoder.lookupShortCode', () => {
  it('reads the fixture codes, normalised, with confidence 1', async () => {
    expect(await stub.lookupShortCode('rema-٧٥٧٢')).toEqual({
      kind: 'found',
      point: { lat: 24.695, lng: 46.685 },
      confidence: 1,
      addressAr: 'العليا، الرياض',
      addressEn: 'Al Olaya, Riyadh',
      shortCode: 'REMA7572',
      provider: 'stub',
    });
    expect(await stub.lookupShortCode('JSFA1188')).toMatchObject({ addressEn: 'Al Safa, Jeddah' });
  });

  it('answers not_found for a well-formed unknown code and refuses a malformed one', async () => {
    expect(await stub.lookupShortCode('ABCD1234')).toEqual({ kind: 'not_found' });
    await expect(stub.lookupShortCode('ABCD123')).rejects.toBeInstanceOf(GeocoderInputError);
  });
});

describe('StubGeocoder.reverse', () => {
  it('answers the nearest district within 15 km', async () => {
    expect(await stub.reverse({ lat: 24.696, lng: 46.686 })).toEqual({
      kind: 'found',
      formatted: 'Al Olaya, Riyadh',
      district: 'Al Olaya',
      city: 'Riyadh',
      provider: 'stub',
    });
    expect(await stub.reverse({ lat: 21.566, lng: 39.154 })).toMatchObject({
      district: 'Al Rawdah',
      city: 'Jeddah',
    });
  });

  it('answers not_found farther than 15 km from every district', async () => {
    expect(await stub.reverse({ lat: 26.43, lng: 50.1 })).toEqual({ kind: 'not_found' });
  });

  it('measures great-circle distance', () => {
    // Riyadh to Jeddah is about 850 km.
    expect(distanceKm({ lat: 24.7136, lng: 46.6753 }, { lat: 21.4858, lng: 39.1925 })).toBeCloseTo(
      849,
      -1,
    );
  });
});

describe('StubGeocoder.failNext', () => {
  it('throws the planted failure once, then answers again', async () => {
    const local = new StubGeocoder();
    local.failNext(new ProviderFailure('transient', 'planted', { status: 'NETWORK' }));
    await expect(local.geocode({ text: 'olaya', locale: 'en' })).rejects.toMatchObject({
      reason: 'transient',
    });
    expect(await local.geocode({ text: 'olaya', locale: 'en' })).toMatchObject({ kind: 'found' });
  });
});
