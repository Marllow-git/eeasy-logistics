# ADR-0024: Route every cross-system side effect through an outbox and a queue

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner (merged PR #1, 2026-10-31)
- **Source:** eeasynew MONEY-2 lesson (one poisoned outbox row blocked every month close); ADR-0013

## Context

Messages, push notifications, channel publications, webhooks to merchants and calls to the Eeasy shipping API are side effects of transactions. eeasynew learned that one poisoned job must never block its neighbours and that side effects need an audit trail.

## Decision

A transaction that must cause an external effect writes an outbox row in the same database transaction. A relay enqueues outbox rows to BullMQ (Redis) queues by kind; workers execute with idempotency, exponential backoff, a dead-letter state per row and a supersede rule where newer intent replaces older. No controller or service calls an external system directly.

## Consequences

Every external effect is listed, retryable and inspectable in the platform admin. Latency of a few hundred milliseconds between commit and effect.

## Alternatives considered

Direct calls after commit: lost on crash, invisible on failure. Queue without outbox: the dual-write problem.
