import { ProviderFailure } from '../outbox/provider-failure.js';
import { getMetrics } from '../telemetry/metrics.js';
import type {
  GeoPoint,
  GeocodeQuery,
  GeocodeResult,
  GeocoderProviderName,
  GeocoderSource,
  NotFound,
  ReverseResult,
  ShortCodeResult,
} from './geocoder.js';
import { GeocoderInputError, notFound } from './geocoder.js';
import type { SourceBreaker } from './source-breaker.js';
import { isOutage } from './source-http.js';

// The chain of sources (INT-2 plan 2.11; owner ruling 2026-11-02, as eeasynew's address chain): the
// sources of a lookup asked in the configured order (`GEOCODER_SOURCES`), the first answer taken.
// Short code: spl → sayyar → hudhud; text: sayyar → hudhud; reverse: spl (the POI API) → hudhud. A
// source's not-found moves on; the chain's not-found only when every source asked said so. A
// failure (a timeout, a 5xx, a refused key, an open breaker) moves on and is counted; when no source
// answered, or one failed and the rest said not found, the last failure is raised (the service's
// degraded path makes it `unavailable`, and an uncertain not-found is never cached). The whole
// chain is capped at 6 s, or lower when the caller passes its own deadline (DEL-2 intake, 2 s).

export type GeocodeMethod = 'geocode' | 'shortcode' | 'reverse';

/** A chain answer and the source it came from (for `not_found`, the last source asked). */
export interface ChainAnswer<T> {
  readonly answer: T | NotFound;
  readonly source: GeocoderProviderName;
}

export interface ChainGeocoderOptions {
  /** In `GEOCODER_SOURCES` order; each is asked only for the lookups it has. */
  readonly sources: readonly GeocoderSource[];
  readonly breaker: SourceBreaker;
  /** Plan 2.11: 6 s for the whole chain. */
  readonly deadlineMs?: number;
  readonly now?: () => number;
}

export const chainDeadlineMs = 6_000;

const breakerOpen = (source: string) =>
  new ProviderFailure('transient', `the ${source} breaker is open`, { status: 'BREAKER_OPEN' });

export class ChainGeocoder {
  readonly #sources: readonly GeocoderSource[];
  readonly #breaker: SourceBreaker;
  readonly #deadlineMs: number;
  readonly #now: () => number;

  constructor(options: ChainGeocoderOptions) {
    this.#sources = options.sources;
    this.#breaker = options.breaker;
    this.#deadlineMs = options.deadlineMs ?? chainDeadlineMs;
    this.#now = options.now ?? Date.now;
  }

  /** The sources asked for a lookup, in order. */
  sourcesFor(method: GeocodeMethod): readonly GeocoderProviderName[] {
    return this.#for(method).map((source) => source.provider);
  }

  /** `deadlineMs` caps this lookup below the chain's own deadline (DEL-2 intake: 2 s). */
  geocode(query: GeocodeQuery, deadlineMs?: number): Promise<ChainAnswer<GeocodeResult>> {
    return this.#run('geocode', (source) => source.geocode?.(query), deadlineMs);
  }

  lookupShortCode(code: string, deadlineMs?: number): Promise<ChainAnswer<ShortCodeResult>> {
    return this.#run('shortcode', (source) => source.lookupShortCode?.(code), deadlineMs);
  }

  reverse(point: GeoPoint, deadlineMs?: number): Promise<ChainAnswer<ReverseResult>> {
    return this.#run('reverse', (source) => source.reverse?.(point), deadlineMs);
  }

  #for(method: GeocodeMethod): GeocoderSource[] {
    return this.#sources.filter((source) =>
      method === 'geocode'
        ? source.geocode !== undefined
        : method === 'shortcode'
          ? source.lookupShortCode !== undefined
          : source.reverse !== undefined,
    );
  }

  async #run<T>(
    method: GeocodeMethod,
    ask: (source: GeocoderSource) => Promise<T | NotFound> | undefined,
    deadlineMs: number | undefined,
  ): Promise<ChainAnswer<T>> {
    const limitMs = Math.min(this.#deadlineMs, deadlineMs ?? Number.POSITIVE_INFINITY);
    const sources = this.#for(method);
    const count = (source: string, outcome: string) =>
      getMetrics().add('geocoder_calls_total', 1, { method, source, outcome });
    const started = this.#now();
    let failure: ProviderFailure | undefined;
    let last: GeocoderProviderName | undefined;
    for (const source of sources) {
      const remaining = limitMs - (this.#now() - started);
      if (remaining <= 0) {
        failure = new ProviderFailure('transient', 'the geocoder chain ran out of time', {
          status: 'TIMEOUT',
        });
        break;
      }
      last = source.provider;
      if (!(await this.#breaker.admit(source.provider))) {
        count(source.provider, 'breaker_open');
        failure = breakerOpen(source.provider);
        continue;
      }
      try {
        const answer = await withinDeadline(ask(source), remaining);
        await this.#breaker.reachable(source.provider);
        if (answer === undefined || (answer as NotFound).kind === 'not_found') {
          count(source.provider, 'not_found');
          continue;
        }
        count(source.provider, 'miss');
        return { answer: answer as T, source: source.provider };
      } catch (error) {
        if (error instanceof GeocoderInputError) throw error;
        const reason = error instanceof ProviderFailure ? error.reason : 'transient';
        count(source.provider, reason);
        if (isOutage(error)) await this.#breaker.outage(source.provider);
        else if (error instanceof ProviderFailure && error.status !== 'BAD_RESPONSE') {
          // The source answered (4xx, 429, 5xx): it is reachable, though it said no.
          await this.#breaker.reachable(source.provider);
        }
        failure =
          error instanceof ProviderFailure
            ? error
            : new ProviderFailure('transient', 'the geocoder failed', { status: 'ERROR' });
      }
    }
    if (failure !== undefined) throw failure;
    if (last === undefined) {
      throw new ProviderFailure('permanent', `no geocoder source for ${method}`, {
        status: 'NO_SOURCE',
      });
    }
    return { answer: notFound, source: last };
  }
}

/** The answer, or a transient `TIMEOUT` once the chain's remaining time is spent. */
async function withinDeadline<T>(
  pending: Promise<T> | undefined,
  remainingMs: number,
): Promise<T | undefined> {
  if (pending === undefined) return undefined;
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new ProviderFailure('transient', 'the geocoder chain ran out of time', {
            status: 'TIMEOUT',
          }),
        ),
      remainingMs,
    );
  });
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
