import type { PlatformDatabase, PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { CachedGeocodeSource, GeocodeMethod } from '../schema/geocode-cache.js';
import { coreGeocodeCache } from '../schema/geocode-cache.js';

// `core_geocode_cache` on the platform pool (INT-2 plan 2.4): a platform table (no account), so
// the geocoder reads and writes it in short platform transactions of its own, committed whatever
// the calling request does; elx_app has no grant on it. The worker's hourly purge deletes expired
// rows.

export interface CachedGeocode {
  readonly provider: CachedGeocodeSource;
  /** The port result, or `{ kind: 'not_found' }`, as written. */
  readonly result: unknown;
  readonly expiresAt: Date;
}

export interface GeocodeCacheEntry {
  readonly key: Buffer;
  readonly method: GeocodeMethod;
  readonly provider: CachedGeocodeSource;
  readonly result: unknown;
  /** From now, in the database's clock. */
  readonly ttlMs: number;
}

/** The geocoder's view of the table. */
export interface GeocodeCacheStore {
  /** The live row of `key`, if any (`expires_at` still ahead). */
  read(key: Buffer): Promise<CachedGeocode | undefined>;
  /** Inserts or replaces the row of `entry.key`. */
  write(entry: GeocodeCacheEntry): Promise<void>;
}

export class GeocodeCacheRepository extends PlatformRepository<typeof coreGeocodeCache> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreGeocodeCache);
  }

  async read(key: Buffer): Promise<CachedGeocode | undefined> {
    const [row] = await this.unscoped()
      .select({
        provider: coreGeocodeCache.provider,
        result: coreGeocodeCache.result,
        expiresAt: coreGeocodeCache.expiresAt,
      })
      .from(coreGeocodeCache)
      .where(and(eq(coreGeocodeCache.key, key), gt(coreGeocodeCache.expiresAt, sql`now()`)))
      .limit(1);
    return row;
  }

  async write(entry: GeocodeCacheEntry): Promise<void> {
    const expiresAt = sql`now() + ${Math.round(entry.ttlMs)} * interval '1 millisecond'`;
    await this.unscoped()
      .insert(coreGeocodeCache)
      .values({
        key: entry.key,
        method: entry.method,
        provider: entry.provider,
        result: entry.result,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: coreGeocodeCache.key,
        set: {
          method: entry.method,
          provider: entry.provider,
          result: entry.result,
          createdAt: sql`now()`,
          expiresAt,
        },
      });
  }

  /** Deletes the expired rows; answers how many. */
  async purgeExpired(): Promise<number> {
    const rows = await this.unscoped()
      .delete(coreGeocodeCache)
      .where(lt(coreGeocodeCache.expiresAt, sql`now()`))
      .returning({ method: coreGeocodeCache.method });
    return rows.length;
  }
}

/** The store on the platform pool: one short transaction per read or write. */
export function geocodeCacheStore(db: PlatformDatabase): GeocodeCacheStore {
  return {
    read: (key) => withPlatformUnitOfWork(db, (uow) => new GeocodeCacheRepository(uow).read(key)),
    write: (entry) =>
      withPlatformUnitOfWork(db, (uow) => new GeocodeCacheRepository(uow).write(entry)),
  };
}
