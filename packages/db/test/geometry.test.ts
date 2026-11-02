import { describe, expect, it } from 'vitest';
import { multiPolygonFromWkbHex } from '../src/geometry.ts';

// The EWKB decoder of the `multiPolygon` column (DEL-1 plan 2.1): what PostgreSQL sends for a
// geometry, built here byte by byte in both byte orders, with and without the SRID flag.

type Ring = readonly (readonly [number, number])[];

function wkb(
  little: boolean,
  type: number,
  body: (put: { u32: (n: number) => void; f64: (n: number) => void }) => void,
  srid?: number,
): Buffer {
  const parts: Buffer[] = [];
  const u32 = (n: number) => {
    const b = Buffer.alloc(4);
    if (little) b.writeUInt32LE(n >>> 0);
    else b.writeUInt32BE(n >>> 0);
    parts.push(b);
  };
  const f64 = (n: number) => {
    const b = Buffer.alloc(8);
    if (little) b.writeDoubleLE(n);
    else b.writeDoubleBE(n);
    parts.push(b);
  };
  parts.push(Buffer.from([little ? 1 : 0]));
  u32(srid === undefined ? type : (type | 0x20000000) >>> 0);
  if (srid !== undefined) u32(srid);
  body({ u32, f64 });
  return Buffer.concat(parts);
}

const polygon = (little: boolean, rings: readonly Ring[], srid?: number) =>
  wkb(
    little,
    3,
    ({ u32, f64 }) => {
      u32(rings.length);
      for (const ring of rings) {
        u32(ring.length);
        for (const [x, y] of ring) {
          f64(x);
          f64(y);
        }
      }
    },
    srid,
  );

const square: Ring = [
  [46.6, 24.6],
  [46.7, 24.6],
  [46.7, 24.7],
  [46.6, 24.7],
  [46.6, 24.6],
];
const hole: Ring = [
  [46.62, 24.62],
  [46.63, 24.62],
  [46.63, 24.63],
  [46.62, 24.62],
];
const other: Ring = [
  [39.1, 21.5],
  [39.2, 21.5],
  [39.2, 21.6],
  [39.1, 21.5],
];

describe('multiPolygonFromWkbHex', () => {
  it('reads an EWKB MultiPolygon with its SRID, holes and exact doubles', () => {
    const members = [polygon(true, [square, hole]), polygon(true, [other])];
    const hex = Buffer.concat([
      wkb(true, 6, ({ u32 }) => u32(members.length), 4326),
      ...members,
    ]).toString('hex');
    expect(multiPolygonFromWkbHex(hex)).toEqual({
      type: 'MultiPolygon',
      coordinates: [[square, hole], [other]],
    });
  });

  it('reads big-endian WKB and wraps a Polygon as a MultiPolygon of one', () => {
    const hex = polygon(false, [square], 4326).toString('hex');
    expect(multiPolygonFromWkbHex(hex)).toEqual({ type: 'MultiPolygon', coordinates: [[square]] });
  });

  it('refuses another geometry type', () => {
    const point = wkb(true, 1, ({ f64 }) => {
      f64(46.6);
      f64(24.6);
    }).toString('hex');
    expect(() => multiPolygonFromWkbHex(point)).toThrow(/WKB type 1/);
  });
});
