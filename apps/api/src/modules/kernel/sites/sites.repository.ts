import type { TenantUpdate, UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import type { SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ListSort, PageKey } from '../contract/list-page.js';
import { keysetAfter, keysetOrder } from '../contract/list-page.js';
import type { SiteKind, SiteStatus } from '../schema/sites.js';
import { coreSites } from '../schema/sites.js';
import type { LatLng, SiteFields } from './site-input.js';

/** A `core_sites` row; `point` as Drizzle's `xy` mode reads it (`x` longitude, `y` latitude). */
export type SiteRow = typeof coreSites.$inferSelect;

/** The documented sort fields of `listSites` (plan 2.4). */
export type SiteSortField = 'created_at' | 'name_ar' | 'name_en' | 'status';

export interface SitePageQuery {
  readonly statuses?: readonly SiteStatus[] | undefined;
  readonly kind?: SiteKind | undefined;
  /** `siteFilter` of a site-scoped principal over `core_sites.id`, else undefined. */
  readonly scope?: SQL | undefined;
  readonly sort: ListSort<SiteSortField>;
  readonly after: PageKey | undefined;
  /** Rows to read: the page size plus one. */
  readonly limit: number;
}

/**
 * What each sort field orders by. `created_at` is compared at millisecond precision, the precision
 * the row's `Date` carries into the cursor, so the keyset never skips a row whose microseconds the
 * cursor lost; `id` breaks the ties.
 */
const sortValue: Record<SiteSortField, SQL | AnyPgColumn> = {
  created_at: sql`date_trunc('milliseconds', ${coreSites.createdAt})`,
  name_ar: coreSites.nameAr,
  name_en: coreSites.nameEn,
  status: coreSites.status,
};

/** The cursor key of a row for `field`. */
export function siteKeyOf(field: SiteSortField, row: SiteRow): PageKey {
  const value =
    field === 'created_at'
      ? row.createdAt.toISOString()
      : field === 'name_ar'
        ? row.nameAr
        : field === 'name_en'
          ? row.nameEn
          : row.status;
  return { value, id: row.id };
}

/** `ST_SetSRID(ST_MakePoint(lng, lat), 4326)` (data §8), or NULL. */
function pointValue(point: LatLng | null): SQL {
  return point === null
    ? sql`NULL`
    : sql`ST_SetSRID(ST_MakePoint(${point.lng}::float8, ${point.lat}::float8), 4326)`;
}

/** A site's id, kind and status: what another context checks before it references a site. */
export interface SiteSummary {
  readonly id: string;
  readonly kind: SiteKind;
  readonly status: SiteStatus;
}

/**
 * The sites of the unit of work's account among `ids`, any status (DEL-1 plan 2.4, 2.6: the
 * coverage doors check kind and status; another account's id is simply absent).
 */
export async function siteSummaries(
  uow: UnitOfWork,
  ids: readonly string[],
): Promise<SiteSummary[]> {
  if (ids.length === 0) return [];
  return new SitesRepository(uow).summaries(ids);
}

/**
 * Holds the account's site write lock shared until the transaction ends (DEL-2): a writer that
 * hangs work off a site (an order's create) takes it before it re-reads the site, so a
 * deactivation, which holds the lock exclusively through its in-use checks, either sees that work
 * or runs after it, never between the read and the insert.
 */
export function holdSites(uow: UnitOfWork): Promise<void> {
  return new SitesRepository(uow).holdWrites();
}

/** `core_sites` of the context's account (PLAT-12 plan 2.2, 2.5; ADR-0018). */
export class SitesRepository extends ScopedRepository<typeof coreSites> {
  constructor(uow: UnitOfWork) {
    super(uow, coreSites);
  }

  /** The account's active sites: `usage.sites` and the `limits.sites` check. */
  countActive(): Promise<number> {
    return this.countWhere(eq(coreSites.status, 'active'));
  }

  /**
   * Orders the account's site writes (plan 2.5): the limit check counts the active sites and the
   * insert or activation follows under this lock, so concurrent creates cannot pass the limit
   * together; edits and transitions take it too, so a read and its write see one state.
   */
  lockWrites(): Promise<void> {
    return this.transactionLock('core_sites');
  }

  /** `lockWrites()` shared: see `holdSites`. */
  holdWrites(): Promise<void> {
    return this.sharedTransactionLock('core_sites');
  }

  summaries(ids: readonly string[]): Promise<SiteSummary[]> {
    return this.selectWhere<SiteSummary>(
      { id: coreSites.id, kind: coreSites.kind, status: coreSites.status },
      inArray(coreSites.id, [...ids]),
    );
  }

  async find(id: string): Promise<SiteRow | undefined> {
    const [row] = await this.findMany(eq(coreSites.id, id));
    return row;
  }

  /** Which of `ids` name a site of the account, whatever its status (member `site_ids`, 2.7). */
  async knownIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.findMany(inArray(coreSites.id, [...new Set(ids)]));
    return new Set(rows.map((row) => row.id));
  }

  page(query: SitePageQuery): Promise<SiteRow[]> {
    const value = sortValue[query.sort.field];
    const plan = { sort: query.sort, after: query.after };
    return this.findMany(
      and(
        query.statuses === undefined ? undefined : inArray(coreSites.status, [...query.statuses]),
        query.kind === undefined ? undefined : eq(coreSites.kind, query.kind),
        query.scope,
        keysetAfter(plan, value, coreSites.id),
      ),
      { orderBy: keysetOrder(plan, value, coreSites.id), limit: query.limit },
    );
  }

  async insert(id: string, fields: SiteFields): Promise<SiteRow> {
    const [row] = await this.insertMany([
      {
        id,
        kind: fields.kind,
        nameAr: fields.nameAr,
        nameEn: fields.nameEn,
        addressText: fields.addressText,
        nationalAddressShortCode: fields.nationalAddressShortCode,
        // Drizzle's `xy` mode would write a point without its SRID; the SQL sets 4326.
        point: pointValue(fields.point) as unknown as SiteRow['point'],
        openingHours: [...fields.openingHours],
      },
    ]);
    if (row === undefined) throw new Error('The site insert returned no row');
    return row;
  }

  /** Writes the editable fields, `version + 1`; the caller holds `lockWrites()`. */
  async update(id: string, fields: SiteFields): Promise<SiteRow> {
    return this.write(id, {
      kind: fields.kind,
      nameAr: fields.nameAr,
      nameEn: fields.nameEn,
      addressText: fields.addressText,
      nationalAddressShortCode: fields.nationalAddressShortCode,
      point: pointValue(fields.point) as unknown as SiteRow['point'],
      openingHours: [...fields.openingHours],
    });
  }

  /** Moves the status, `version + 1`; the caller holds `lockWrites()` and checked the arrow. */
  setStatus(id: string, status: SiteStatus): Promise<SiteRow> {
    return this.write(id, { status });
  }

  private async write(id: string, values: TenantUpdate<typeof coreSites>): Promise<SiteRow> {
    const [row] = await this.updateWhere(
      {
        ...values,
        version: sql`${coreSites.version} + 1` as unknown as number,
        updatedAt: sql`now()` as unknown as Date,
      },
      eq(coreSites.id, id),
    );
    if (row === undefined) throw new Error('The site vanished under the write lock');
    return row;
  }
}
