# ADR-0009: Deliver live tracking by polling and server-sent events, not sockets

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** gap-fill research 2026-09-21; eeasynew LM-4

## Context

No reference product updates driver positions faster than every several seconds. The research ruled: poll every 10 to 15 seconds, design the API for server-sent events, add sockets later if ever.

## Decision

Driver positions are posted by the app every 10 to 15 seconds while on shift (background task), accepted with 202. Dispatcher maps and recipient pages read positions through an SSE stream from the API with a polling fallback at the same interval. No WebSocket gateway in waves 0 to 3.

## Consequences

Horizontal scaling stays stateless. Position retention is bounded (last N per driver plus a daily trail). The recipient page shows "updated X seconds ago" rather than pretending to be live.

## Alternatives considered

WebSockets from day one: stateful, more infrastructure, no user-visible gain at this cadence.
