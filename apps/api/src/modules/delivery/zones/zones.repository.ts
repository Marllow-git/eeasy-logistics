import type { MultiPolygonGeoJson, TenantUpdate, UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { ListPagePlan, PageKey, ZoneSource } from '../../kernel/public/index.js';
import { delCoverage, delZones, keysetAfter, keysetOrder } from '../../kernel/public/index.js';

/** A `del_zones` row of the context's account, the boundary decoded to GeoJSON. */
export type ZoneRow = typeof delZones.$inferSelect;

/** A zone as the list reads it: every column but the boundary (plan 2.3). */
export type ListedZone = Omit<ZoneRow, 'boundary'>;

/** The documented sort fields of `listZones` (plan 2.3). */
export type ZoneSortField = 'created_at' | 'name_ar' | 'name_en';

export interface ZoneFields {
  readonly nameAr: string;
  readonly nameEn: string;
  readonly boundary: MultiPolygonGeoJson;
  readonly source: ZoneSource;
  readonly active: boolean;
}

/** A point, longitude first, as PostGIS takes it (data §8). */
export interface LngLat {
  readonly lng: number;
  readonly lat: number;
}

/** What each sort field orders by (`created_at` at the millisecond the cursor carries). */
const sortValue: Record<ZoneSortField, SQL | AnyPgColumn> = {
  created_at: sql`date_trunc('milliseconds', ${delZones.createdAt})`,
  name_ar: delZones.nameAr,
  name_en: delZones.nameEn,
};

export function zoneKeyOf(field: ZoneSortField, row: ListedZone): PageKey {
  const value =
    field === 'created_at'
      ? row.createdAt.toISOString()
      : field === 'name_ar'
        ? row.nameAr
        : row.nameEn;
  return { value, id: row.id };
}

const listedColumns = {
  id: delZones.id,
  accountId: delZones.accountId,
  nameAr: delZones.nameAr,
  nameEn: delZones.nameEn,
  source: delZones.source,
  active: delZones.active,
  version: delZones.version,
  createdAt: delZones.createdAt,
  updatedAt: delZones.updatedAt,
};

/** `q` as a literal `ILIKE` pattern: every `%`, `_` and `\` matches itself. */
const containsPattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const pointOf = ({ lng, lat }: LngLat): SQL =>
  sql`ST_SetSRID(ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)`;

/** `del_zones` of the context's account (DEL-1 plan 2.2, 2.3, 2.5). */
export class ZonesRepository extends ScopedRepository<typeof delZones> {
  constructor(uow: UnitOfWork) {
    super(uow, delZones);
  }

  /** Orders the account's zone writes, so the 200-zone count and the insert agree (plan 2.3). */
  lockWrites(): Promise<void> {
    return this.transactionLock('del_zones');
  }

  count(): Promise<number> {
    return this.countWhere();
  }

  /**
   * Why PostGIS finds this boundary invalid (`ST_IsValidReason`), or null when it is valid: checked
   * before the write, so an invalid boundary is a typed refusal, never the CHECK's error (plan 2.2).
   */
  invalidReason(boundary: MultiPolygonGeoJson): Promise<string | null> {
    const geometry = sql`ST_GeomFromGeoJSON(${JSON.stringify(boundary)})`;
    return this.evaluate<string | null>(
      sql`CASE WHEN ST_IsValid(${geometry}) THEN NULL ELSE ST_IsValidReason(${geometry}) END`,
    );
  }

  async find(id: string): Promise<ZoneRow | undefined> {
    const [row] = await this.findMany(eq(delZones.id, id));
    return row;
  }

  /** Which of `ids` name a zone of the account, any state. */
  async existing(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.selectWhere<{ id: string }>(
      { id: delZones.id },
      inArray(delZones.id, [...ids]),
    );
    return new Set(rows.map((row) => row.id));
  }

  page(query: {
    readonly active: boolean | undefined;
    readonly q: string | undefined;
    readonly sort: ListPagePlan<ZoneSortField>['sort'];
    readonly after: PageKey | undefined;
    readonly limit: number;
  }): Promise<ListedZone[]> {
    const value = sortValue[query.sort.field];
    const plan = { sort: query.sort, after: query.after };
    const pattern = query.q === undefined ? undefined : containsPattern(query.q);
    return this.selectWhere<ListedZone>(
      listedColumns,
      and(
        query.active === undefined ? undefined : eq(delZones.active, query.active),
        pattern === undefined
          ? undefined
          : or(ilike(delZones.nameAr, pattern), ilike(delZones.nameEn, pattern)),
        keysetAfter(plan, value, delZones.id),
      ),
      { orderBy: keysetOrder(plan, value, delZones.id), limit: query.limit },
    );
  }

  /**
   * The active zones that cover `point` (`ST_Covers`: a point on the boundary counts, D-3) and
   * that a site covers (that site only, when given), smallest first by area in square metres, then
   * by id: the first is the zone the check answers (plan 2.5, §7 #3).
   */
  covering(point: LngLat, siteId?: string): Promise<{ id: string }[]> {
    const covered = sql`EXISTS (
      SELECT 1 FROM ${delCoverage}
      WHERE ${delCoverage.accountId} = ${delZones.accountId}
        AND ${delCoverage.zoneId} = ${delZones.id}
        ${siteId === undefined ? sql`` : sql`AND ${delCoverage.siteId} = ${siteId}`}
    )`;
    return this.selectWhere<{ id: string }>(
      { id: delZones.id },
      and(
        eq(delZones.active, true),
        sql`ST_Covers(${delZones.boundary}, ${pointOf(point)})`,
        covered,
      ),
      { orderBy: [sql`ST_Area(${delZones.boundary}::geography)`, asc(delZones.id)] },
    );
  }

  async insert(id: string, fields: ZoneFields): Promise<ZoneRow> {
    const [row] = await this.insertMany([{ id, ...fields }]);
    if (row === undefined) throw new Error('The zone insert returned no row');
    return row;
  }

  /** The changed fields, `version + 1`; the caller holds `lockWrites()`. */
  async update(id: string, values: TenantUpdate<typeof delZones>): Promise<ZoneRow> {
    const [row] = await this.updateWhere(
      {
        ...values,
        version: sql`${delZones.version} + 1` as unknown as number,
        updatedAt: sql`now()` as unknown as Date,
      },
      eq(delZones.id, id),
    );
    if (row === undefined) throw new Error('The zone vanished under the write lock');
    return row;
  }
}
