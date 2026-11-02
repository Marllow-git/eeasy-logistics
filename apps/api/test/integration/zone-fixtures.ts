import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';

// Zone and site rows for the DEL-1 suites: rectangles in Riyadh (lng 46.6–46.8, lat 24.6–24.8),
// longitude first as GeoJSON has it, and sites planted directly as the owner.

/** A closed rectangle ring, longitude first. */
export function ring(west: number, south: number, east: number, north: number): number[][] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/** A GeoJSON Polygon of one rectangle. */
export const polygon = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon',
  coordinates: [ring(west, south, east, north)],
});

/** A site of the account, as the owner, in `kind` and `status`. */
export async function plantSite(
  owner: postgres.Sql,
  accountId: string,
  kind: 'branch' | 'warehouse' | 'both' = 'branch',
  status: 'active' | 'inactive' = 'active',
): Promise<string> {
  const id = uuidv7();
  await owner`
    INSERT INTO core_sites (id, account_id, kind, name_ar, name_en, status)
    VALUES (${id}, ${accountId}, ${kind}, 'فرع', 'Site', ${status})`;
  return id;
}

/** `count` drawn zones of the account, as the owner (the limit test). */
export async function plantZones(
  owner: postgres.Sql,
  accountId: string,
  count: number,
): Promise<void> {
  await owner`
    INSERT INTO del_zones (id, account_id, name_ar, name_en, boundary, source)
    SELECT core_uuidv7(), ${accountId}, 'منطقة ' || n, 'Zone ' || n,
           ST_GeomFromText('MULTIPOLYGON(((46.6 24.6, 46.7 24.6, 46.7 24.7, 46.6 24.6)))', 4326),
           'drawn'
    FROM generate_series(1, ${count}::int) AS n`;
}
