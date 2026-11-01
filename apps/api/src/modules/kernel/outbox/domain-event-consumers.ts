import type { UnitOfWork } from '@eeasy-logistics/db';
import type { DomainEvent, DomainEventType } from './domain-event.js';

// In-process consumers of `internal_event` rows (PLAT-8 plan 2.6; domain model §2.7, §6.2, §6.3;
// data §5.3): a consumer is a class with a stable `consumer` name, subscribed to event types with
// `@OnDomainEvent(type)`. The `InternalEventDispatcher` of the worker records a receipt per
// consumer and event before running it, so a redelivery is a no-op.

/** One internal consumer. `consumer` names its receipts and dead letters: never rename it. */
export interface DomainEventConsumer {
  /** Stable, `<context>.<what>` (e.g. `kernel.account_suspended_log`). */
  readonly consumer: string;
  /**
   * Handles one event, at least once per event and in `sequence` order per aggregate. An account's
   * event runs in a tenant unit of work on `elx_app` for the event's account (`uow`: repositories
   * built on it see that account's rows only, by predicate and by RLS), the same transaction that
   * inserted its receipt, so a failure rolls the receipt back and the event is retried. A
   * platform-only event (no account) gets no unit of work (adversary M-3).
   */
  handle(event: DomainEvent, uow?: UnitOfWork): Promise<void>;
}

type ConsumerClass = abstract new (...args: never[]) => DomainEventConsumer;

const subscriptions = new WeakMap<object, readonly DomainEventType[]>();

/** Subscribes a consumer class to event types (repeatable). */
export function OnDomainEvent(...types: DomainEventType[]) {
  return (target: ConsumerClass): void => {
    subscriptions.set(target, [...(subscriptions.get(target) ?? []), ...types]);
  };
}

/** The types a consumer instance is subscribed to. */
export function subscribedTypes(consumer: DomainEventConsumer): readonly DomainEventType[] {
  return subscriptions.get(consumer.constructor) ?? [];
}

/** The consumers of this build, by event type. */
export class DomainEventConsumerRegistry {
  readonly #byType = new Map<string, DomainEventConsumer[]>();
  readonly #types = new Map<string, readonly DomainEventType[]>();

  constructor(consumers: readonly DomainEventConsumer[]) {
    for (const consumer of consumers) {
      if (this.#types.has(consumer.consumer)) {
        throw new Error(`Two internal consumers named ${consumer.consumer}`);
      }
      const types = subscribedTypes(consumer);
      if (types.length === 0) {
        throw new Error(`Consumer ${consumer.consumer} has no @OnDomainEvent subscription`);
      }
      this.#types.set(consumer.consumer, types);
      for (const type of new Set(types)) {
        this.#byType.set(type, [...(this.#byType.get(type) ?? []), consumer]);
      }
    }
  }

  /** The consumers of `type`, in registration order. */
  for(type: string): readonly DomainEventConsumer[] {
    return this.#byType.get(type) ?? [];
  }

  /** The consumer names, in registration order (`platformListConsumers`). */
  names(): readonly string[] {
    return [...this.#types.keys()];
  }

  /** The types `consumer` is subscribed to. */
  typesOf(consumer: string): readonly DomainEventType[] {
    return this.#types.get(consumer) ?? [];
  }
}
