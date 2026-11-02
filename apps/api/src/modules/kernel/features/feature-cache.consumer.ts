import type { DomainEvent } from '../outbox/domain-event.js';
import type { DomainEventConsumer } from '../outbox/domain-event-consumers.js';
import { OnDomainEvent } from '../outbox/domain-event-consumers.js';
import type { FeatureCache } from './feature-resolver.js';
import { featureCacheKeys } from './feature-resolver.js';

/**
 * The gate's cache bust (PLAT-13 plan 2.5, 2.6; domain model §6.3 `core.feature_flag.changed`,
 * consumers "all (cache bust)"): after a rollout or flag change commits, the worker deletes the
 * cached value, so no API instance keeps a value the request's own delete raced with for its 60 s.
 * A rollout change (no `account_id` in the payload) drops `elx:rollout:<key>`; a flag change drops
 * `elx:feature:<account>:<key>`. Without Redis there is no cache and nothing to do. A failed
 * delete throws (adversary L-5), so the outbox retries the event rather than marking it done.
 */
@OnDomainEvent('core.feature_flag.changed')
export class FeatureCacheBustConsumer implements DomainEventConsumer {
  readonly consumer = 'kernel.feature_cache_bust';

  constructor(
    private readonly cache: FeatureCache | null,
    private readonly prefix = 'elx',
  ) {}

  async handle(event: DomainEvent): Promise<void> {
    const key = event.payload.feature_key;
    if (this.cache === null || typeof key !== 'string') return;
    const accountId = event.payload.account_id;
    const name =
      typeof accountId === 'string'
        ? featureCacheKeys.flag(accountId, key, this.prefix)
        : featureCacheKeys.rollout(key, this.prefix);
    await this.cache.delete([name]);
  }
}
