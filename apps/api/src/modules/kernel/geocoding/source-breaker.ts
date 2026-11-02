import type { Redis } from 'ioredis';

// The breaker per geocoder source (INT-2 plan 2.11; eeasynew's LookupBreaker, read 2026-11-02).
// Connection failures and timeouts are counted in a window; at the threshold the source is skipped
// for the open period, after which one call passes (half-open). A reachable answer (a clean
// not-found included) closes it; one more outage during the half-open probe re-opens it at once.
// The state lives in Redis (`elx:geocoder:breaker:<source>:…`) so every API process skips a dead
// source together; without Redis, in memory. A store failure never blocks a lookup: the breaker
// then lets the call through.

export const geocoderBreakerPrefix = 'elx:geocoder:breaker';

export interface BreakerStore {
  /** Counts one outage in a window of `windowMs` and answers the count. */
  countOutage(source: string, windowMs: number): Promise<number>;
  /** Until when the source is open (epoch ms), while the marker lives. */
  openUntil(source: string): Promise<number | undefined>;
  /** Opens until `until`; the marker lives `keepMs` so the half-open probe is recognised. */
  open(source: string, until: number, keepMs: number): Promise<void>;
  /** Closes: forgets the count, the marker and the probe. */
  close(source: string): Promise<void>;
  /** Claims the one half-open probe for `ms`; false when another call holds it. */
  claimProbe(source: string, ms: number): Promise<boolean>;
}

export interface SourceBreakerOptions {
  /** Outages in the window that open the breaker. Default 3. */
  readonly threshold?: number;
  readonly windowMs?: number;
  readonly openMs?: number;
  /** How long one half-open probe holds the door. Default 10 s. */
  readonly probeMs?: number;
  readonly now?: () => number;
}

export class SourceBreaker {
  readonly #threshold: number;
  readonly #windowMs: number;
  readonly #openMs: number;
  readonly #probeMs: number;
  readonly #now: () => number;

  constructor(
    private readonly store: BreakerStore,
    options: SourceBreakerOptions = {},
  ) {
    this.#threshold = options.threshold ?? 3;
    this.#windowMs = options.windowMs ?? 60_000;
    this.#openMs = options.openMs ?? 120_000;
    this.#probeMs = options.probeMs ?? 10_000;
    this.#now = options.now ?? Date.now;
  }

  /** Whether a call to `source` may go now (closed, or the half-open probe). */
  async admit(source: string): Promise<boolean> {
    try {
      const until = await this.store.openUntil(source);
      if (until === undefined) return true;
      if (until > this.#now()) return false;
      return await this.store.claimProbe(source, this.#probeMs);
    } catch {
      return true;
    }
  }

  /** The source answered (any status but an outage): close. */
  async reachable(source: string): Promise<void> {
    try {
      await this.store.close(source);
    } catch {
      // Advisory state: the lookup's own answer stands.
    }
  }

  /** A timeout or a connection failure: count it; open at the threshold or during a probe. */
  async outage(source: string): Promise<void> {
    try {
      const halfOpen = (await this.store.openUntil(source)) !== undefined;
      const count = await this.store.countOutage(source, this.#windowMs);
      if (halfOpen || count >= this.#threshold) {
        await this.store.open(source, this.#now() + this.#openMs, this.#openMs * 2);
      }
    } catch {
      // Advisory state, as above.
    }
  }
}

/** In-process state: processes without Redis, and tests. */
export function memoryBreakerStore(now: () => number = Date.now): BreakerStore {
  const outages = new Map<string, { count: number; until: number }>();
  const marker = new Map<string, { until: number; expires: number }>();
  const probes = new Map<string, number>();
  const live = (source: string) => {
    const entry = marker.get(source);
    if (entry !== undefined && entry.expires <= now()) marker.delete(source);
    return marker.get(source);
  };
  return {
    countOutage(source, windowMs) {
      const entry = outages.get(source);
      const next =
        entry === undefined || entry.until <= now()
          ? { count: 1, until: now() + windowMs }
          : { count: entry.count + 1, until: entry.until };
      outages.set(source, next);
      return Promise.resolve(next.count);
    },
    openUntil: (source) => Promise.resolve(live(source)?.until),
    open(source, until, keepMs) {
      marker.set(source, { until, expires: now() + keepMs });
      outages.delete(source);
      probes.delete(source);
      return Promise.resolve();
    },
    close(source) {
      outages.delete(source);
      marker.delete(source);
      probes.delete(source);
      return Promise.resolve();
    },
    claimProbe(source, ms) {
      const held = probes.get(source);
      if (held !== undefined && held > now()) return Promise.resolve(false);
      probes.set(source, now() + ms);
      return Promise.resolve(true);
    },
  };
}

/** Redis keys `<prefix>:<source>:outages`, `:open_until` and `:probe`. */
export function redisBreakerStore(
  redis: Pick<Redis, 'incr' | 'pexpire' | 'get' | 'set' | 'del'>,
  prefix: string = geocoderBreakerPrefix,
): BreakerStore {
  const key = (source: string, part: string) => `${prefix}:${source}:${part}`;
  return {
    async countOutage(source, windowMs) {
      const count = await redis.incr(key(source, 'outages'));
      if (count === 1) await redis.pexpire(key(source, 'outages'), windowMs);
      return count;
    },
    async openUntil(source) {
      const value = await redis.get(key(source, 'open_until'));
      const until = value === null ? Number.NaN : Number(value);
      return Number.isFinite(until) ? until : undefined;
    },
    async open(source, until, keepMs) {
      await redis.set(key(source, 'open_until'), String(until), 'PX', keepMs);
      await redis.del(key(source, 'outages'), key(source, 'probe'));
    },
    async close(source) {
      await redis.del(key(source, 'outages'), key(source, 'open_until'), key(source, 'probe'));
    },
    async claimProbe(source, ms) {
      return (await redis.set(key(source, 'probe'), '1', 'PX', ms, 'NX')) === 'OK';
    },
  };
}
