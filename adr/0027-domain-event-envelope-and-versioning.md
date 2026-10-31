# ADR-0027: Publish domain events in one versioned envelope, ordered per aggregate

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** domain model (document 2) §6; ADR-0024, ADR-0026

## Context

Domain events cross contexts inside the API (ADR-0026) and leave the system as merchant webhooks (wave 4). Consumers must deduplicate retried deliveries, process one aggregate's events in order, and survive payload changes without a coordinated release. Merchant integrators cannot be asked to redeploy every time a field is added.

## Decision

Every event is written to the outbox in the transaction that causes it, in one envelope: `id` (UUIDv7), `type`, `version`, `occurred_at`, `account_id`, `aggregate_type`, `aggregate_id`, `sequence`, `causation_id`, `correlation_id`, `payload`. `type` is `<context>.<aggregate>.<past_tense_verb>` in snake_case (for example `delivery.order.delivered`, `wms.movement.recorded`). `version` is an integer: additive payload changes keep it; a breaking change bumps it and the previous version keeps being emitted alongside for one wave. `sequence` is the aggregate's `version` after the change and is strictly increasing per aggregate. Delivery is at least once; the relay orders by aggregate id, consumers deduplicate on `id` in `core_consumer_receipts` and park an event whose predecessor in `sequence` has not been processed.

## Consequences

One schema for internal consumers and webhooks; document 3 derives the webhook catalogue from the domain model's event table. Every event-producing aggregate carries a `version` column. Emitting two versions for a wave costs storage and relay throughput, which we accept for integrator stability.

## Alternatives considered

Per-event ad-hoc payloads: no common dedupe or ordering key. Global ordering across all events: needs a single writer and buys nothing consumers use. Integer or ULID ids: UUIDv7 matches the primary-key rule in the domain model §8 and sorts by time.
