import { describe, expect, it } from 'vitest';
import { AccountSuspendedLogConsumer, kernelConsumers } from './account-suspended.consumer.js';
import type { DomainEvent } from './domain-event.js';
import type { DomainEventConsumer } from './domain-event-consumers.js';
import { DomainEventConsumerRegistry, OnDomainEvent } from './domain-event-consumers.js';

// PLAT-8 item F: the `@OnDomainEvent` registry (plan 2.6).

@OnDomainEvent('core.site.updated')
@OnDomainEvent('core.feature_flag.changed')
class TwoTypes implements DomainEventConsumer {
  constructor(readonly consumer = 'test.two_types') {}
  handle(): Promise<void> {
    return Promise.resolve();
  }
}

class Unsubscribed implements DomainEventConsumer {
  readonly consumer = 'test.unsubscribed';
  handle(): Promise<void> {
    return Promise.resolve();
  }
}

describe('DomainEventConsumerRegistry', () => {
  it('finds consumers by type, with every subscription of a class', () => {
    const consumer = new TwoTypes();
    const registry = new DomainEventConsumerRegistry([consumer]);
    expect(registry.for('core.site.updated')).toEqual([consumer]);
    expect(registry.for('core.feature_flag.changed')).toEqual([consumer]);
    expect(registry.for('core.account.suspended')).toEqual([]);
    expect([...registry.typesOf('test.two_types')].sort()).toEqual([
      'core.feature_flag.changed',
      'core.site.updated',
    ]);
  });

  it('refuses two consumers with one name and a consumer without a subscription', () => {
    expect(() => new DomainEventConsumerRegistry([new TwoTypes(), new TwoTypes()])).toThrow(
      'Two internal consumers named test.two_types',
    );
    expect(() => new DomainEventConsumerRegistry([new Unsubscribed()])).toThrow(
      'has no @OnDomainEvent subscription',
    );
  });

  it('registers the kernel sample consumer of core.account.suspended, which logs ids only', async () => {
    const registry = new DomainEventConsumerRegistry(kernelConsumers());
    expect(registry.for('core.account.suspended').map((c) => c.consumer)).toEqual([
      'kernel.account_suspended_log',
    ]);
    const lines: string[] = [];
    const consumer = new AccountSuspendedLogConsumer({ log: (line) => lines.push(line) });
    await consumer.handle({
      id: 'e1',
      accountId: 'a1',
      payload: { reason: 'unpaid invoice' },
    } as unknown as DomainEvent);
    expect(lines).toEqual(['Account a1 suspended (event e1)']);
  });
});
