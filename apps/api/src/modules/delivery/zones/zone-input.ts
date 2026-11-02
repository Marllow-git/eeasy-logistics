import type { MultiPolygonGeoJson, Position } from '@eeasy-logistics/db';
import type { FieldProblem, ZoneSource } from '../../kernel/public/index.js';
import { oneLineTextProblem, zoneSources } from '../../kernel/public/index.js';

// The zone doors' input rules (DEL-1 plan 2.2; domain model §3.4; data §8): pure functions,
// unit-tested beside this file. Validity in PostGIS's sense (`ST_IsValid`) is checked in SQL by
// the service; these are the bounds that keep a boundary cheap and inside the country.

/** The longest zone name, in characters (plan 2.2; the table's CHECK). */
export const maxZoneNameLength = 120;
/** At most this many polygons in one boundary (plan 2.2). */
export const maxZonePolygons = 20;
/** At most this many positions over every ring of one boundary (plan 2.2). */
export const maxZonePositions = 10_000;
/** At most this many zones per account (plan 2.2, §7 #2: `AccountLimits` has no zones key yet). */
export const maxZonesPerAccount = 200;

/** Saudi Arabia's bounding box (plan 2.2): a zone outside it is a data fault. */
export const saudiBounds = { minLat: 16, maxLat: 33, minLng: 34, maxLng: 56 } as const;

const boundaryPointer = '/body/boundary';

/** A boundary as stored, with what its audit row records instead of the geometry. */
export interface ZoneBoundary {
  readonly geometry: MultiPolygonGeoJson;
  readonly polygons: number;
  readonly positions: number;
}

/** A name as stored: trimmed (plan 2.2). */
export const normaliseZoneName = (raw: string): string => raw.trim();

/** The problem of a name at `pointer`, after trimming: 1 to 120 characters on one line. */
export function zoneNameProblem(pointer: string, raw: unknown): FieldProblem | undefined {
  return oneLineTextProblem(pointer, typeof raw === 'string' ? raw.trim() : raw, maxZoneNameLength);
}

const isArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

function positionOf(value: unknown): Position | undefined {
  if (!isArray(value) || value.length !== 2) return undefined;
  const [lng, lat] = value;
  if (typeof lng !== 'number' || typeof lat !== 'number') return undefined;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  return [lng, lat];
}

const inSaudiArabia = ([lng, lat]: Position): boolean =>
  lat >= saudiBounds.minLat &&
  lat <= saudiBounds.maxLat &&
  lng >= saudiBounds.minLng &&
  lng <= saudiBounds.maxLng;

/**
 * A GeoJSON `MultiPolygon`, or a `Polygon` wrapped as one (plan 2.2), checked against the bounds:
 * at most 20 polygons and 10,000 positions, every ring closed with at least 4 positions of exactly
 * `[lng, lat]`, every position inside Saudi Arabia's box. Anything else is one problem at
 * `/body/boundary` (`too_long` over a bound, `invalid` otherwise).
 */
export function zoneBoundary(raw: unknown): ZoneBoundary | FieldProblem {
  const invalid: FieldProblem = { pointer: boundaryPointer, code: 'invalid' };
  const tooLong: FieldProblem = { pointer: boundaryPointer, code: 'too_long' };
  if (raw === null || typeof raw !== 'object' || isArray(raw)) return invalid;
  const { type, coordinates } = raw as { type?: unknown; coordinates?: unknown };
  if (!isArray(coordinates)) return invalid;
  let polygons: readonly unknown[];
  if (type === 'Polygon') polygons = [coordinates];
  else if (type === 'MultiPolygon') polygons = coordinates;
  else return invalid;
  if (polygons.length === 0) return invalid;
  if (polygons.length > maxZonePolygons) return tooLong;
  let positions = 0;
  const geometry: Position[][][] = [];
  for (const polygon of polygons) {
    if (!isArray(polygon) || polygon.length === 0) return invalid;
    const rings: Position[][] = [];
    for (const ring of polygon) {
      if (!isArray(ring) || ring.length < 4) return invalid;
      positions += ring.length;
      if (positions > maxZonePositions) return tooLong;
      const points: Position[] = [];
      for (const value of ring) {
        const position = positionOf(value);
        if (position === undefined || !inSaudiArabia(position)) return invalid;
        points.push(position);
      }
      const first = points[0];
      const last = points.at(-1);
      if (first === undefined || last === undefined) return invalid;
      if (last[0] !== first[0] || last[1] !== first[1]) return invalid;
      rings.push(points);
    }
    geometry.push(rings);
  }
  return {
    geometry: { type: 'MultiPolygon', coordinates: geometry },
    polygons: geometry.length,
    positions,
  };
}

export const isFieldProblem = (value: ZoneBoundary | FieldProblem): value is FieldProblem =>
  'pointer' in value;

/** `Zone` as a create or an update sends it (contract types stay in the controller). */
export interface ZoneBody {
  readonly name_ar?: string | undefined;
  readonly name_en?: string | undefined;
  readonly boundary?: unknown;
  readonly source?: ZoneSource | undefined;
  readonly active?: boolean | undefined;
}

/** The fields of a valid create body. */
export interface NewZone {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly boundary: ZoneBoundary;
  readonly source: ZoneSource;
  readonly active: boolean;
}

/**
 * A create body's fields or its problems (plan 2.2): both names, the boundary and `source` are
 * required (the contract's `Zone` makes every field optional, being the read shape too).
 */
export function newZone(body: ZoneBody): NewZone | FieldProblem[] {
  const problems: FieldProblem[] = [];
  const add = (problem: FieldProblem | undefined) => {
    if (problem !== undefined) problems.push(problem);
  };
  for (const key of ['name_ar', 'name_en'] as const) {
    if (body[key] === undefined) add({ pointer: `/body/${key}`, code: 'required' });
    else add(zoneNameProblem(`/body/${key}`, body[key]));
  }
  let boundary: ZoneBoundary | undefined;
  if (body.boundary === undefined) add({ pointer: boundaryPointer, code: 'required' });
  else {
    const checked = zoneBoundary(body.boundary);
    if (isFieldProblem(checked)) add(checked);
    else boundary = checked;
  }
  if (body.source === undefined) add({ pointer: '/body/source', code: 'required' });
  else if (!zoneSources.includes(body.source)) add({ pointer: '/body/source', code: 'invalid' });
  if (problems.length > 0 || boundary === undefined || body.source === undefined) return problems;
  return {
    nameAr: normaliseZoneName(body.name_ar ?? ''),
    nameEn: normaliseZoneName(body.name_en ?? ''),
    boundary,
    source: body.source,
    active: body.active ?? true,
  };
}
