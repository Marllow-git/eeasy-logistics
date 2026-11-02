import type { OnApplicationShutdown } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { ShiftStatus } from '../../kernel/public/index.js';
import { shiftStatuses } from '../../kernel/public/index.js';

// The Redis side of the location ingest (DEL-5 plan 2.6, 2.7; ADR-0028; data §6): the newest point
// per driver in the hash `elx:loc:latest:{account}:{driver}` (point, device and server times, the
// shift status; TTL 600 s) for maps and polling, and one `PUBLISH elx:loc:{account}` per accepted
// point with the `telemetry.driver_location` payload (contracts README §6) for DEL-6's streams.
// Redis is never the source of truth: every call here fails fast and quietly (the head row is the
// maps' fallback), and nothing logs a position.

export const LOCATION_FANOUT = Symbol('LOCATION_FANOUT');

export const latestTtlSeconds = 600;

export const latestKey = (accountId: string, driverId: string): string =>
  `elx:loc:latest:${accountId}:${driverId}`;
export const locationChannel = (accountId: string): string => `elx:loc:${accountId}`;

/** The newest point of a driver as the hash holds it. */
export interface LatestPosition {
  readonly driverId: string;
  readonly lat: number;
  readonly lng: number;
  readonly clientTs: string;
  readonly serverTs: string;
  readonly shiftStatus: ShiftStatus;
}

/** The port the ingest and the staff reads use; `null` when the API runs without Redis. */
export interface LocationFanout {
  /** Stores the newest point and publishes each accepted point, oldest first. */
  publish(
    accountId: string,
    latest: LatestPosition,
    points: readonly { lat: number; lng: number; clientTs: string }[],
  ): Promise<void>;
  /** The latest hashes of `driverIds` (missing or unreadable ones left out). */
  latest(accountId: string, driverIds: readonly string[]): Promise<Map<string, LatestPosition>>;
  /** Drops a driver's latest key (the shift ended: the driver leaves the maps). */
  forget(accountId: string, driverId: string): Promise<void>;
}

/**
 * The latest-key delete over a Redis client the caller owns (the worker's sweeper and consumer):
 * quiet like the fan-out, since the key expires in 600 s and the maps list live shifts only.
 */
export function redisLatestForget(redis: Pick<Redis, 'del'>): Pick<LocationFanout, 'forget'> {
  return {
    forget: async (accountId, driverId) => {
      try {
        await redis.del(latestKey(accountId, driverId));
      } catch {
        // Nothing to log: no key or value may reach a log line, and the key expires on its own.
      }
    },
  };
}

export class RedisLocationFanout implements LocationFanout, OnApplicationShutdown {
  readonly #redis: Redis;
  readonly #logger = new Logger('LocationFanout');

  constructor(url: string) {
    this.#redis = new Redis(url, {
      connectTimeout: 2000,
      commandTimeout: 500,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
    });
    this.#redis.on('error', () => undefined);
  }

  async publish(
    accountId: string,
    latest: LatestPosition,
    points: readonly { lat: number; lng: number; clientTs: string }[],
  ): Promise<void> {
    const key = latestKey(accountId, latest.driverId);
    const multi = this.#redis
      .multi()
      .hset(key, {
        lat: String(latest.lat),
        lng: String(latest.lng),
        client_ts: latest.clientTs,
        server_ts: latest.serverTs,
        shift_status: latest.shiftStatus,
      })
      .expire(key, latestTtlSeconds);
    for (const point of points) {
      multi.publish(
        locationChannel(accountId),
        JSON.stringify({
          driver_id: latest.driverId,
          lat: point.lat,
          lng: point.lng,
          client_ts: point.clientTs,
          shift_status: latest.shiftStatus,
        }),
      );
    }
    await this.#quietly('publish', () => multi.exec());
  }

  async latest(
    accountId: string,
    driverIds: readonly string[],
  ): Promise<Map<string, LatestPosition>> {
    const found = new Map<string, LatestPosition>();
    if (driverIds.length === 0) return found;
    const pipeline = this.#redis.pipeline();
    for (const driverId of driverIds) pipeline.hgetall(latestKey(accountId, driverId));
    const replies = await this.#quietly('latest', () => pipeline.exec());
    replies?.forEach(([error, value], index) => {
      const driverId = driverIds[index];
      if (error !== null || driverId === undefined) return;
      const position = positionOf(driverId, value);
      if (position !== undefined) found.set(driverId, position);
    });
    return found;
  }

  async forget(accountId: string, driverId: string): Promise<void> {
    await this.#quietly('forget', () => this.#redis.del(latestKey(accountId, driverId)));
  }

  onApplicationShutdown(): void {
    this.#redis.disconnect();
  }

  /** Runs a Redis call; a failure is a warning without the key or any value, never an error. */
  async #quietly<T>(operation: string, call: () => Promise<T>): Promise<T | undefined> {
    try {
      return await call();
    } catch (error) {
      this.#logger.warn(
        `location ${operation} skipped: ${error instanceof Error ? error.name : 'error'}`,
      );
      return undefined;
    }
  }
}

const statuses: readonly string[] = shiftStatuses;

/** A hash read back, or undefined when a field is missing or unreadable. */
function positionOf(driverId: string, value: unknown): LatestPosition | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const hash = value as Record<string, string | undefined>;
  const lat = Number(hash.lat);
  const lng = Number(hash.lng);
  const { client_ts: clientTs, server_ts: serverTs, shift_status: shiftStatus } = hash;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (clientTs === undefined || serverTs === undefined) return undefined;
  if (shiftStatus === undefined || !statuses.includes(shiftStatus)) return undefined;
  return { driverId, lat, lng, clientTs, serverTs, shiftStatus: shiftStatus as ShiftStatus };
}
