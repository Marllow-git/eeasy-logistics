import { Logger } from '@nestjs/common';
import { FeatureCacheBustConsumer } from '../features/feature-cache.consumer.js';
import type { FeatureCache } from '../features/feature-resolver.js';
import type { DomainEvent } from './domain-event.js';
import type { DomainEventConsumer } from './domain-event-consumers.js';
import { OnDomainEvent } from './domain-event-consumers.js';

/**
 * The sample internal consumer of PLAT-8 (plan 2.6): logs `core.account.suspended` (ids only,
 * never the payload). The real effects (ending shifts, pausing the account's effects) are DEL-5's.
 */
@OnDomainEvent('core.account.suspended')
export class AccountSuspendedLogConsumer implements DomainEventConsumer {
  readonly consumer = 'kernel.account_suspended_log';

  constructor(
    private readonly logger: { log(message: string): void } = new Logger('AccountSuspended'),
  ) {}

  handle(event: DomainEvent): Promise<void> {
    this.logger.log(`Account ${event.accountId ?? '-'} suspended (event ${event.id})`);
    return Promise.resolve();
  }
}

/**
 * The kernel's internal consumers in this build. PLAT-13: the feature cache bust, given the worker's
 * cache (none: it consumes and does nothing; the platform list only needs its name).
 */
export function kernelConsumers(
  options: { readonly featureCache?: FeatureCache | null } = {},
): DomainEventConsumer[] {
  return [
    new AccountSuspendedLogConsumer(),
    new FeatureCacheBustConsumer(options.featureCache ?? null),
  ];
}
