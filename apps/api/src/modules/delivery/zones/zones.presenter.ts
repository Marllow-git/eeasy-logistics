import type { Coverage, Zone } from '@eeasy-logistics/contracts/staff/schemas';
import type { CoverageRow } from './coverage.repository.js';
import type { ListedZone, ZoneRow } from './zones.repository.js';

/**
 * `Zone` (components.yaml; domain model §3.4) from a row: with its stored GeoJSON boundary when
 * the row carries one (`getZone`, the writes), without it in a list (plan 2.3; `boundary` is
 * optional in the contract).
 */
export function presentZone(row: ZoneRow | ListedZone): Zone {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    name_ar: row.nameAr,
    name_en: row.nameEn,
    ...('boundary' in row ? { boundary: { ...row.boundary } } : {}),
    source: row.source,
    active: row.active,
  };
}

/** `Coverage` (components.yaml) from a row. */
export function presentCoverage(row: CoverageRow): Coverage {
  return { site_id: row.siteId, zone_id: row.zoneId, created_at: row.createdAt.toISOString() };
}
