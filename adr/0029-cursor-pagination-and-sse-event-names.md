# ADR-0029: Page lists by opaque cursor and name SSE events after domain event types

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** API contracts (document 3) §3 and §6; ADR-0009, ADR-0027, ADR-0028

## Context

Every list in the contracts needs one pagination rule, and the busiest lists (orders, events, stock movements) grow by thousands of rows a day while dispatchers read them. Offset pagination skips or repeats rows when new rows arrive between pages and gets slower with depth. ADR-0009 commits to server-sent events for dispatcher maps and recipient pages but does not say what an event is called on the wire or how a client resumes after a drop, which is the normal case on mobile networks.

## Decision

Lists take `cursor` and `limit` (1 to 200, default 50) and return `{ data, next_cursor }`. The cursor is opaque to clients: a base64url string of the last row's sort-key values and `id`, signed by the API so it cannot be forged, valid 24 hours and only with the same filters and sort. Sorting is by a documented field list with `id` as the tie-breaker. No list exposes offsets or total counts; counts are separate summary endpoints where a screen needs them.

On every SSE stream the `event:` name is the domain event `type` from document 2 §6.3 and `data:` is the ADR-0027 envelope reduced to what the reader may see; `id:` is the envelope `id`. Driver positions, which are not domain events (ADR-0028), use `event: telemetry.driver_location` with no `id:`. A reconnecting client sends `Last-Event-ID`; the server replays the reader's events after it from a 15-minute buffer, or sends one `stream.resync` event when the id is older, after which the client refetches through REST. The server sends `retry: 5000` and a keep-alive comment every 20 seconds.

## Consequences

Lists are stable under concurrent inserts and cost the same at any depth; a client cannot jump to page N, which no screen in the references needs. Event names need no second vocabulary: a client that understands webhooks understands the stream. The API keeps a short per-account replay buffer in Redis, bounded by time.

## Alternatives considered

Offset and limit: simple but skips and repeats rows on live lists. Keyset parameters in the clear (`after_id`, `after_created_at`): clients would depend on the sort internals and every new sort would change the contract. A separate SSE vocabulary (`order_update`, `position`): a second set of names to keep in sync with the catalogue for no gain. No resume, refetch on every reconnect: correct but floods the API when a site's network blips.
