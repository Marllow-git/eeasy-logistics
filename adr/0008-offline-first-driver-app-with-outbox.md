# ADR-0008: Make the driver app offline-first with an idempotent outbox

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** gap-fill research 2026-09-21; UAT-1 idempotency verdicts

## Context

Only Shipox among the references queues driver actions offline, with a sync screen and deferred proof upload; OTO and Logestechs lose actions without a network. KSA field conditions (basements, warehouses, rural lanes) make offline the normal case for minutes at a time. UAT-1 proved the eeasynew driver API idempotency rules worked.

## Decision

Every driver write is recorded locally first in an outbox (SQLite) with a client-generated idempotency key, then replayed in order when online. Proof photos upload after the status write, with a retry queue. The app shows a sync screen with pending items and failures. The API accepts an idempotency key on every driver write and returns the original result on replay; a stale state transition returns 409 with the current state.

## Consequences

The order state machine must tolerate out-of-order arrival within one order (events carry client timestamps). Conflicts are resolved server-side and surfaced in the sync screen, never silently dropped.

## Alternatives considered

Online-only with retries: loses the UAT-1 driver-day guarantee the moment the signal drops. Full CRDT sync: unnecessary for an append-only event stream per order.
