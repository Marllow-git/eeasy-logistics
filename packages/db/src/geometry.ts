import { sql } from 'drizzle-orm';
import { customType } from 'drizzle-orm/pg-core';

// PostGIS geometry columns beyond Drizzle's built-in point (DEL-1 plan 2.1; data §8: SRID 4326,
// longitude first). drizzle-orm 0.45's `customType` has no select-time SQL hook, so a read cannot
// wrap the column in `ST_AsGeoJSON`: PostgreSQL sends a geometry as hex EWKB text, and
// `fromDriver` decodes that exactly (the doubles as stored, no rounding). A write goes through
// `ST_GeomFromGeoJSON` with the SRID set in SQL.

/** A GeoJSON position, longitude first (RFC 7946). */
export type Position = readonly [number, number];

/** A GeoJSON MultiPolygon: polygons of rings of positions, each ring closed. */
export interface MultiPolygonGeoJson {
  readonly type: 'MultiPolygon';
  readonly coordinates: readonly (readonly (readonly Position[])[])[];
}

const wkbPolygon = 3;
const wkbMultiPolygon = 6;
const flagZ = 0x80000000;
const flagM = 0x40000000;
const flagSrid = 0x20000000;

class WkbReader {
  readonly view: DataView;
  #offset = 0;
  #little = true;

  constructor(view: DataView) {
    this.view = view;
  }

  /** A geometry header: byte order, type (EWKB flags or ISO thousands), the SRID skipped. */
  header(): { readonly type: number; readonly dimensions: number } {
    this.#little = this.view.getUint8(this.#offset) === 1;
    this.#offset += 1;
    const raw = this.uint32();
    let dimensions = 2;
    if ((raw & flagZ) !== 0) dimensions += 1;
    if ((raw & flagM) !== 0) dimensions += 1;
    if ((raw & flagSrid) !== 0) this.uint32();
    const base = raw & 0xffff;
    // ISO WKB: 1000s add Z, 2000s add M, 3000s add both.
    const iso = Math.floor(base / 1000);
    return { type: base % 1000, dimensions: dimensions + (iso === 3 ? 2 : iso > 0 ? 1 : 0) };
  }

  uint32(): number {
    const value = this.view.getUint32(this.#offset, this.#little);
    this.#offset += 4;
    return value;
  }

  double(): number {
    const value = this.view.getFloat64(this.#offset, this.#little);
    this.#offset += 8;
    return value;
  }

  rings(dimensions: number): Position[][] {
    const rings: Position[][] = [];
    for (let ring = this.uint32(); ring > 0; ring -= 1) {
      const positions: Position[] = [];
      for (let count = this.uint32(); count > 0; count -= 1) {
        const x = this.double();
        const y = this.double();
        for (let extra = dimensions - 2; extra > 0; extra -= 1) this.double();
        positions.push([x, y]);
      }
      rings.push(positions);
    }
    return rings;
  }
}

/**
 * A Polygon or MultiPolygon from (E)WKB hex as PostgreSQL sends a geometry, as a GeoJSON
 * MultiPolygon (a Polygon becomes a MultiPolygon of one). Any other type throws.
 */
export function multiPolygonFromWkbHex(hex: string): MultiPolygonGeoJson {
  const bytes = Buffer.from(hex, 'hex');
  const reader = new WkbReader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  const outer = reader.header();
  if (outer.type === wkbPolygon) {
    return { type: 'MultiPolygon', coordinates: [reader.rings(outer.dimensions)] };
  }
  if (outer.type !== wkbMultiPolygon) {
    throw new Error(`Expected a Polygon or MultiPolygon geometry, got WKB type ${outer.type}`);
  }
  const polygons: Position[][][] = [];
  for (let count = reader.uint32(); count > 0; count -= 1) {
    const inner = reader.header();
    if (inner.type !== wkbPolygon) throw new Error('A MultiPolygon member is not a Polygon');
    polygons.push(reader.rings(inner.dimensions));
  }
  return { type: 'MultiPolygon', coordinates: polygons };
}

/**
 * `geometry(MultiPolygon, 4326)`: a GeoJSON MultiPolygon in and out. Written as
 * `ST_SetSRID(ST_GeomFromGeoJSON(<json>), 4326)`; read from the EWKB the driver returns.
 */
export const multiPolygon = customType<{ data: MultiPolygonGeoJson; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon,4326)',
  toDriver: (value) => sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(value)}), 4326)`,
  fromDriver: (value) => multiPolygonFromWkbHex(value),
});
