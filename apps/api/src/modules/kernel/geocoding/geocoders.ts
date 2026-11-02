import type { Config } from '@eeasy-logistics/config';
import type { OnApplicationShutdown } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { GeocodeCacheStore } from '../platform/geocode-cache.repository.js';
import { ChainGeocoder } from './chain-geocoder.js';
import type { GeocoderSource } from './geocoder.js';
import type { GeocoderServiceParts } from './geocoder.service.js';
import { HudhudGeocoder } from './hudhud-geocoder.js';
import { SayyarGeocoder } from './sayyar-geocoder.js';
import { SourceBreaker, memoryBreakerStore, redisBreakerStore } from './source-breaker.js';
import { SplGeocoder } from './spl-geocoder.js';
import { StubGeocoder } from './stub-geocoder.js';

// The geocoder of this build (INT-2 plan 2.7, 2.11): the sources of `GEOCODER_SOURCES` in order,
// each only with what it needs (spl's short codes need `NATIONAL_ADDRESS_API_KEY`, hudhud needs
// `HUDHUD_API_KEY`; the stub only in local and ci), behind breakers on Redis, the cache table on
// the platform pool and Redis in front. `RequestFrameModule.forRoot` provides it as
// `GEOCODER_SETUP`; `KernelModule` turns it into the `GEOCODER` service.

export const GEOCODER_SETUP = Symbol('GEOCODER_SETUP');

/** The sources a configuration yields, in order, and the ones skipped with the reason. */
export function geocoderSources(config: Config): {
  sources: GeocoderSource[];
  skipped: string[];
} {
  const geo = config.geo;
  const sources: GeocoderSource[] = [];
  const skipped: string[] = [];
  for (const name of geo.geocoderSources) {
    if (name === 'stub') {
      if (config.app.env === 'local' || config.app.env === 'ci') sources.push(new StubGeocoder());
      else skipped.push(`stub (not in ${config.app.env})`);
    } else if (name === 'spl') {
      sources.push(
        new SplGeocoder({
          apiUrl: geo.splApiUrl,
          poiUrl: geo.splPoiUrl,
          apiKey: geo.nationalAddressApiKey,
        }),
      );
      if (geo.nationalAddressApiKey === undefined) {
        skipped.push('spl short codes (no NATIONAL_ADDRESS_API_KEY)');
      }
    } else if (name === 'sayyar') {
      sources.push(new SayyarGeocoder({ baseUrl: geo.sayyarUrl }));
    } else if (geo.hudhudApiKey === undefined) {
      skipped.push('hudhud (no HUDHUD_API_KEY)');
    } else {
      sources.push(new HudhudGeocoder({ baseUrl: geo.hudhudApiUrl, apiKey: geo.hudhudApiKey }));
    }
  }
  return { sources, skipped };
}

/** The parts of the `GEOCODER` service, owning its Redis connection (closed on shutdown). */
export class GeocoderSetup implements OnApplicationShutdown {
  readonly parts: GeocoderServiceParts;
  readonly #redis: Redis | undefined;

  constructor(config: Config, cache: GeocodeCacheStore | undefined) {
    const logger = new Logger('Geocoder');
    const url = config.redis.url;
    this.#redis =
      url === undefined
        ? undefined
        : new Redis(url.reveal(), {
            connectTimeout: 2000,
            commandTimeout: 500,
            maxRetriesPerRequest: 0,
            enableOfflineQueue: false,
          });
    this.#redis?.on('error', () => undefined);
    const { sources, skipped } = geocoderSources(config);
    if (config.geo.geocoderDisabled)
      logger.warn('GEOCODER_DISABLED=true: every lookup answers unavailable');
    for (const reason of skipped) logger.warn(`geocoder source skipped: ${reason}`);
    if (cache === undefined)
      logger.warn('DATABASE_URL_PLATFORM is not set: no geocode cache table');
    const breaker = new SourceBreaker(
      this.#redis === undefined ? memoryBreakerStore() : redisBreakerStore(this.#redis),
    );
    this.parts = {
      chain: sources.length === 0 ? undefined : new ChainGeocoder({ sources, breaker }),
      disabled: config.geo.geocoderDisabled,
      cache,
      redis: this.#redis,
    };
  }

  onApplicationShutdown(): void {
    this.#redis?.disconnect();
  }
}
