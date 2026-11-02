import { describe, expect, it } from 'vitest';
import {
  maxZonePolygons,
  maxZonePositions,
  newZone,
  zoneBoundary,
  zoneNameProblem,
} from './zone-input.js';

// DEL-1 plan 2.2: the bounds of a zone boundary, the Polygon wrap and the create body's rules.

const ring = (west: number, south: number, size = 0.1): [number, number][] => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south],
];

describe('zoneBoundary', () => {
  it('wraps a Polygon as a MultiPolygon and counts polygons and positions', () => {
    expect(zoneBoundary({ type: 'Polygon', coordinates: [ring(46.6, 24.6)] })).toEqual({
      geometry: { type: 'MultiPolygon', coordinates: [[ring(46.6, 24.6)]] },
      polygons: 1,
      positions: 5,
    });
    const multi = { type: 'MultiPolygon', coordinates: [[ring(46.6, 24.6)], [ring(39.1, 21.5)]] };
    expect(zoneBoundary(multi)).toMatchObject({ geometry: multi, polygons: 2, positions: 10 });
  });

  it('refuses a position outside Saudi Arabia, a bad position, an open or short ring', () => {
    const invalid = { pointer: '/body/boundary', code: 'invalid' };
    expect(zoneBoundary({ type: 'Polygon', coordinates: [ring(-30, 40)] })).toEqual(invalid);
    expect(zoneBoundary({ type: 'Polygon', coordinates: [ring(55.95, 24)] })).toEqual(invalid);
    expect(zoneBoundary({ type: 'Polygon', coordinates: [ring(46.6, 32.95)] })).toEqual(invalid);
    expect(
      zoneBoundary({
        type: 'Polygon',
        coordinates: [[...ring(46.6, 24.6).slice(0, 4), [46.6, 24.61]]],
      }),
    ).toEqual(invalid);
    expect(
      zoneBoundary({
        type: 'Polygon',
        coordinates: [
          [
            [46.6, 24.6],
            [46.7, 24.6],
            [46.6, 24.6],
          ],
        ],
      }),
    ).toEqual(invalid);
    expect(
      zoneBoundary({ type: 'Polygon', coordinates: [ring(46.6, 24.6).map(([x, y]) => [x, y, 5])] }),
    ).toEqual(invalid);
    expect(
      zoneBoundary({ type: 'Polygon', coordinates: [ring(46.6, 24.6).map(([x]) => [x, 'y'])] }),
    ).toEqual(invalid);
    expect(zoneBoundary({ type: 'Point', coordinates: [46.6, 24.6] })).toEqual(invalid);
    expect(zoneBoundary({ type: 'MultiPolygon', coordinates: [] })).toEqual(invalid);
    expect(zoneBoundary('MULTIPOLYGON')).toEqual(invalid);
  });

  it('refuses more than 20 polygons or 10,000 positions as too_long', () => {
    const tooLong = { pointer: '/body/boundary', code: 'too_long' };
    const many = Array.from({ length: maxZonePolygons + 1 }, (_, i) => [ring(40 + i * 0.2, 24)]);
    expect(zoneBoundary({ type: 'MultiPolygon', coordinates: many })).toEqual(tooLong);
    const dense: [number, number][] = Array.from({ length: maxZonePositions }, (_, i) => [
      46 + i / 1e6,
      24,
    ]);
    dense.push([46, 24]);
    expect(zoneBoundary({ type: 'Polygon', coordinates: [dense] })).toEqual(tooLong);
  });
});

describe('newZone and zoneNameProblem', () => {
  it('requires names, boundary and source and trims the names', () => {
    expect(newZone({})).toEqual([
      { pointer: '/body/name_ar', code: 'required' },
      { pointer: '/body/name_en', code: 'required' },
      { pointer: '/body/boundary', code: 'required' },
      { pointer: '/body/source', code: 'required' },
    ]);
    expect(
      newZone({
        name_ar: ' وسط ',
        name_en: ' Centre ',
        boundary: { type: 'Polygon', coordinates: [ring(46.6, 24.6)] },
        source: 'drawn',
      }),
    ).toMatchObject({ nameAr: 'وسط', nameEn: 'Centre', source: 'drawn', active: true });
  });

  it('bounds a name to 120 characters on one line, counted in code points', () => {
    expect(zoneNameProblem('/body/name_ar', 'ع'.repeat(120))).toBeUndefined();
    expect(zoneNameProblem('/body/name_ar', 'ع'.repeat(121))?.code).toBe('too_long');
    expect(zoneNameProblem('/body/name_en', '   ')?.code).toBe('too_short');
    expect(zoneNameProblem('/body/name_en', 'a\nb')?.code).toBe('invalid');
  });
});
