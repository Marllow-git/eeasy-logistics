import type { UnitOfWork } from '@eeasy-logistics/db';
import { getUnitOfWork } from '@eeasy-logistics/db';
import type { ErrorCode } from '../../kernel/public/index.js';
import { CoverageRepository } from './coverage.repository.js';
import type { LngLat } from './zones.repository.js';
import { ZonesRepository } from './zones.repository.js';

// `CoverageQueryPort` (DEL-1 plan 2.5; domain model §1.1: WMS → Delivery, sync read, same
// transaction; data §8, D-3; ADR-0015). Which zone covers a point and from which sites: the active
// zones whose boundary covers it (`ST_Covers`, a boundary point counts) and that a site covers
// (that site only, when asked). Several zones may overlap (§7 #3): the smallest by area in square
// metres answers, ties by id, and `siteIds` is every site covering any of them, so DEL-2's intake,
// WMS-7's pack bench and the staff check agree.

/** A point as the contracts carry it (data §8). */
export interface CoveragePoint {
  readonly lat: number;
  readonly lng: number;
}

/** The answer: `zoneId` null and no sites when the point is not covered. */
export interface CoverageAnswer {
  readonly zoneId: string | null;
  readonly siteIds: readonly string[];
}

/** The typed reason DEL-2 stores in `pending_reason` and answers (errors.md, W-11). */
export const outsideCoverage = 'outside_coverage' satisfies ErrorCode;

/** Whether an answer covers the point. */
export const isCovered = (answer: CoverageAnswer): boolean => answer.siteIds.length > 0;

/** The smallest-zone choice over rows ordered smallest first (exported for its unit test). */
export function coverageAnswer(
  zones: readonly { readonly id: string }[],
  siteIds: readonly string[],
): CoverageAnswer {
  const first = zones[0];
  if (first === undefined || siteIds.length === 0) return { zoneId: null, siteIds: [] };
  return { zoneId: first.id, siteIds };
}

export class CoverageQuery {
  /**
   * The coverage of `point` in the caller's unit of work (the request's, or the one a port caller
   * passes): no transaction of its own, so it sees what the caller has written.
   */
  async coverage(
    point: CoveragePoint,
    options: { readonly siteId?: string | undefined; readonly uow?: UnitOfWork } = {},
  ): Promise<CoverageAnswer> {
    const uow = options.uow ?? getUnitOfWork();
    const at: LngLat = { lng: point.lng, lat: point.lat };
    const zones = await new ZonesRepository(uow).covering(at, options.siteId);
    if (zones.length === 0) return { zoneId: null, siteIds: [] };
    const siteIds = await new CoverageRepository(uow).sitesOf(
      zones.map((zone) => zone.id),
      options.siteId,
    );
    return coverageAnswer(zones, siteIds);
  }
}
