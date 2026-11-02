# DEL-2 · Orders and intake rules

- **Status:** planned 2026-11-02; registers and briefs when DEL-1 (PR #132) is on `main` (the coverage port and the migration seam), as the executor slot DEL-1 frees.
- **Date:** 2026-11-02
- **Wave:** 1 (roadmap §1.2; the critical path: DEL-1 → DEL-2 → DEL-6). **Depends on:** DEL-1 (zones, coverage, `CoverageQuery`, the `delivery` gate), INT-2 (merged: `GeocoderService`), PLAT-12 (merged: sites, `effectiveSettings`), PLAT-8 (merged: outbox), Q-1, Q-3, Q-4, Q-6 on their provisional defaults (§7). **Unblocks:** DEL-3 (CSV import), DEL-6 (offers and dispatch), DEL-7 (the driver's field loop), WEB-5 (orders screens), the recipient tracking order.
- **Lead:** architecture lead. **Executor:** `executor-api` (Opus), own worktree, native stack scratch databases (PostGIS), Redis, the geocoder stub. **Adversary:** yes, Opus (recipient personal data on every row, `If-Match` and the state machine, idempotency, the per-account sequence under concurrency, tenancy of the order doors; data §10).
- **Issue:** opened at registration. **Merge danger:** one-way door (one migration: `del_orders`, `del_order_items`, `del_order_events`, `core_sequences` if absent). Blast radius: the first orders exist; no screen or app reads them yet.
- **Paths:** `apps/api` (`modules/delivery/orders/` new: tables, intake, the state machine module, the staff doors, presenters; `modules/delivery/public/index.ts` the ports DEL-6 and DEL-7 take; `modules/kernel/schema/orders.ts` and `sequences.ts` new; `modules/kernel/sequences/` new (`SequenceAllocator`, domain-model §1.1 and §8); `modules/kernel/contract/` one additive `If-Match` reader; `modules/kernel/outbox/domain-event.ts` the order event types; `drizzle/<timestamp>_del_orders.sql` and its snapshot; `test/integration/orders*.http.test.ts`), `packages/db` (the exemption and RLS lists; the append-only grant list), `docs/architecture/data.md` and `domain-model.md` §6.3 (A-26-style rows for the events), `docs/contracts/errors.md` only if a code is missing, `.serena/memories`. Shared seam `packages/contracts`: nothing expected; a needed change is recorded in §8.1 and checked against the in-flight orders.
- **Design references:** none (API only).

## 0. Goal

A dispatcher creates an order of any kind for a site with a recipient, an address and items, and the API numbers it gap-free per account, geocodes the address through the short code or the text, resolves the zone through the site's coverage, applies the account's intake rule (accept at once, or receive as pending) and leaves an uncovered or unlocated order `pending` with a typed reason; the dispatcher lists, reads and edits orders with optimistic concurrency, accepts, fails and cancels them along the state machine's dispatcher arrows with an append-only event per change, so that DEL-6 can offer and assign, DEL-7 can replay the driver's events against the same machine, and WEB-5 can render orders from one contract.

## 1. Binding rules and ADRs

- AGENTS.md hard rules: ledgers are append-only (`del_order_events` by trigger; the status column is the fold of its events written in the same transaction); tenancy from the token; side effects through the outbox; allowlist by default (the `delivery` gate of DEL-1 covers these doors); Arabic and English for every string (item names are bilingual).
- ADR-0008 (events and idempotency: `(account_id, idempotency_key)` unique forever on `del_order_events`), ADR-0015 (an uncovered order is refused with a typed reason, never silently unassignable), ADR-0005 and D-1 (`executor_account_id` always NULL by CHECK), ADR-0025, ADR-0031 (`del_*` on the app pool, both policies), ADR-0029 (cursor lists), ADR-0026 (Delivery's public surface).
- `docs/architecture/domain-model.md` §1.1 (`SequenceAllocator`: kernel → all, sync, in the caller's transaction), §3.1 to §3.3 (Order, OrderItem, OrderEvent attributes and kinds), §3.13 in full (the arrows and the actor table), §3.18 D-1 to D-5, D-8, D-14, D-15, D-16, D-22, D-23, §8 (UUIDv7, `core_sequences (account_id, name)` under a row lock, halalas, append-only triggers, idempotency, optimistic concurrency, event sequence), §9 #1, #3, #4, #6 (the provisional answers).
- `docs/architecture/data.md` §2.1 rows `del_orders`, `del_order_items`, `del_order_events` (columns, indexes, CHECKs), §3.1 (the append-only trigger function and the grant script pattern of migration 0001), §8 (geometry), §10 (recipient personal data: retention and the scrub rules the executor reads for the presenter and logs), §11.
- `docs/architecture/integrations.md` §6.2 (geocode at intake: short code first, then text with `city`; confidence stored; below the threshold or `not_found` the order is accepted without a reliable point and listed in "needs location"; a higher-trust `pin_source` is never overwritten; zone resolution on the point).
- `docs/contracts/README.md` §5 (transitions are explicit operations; dispatcher transitions need `If-Match`; `409 invalid_transition` with `current_status` and `version`; the `version_conflict` example); `docs/contracts/openapi/staff-delivery.yaml` `createOrder`, `listOrders`, `getOrder`, `updateOrder`, `listOrderEvents`, `transitionOrder`, `cancelOrder`, `rescheduleOrder` with their permissions, parameters and codes; `components.yaml` `Order`, `OrderItem`, `OrderEvent`, `CreateOrderRequest`, `Recipient`, `Address`, `Money`, `OrderKind`, `OrderStatus`; `staff-delivery.yaml` `UpdateOrderRequest`, `TransitionRequest`, `ReasonRequest`, `RescheduleRequest`; `docs/contracts/errors.md` rows `version_conflict`, `invalid_transition`, `outside_coverage`, `order_locked`, `validation_failed`, `limit_exceeded`.
- Kernel and Delivery in place: INT-2 `GeocoderService` (`GEOCODER` token through the kernel's public block: `lookupShortCode`, `geocode(text, { city, locale })`, confidence, `not_found`, the stub in local and ci), DEL-1 `CoverageQuery` and `outsideCoverage` (Delivery public), PLAT-12 `effectiveSettings` (`intake_rule`, `max_attempts`, `reason_codes`), PLAT-6 `ContractPipe` and the idempotency interceptor (`@Idempotent()`), PLAT-7 `AuditSink`, PLAT-8 `OutboxWriter` and the event catalogue, PLAT-12's page helper and `ScopedRepository` (`transactionLock`), DEL-4's lock patterns (8.2 #10, #28) and `DeliveryModule.forRoot`.
- Memories `core`, `api/core`, `api/delivery`.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Tables | One generated, timestamp-named migration with the hand-written parts: `del_orders` as data §2.1 (every column there; `pending_reason` CHECK `outside_coverage`, `awaiting_review`, `needs_location` (added: the §6.2 "needs location" state, a data.md amendment); `status` CHECK over the eleven statuses; `number bigint`; the six indexes and the GiST; CHECK D-1 and D-4; `version integer NOT NULL DEFAULT 1`; both policies), `del_order_items` (the row; `(account_id, order_id)`), `del_order_events` (the row; unique `(account_id, idempotency_key)`; `(account_id, order_id, server_ts)`; the append-only trigger of data §3.1 attached; the grant script extended as 0001 says), `core_sequences (account_id, name, value)` with PK `(account_id, name)` if no earlier migration created it (the executor checks), a platform-class? No: a tenant table under both policies (its rows belong to the account); grants `elx_app` CRUD, `elx_platform` SELECT on orders for the cross-tenant reads of wave 2 |
| 2.2 | Sequence allocator | `modules/kernel/sequences/sequence-allocator.ts` (`SequenceAllocator.next(uow, name)`: `INSERT … ON CONFLICT DO UPDATE SET value = value + 1 RETURNING value` under the row lock the update takes, in the caller's unit of work, so a rolled-back create rolls the number back (D-2); exported through the kernel's public block; the order number presented as `D-` plus six digits, wider when needed); a concurrency test: twenty parallel creates give twenty consecutive numbers with no gap |
| 2.3 | Create and intake | `createOrder` (`delivery.orders.create`, `@Idempotent()`): the site must be the account's, `active`, kind `branch` or `both` (`422 site_kind_mismatch`); `kind` rules of §3.1 (`cod_amount` non-zero only for `delivery` and `exchange`, D-4: `400 validation_failed` at `/body/cod_amount`; `exchange` items need both directions? No: `in` items optional; `return_pickup` and `pickup_request` items default `in`; recorded); recipient phones normalised to E.164 (PLAT-9's `normalisePhone`); `slot_id` refused `400 validation_failed` at `/body/slot_id` until the slots order ships (no `del_slots` yet; contract note); `items` at most 200, names 1 to 200 code points, `quantity` 1 to 9999, `declared_value` halalas; `notes` 1000; then in one transaction: the number (2.2), the geocode step (2.4), the zone (2.5), the intake rule (2.6), the `del_orders` row, the items, the first event (`type: transition`, `from_status: null`, `to_status` the resulting status, actor the user, `idempotency_key` the request's), audit `delivery.order.created` (recipient name and phone never in `after`: the number, kind, site, status, `pending_reason`, item count, `cod_amount`), outbox `delivery.order.created` (payload: order id, number, kind, site, status, zone; no recipient data, data §10); `201 Order` with `version 1` |
| 2.4 | Geocode at intake | Integrations §6.2 in order: a sent `address.point` wins with `pin_source: manual` and confidence 1.0 (a dispatcher typed or pinned it); else `national_address_short_code` through `lookupShortCode` (hit: `geocoded`, 1.0); else `geocode(text, { city, locale })`: a result at or above the account threshold (a constant 0.6 until a settings key exists, §7 #2) sets `point`, `geocoded`, the confidence; below it or `not_found` or a geocoder outage: no point, `pending_reason: needs_location`, the order still created (the geocoder's own budget and breaker apply; an outage never fails the create); the geocoder call runs before the transaction opens (it is I/O), its result passed in |
| 2.5 | Zone and coverage | With a point: `CoverageQuery.coverage(point, { siteId })` in the transaction: covered → `zone_id` set; not covered → `zone_id` null, `pending_reason: outside_coverage` (D-3); no point → `zone_id` null, `pending_reason: needs_location`; a later `updateOrder` of the address re-runs 2.4 and 2.5 and may clear the reason |
| 2.6 | Intake rule and the machine | `effectiveSettings.intake_rule`: `auto_accept` → the order is created `accepted` when it has a zone, else `pending` with the reason; `receive_as_pending` → `pending` (reason null when covered, else the reason); `max_attempts` copied onto the row from the settings at creation (D-14; a per-order override is §7 #3, not here). The state machine lives in `modules/delivery/orders/order-machine.ts` as data: every arrow of §3.13 with its actor set (`driver`, `dispatcher`, `site_staff`, `system`), `transition(current, to, actor)` answering the arrow or the refusal, and `isTerminal`; DEL-6 and DEL-7 reuse it through Delivery public; a unit test proves the full table (every pair of statuses for every actor) |
| 2.7 | Read doors | `listOrders` (`delivery.orders.read`; site scope applies: a site-scoped member sees their sites' orders, PLAT-10's `@SiteScoped()` on the door; filters `status`, `site_id`, `driver_id` (through `current_assignment_id` → `del_assignments`, which does not exist yet: `driver_id` answers an empty page with a contract note until DEL-6), `created_from`, `created_to`, `updated_from`, `kind`, `number` (exact, with or without the `D-` prefix), `source_ref`, `q` (recipient name or phone tail, number); sort `created_at` desc default, `updated_at`; cursor in SQL (no in-memory paging: the list is the dispatch board's); the list item is the full `Order` without `items` (the generated schema allows the omission; else with items and limit 25: the executor records); `getOrder` (with items); `listOrderEvents` (cursor by `server_ts`, `id`); the presenter never includes `executor_account_id` |
| 2.8 | Update | `updateOrder` (`delivery.orders.create`, `@Idempotent()`, `If-Match` required: a missing header `400 validation_failed` at `/header/if-match`, a mismatch `409 version_conflict` with `current_status` and `version`): PATCH of the sent fields `recipient`, `address`, `items` (full replacement of the list), `cod_amount`, `notes`; refused `409 order_locked` for `recipient`, `address` and `items` once the status is `picked_up` or later and for any field on a terminal order; `cod_amount` follows D-4; an address change re-runs geocode and coverage (2.4, 2.5) and, for a `pending` order, re-evaluates the intake rule; `version + 1`, a `note` event? No: an event of `type: note` with the changed keys in `payload` (so the timeline shows edits), audit `delivery.order.updated` with changed keys (recipient fields named, values not) |
| 2.9 | Transitions | `transitionOrder` (`delivery.orders.dispatch`, `@Idempotent()`, `If-Match`): `to_status` `accepted` (from `pending` when the order has a zone, else `422 outside_coverage` or `422 needs_location`? No: `outside_coverage` for both, with `details.pending_reason` naming which; from `attempted` as the dispatcher's reschedule without a slot) or `failed` (from `out_for_delivery` and `attempted`, `reason_code` required from the account's reason codes, `400 validation_failed` otherwise); `cancelOrder` (`delivery.orders.cancel`, `@Idempotent()`, `If-Match`, `reason_code` from the account's codes): from any pre-pickup status (`pending`, `accepted`, `offered`, `assigned`) → `cancelled`; from `picked_up`, `out_for_delivery`, `attempted` → `failed` with the reason (Q-6: the parcel comes back through `returned` by site staff's `checkInReturn`, a later order); a terminal order `409 invalid_transition`; every transition: the machine's verdict (D-5), the row under `FOR UPDATE`, `status`, `version + 1`, `terminal_at` on a terminal status, the event row with `from_status`, `to_status`, actor, `reason_code`, `note`, the request's idempotency key, audit `delivery.order.transitioned` (from, to, reason), outbox `delivery.order.status_changed` (payload: order id, number, from, to, zone, site; no recipient data); `rescheduleOrder` answers `404` until the slots order (not registered; contract note); offers, assignment and the driver events are DEL-6 and DEL-7 on this machine |
| 2.10 | Ports for later orders | Delivery public: `OrderMachine` (2.6), `OrderTransitions.apply(uow, orderId, { to, actor, reasonCode, note, idempotencyKey, clientTs, point, deviceId })` (the one write path every later arrow uses: DEL-6's offer acceptance, DEL-7's driver events with D-16 and D-23 checks added there), `OrderReader.byId(uow, id)`; the WMS `OwnFleetOrderPort.createFromPackage` is WMS-7's (it will call the intake service of 2.3 with `source: wms_package`) |
| 2.11 | Tests | Unit: the machine table, D-4 and the kind rules, the number presenter, the intake decision table (rule × covered × located). HTTP on the PLAT-5 harness with the geocoder stub and DEL-1's fixtures: create of each kind; the number sequence under twenty parallel creates; short code hit, text hit above and below the threshold, `not_found`, a geocoder outage (the stub's fault switch) → `needs_location`; uncovered → `outside_coverage` and `accepted` refused; `auto_accept` vs `receive_as_pending`; idempotent replay returns the same order; list filters and sort, site scope for a site-scoped member, `q` by phone tail; update with and without `If-Match`, a stale version `409`, `order_locked` after a forced `picked_up` (set through the port in the test); accept, fail with a reason, cancel pre- and post-pickup, terminal refusals; the event rows append-only (an UPDATE is refused by the trigger); the audit rows carry no recipient data; both RLS lanes; `migrate` twice; contract scenarios for the seven live operations |

### 2a. Lead's improvements over the roadmap row

- **`needs_location` as a third pending reason**, so "accepted without a reliable point" (integrations §6.2) is visible on the row and in the list filter instead of being inferred from a null point; data.md is amended.
- **A geocoder outage never fails a create** (2.4): the order lands `needs_location`; INT-2's breaker and budget protect the chain and WEB-5 shows the list.
- **The state machine as reusable data** (2.6, 2.10) with one write path, so DEL-6 and DEL-7 extend the actor checks instead of re-implementing arrows; the full-table unit test is the contract.
- **`If-Match` handled once** in the kernel's contract layer (2.8), ready for DEL-6's assignment doors.
- **`slot_id` and `rescheduleOrder` wait for the slots order** explicitly (contract notes) rather than storing an unchecked id.
- **No recipient data in audit or outbox payloads** (2.3, 2.9) from the first order, per data §10, so the adversary's usual finding is designed out.

## 3. Build list

### Leg 1 (tables, sequences, the machine, create with intake)

| Item | Delivers | Verify |
|---|---|---|
| A | Migration, schema files, exemption, RLS and append-only lists, `SequenceAllocator` per 2.1, 2.2 | migrate twice; tenancy schema test; the trigger test; twenty parallel numbers |
| B | The machine module, intake service, `createOrder` with geocode, coverage and the intake rule per 2.3 to 2.6, 2.10 | HTTP per 2.11 (create cases); the machine table |
| C | Plan §8 for the leg, memories, draft PR | full local gate; counts in §8.0 |

### Leg 2 (read, update, transitions)

| Item | Delivers | Verify |
|---|---|---|
| D | `listOrders`, `getOrder`, `listOrderEvents`, the `If-Match` reader, `updateOrder` per 2.7, 2.8 | HTTP per 2.11 (list, update) |
| E | `transitionOrder`, `cancelOrder`, the public write path per 2.9, 2.10; contract scenarios | HTTP per 2.11 (transitions) |
| F | data.md and domain-model rows (`needs_location`, the events), plan §8 complete, memories, PR body | gate passes |

## 4. Commit plan

One commit per item `DEL-2: <letter> <title>` with its §8.0 row, pushed after each; draft PR from the template with the exact headings; body lines `Release note: none (API only; WEB-5 carries the visible change)` and `Memories:`.

## 5. Exit criteria

- An order of each kind is created with a gap-free number, a geocoded point, a zone and the intake rule's status; an uncovered or unlocated order is `pending` with its reason and cannot be accepted.
- Twenty parallel creates number consecutively; a rolled-back create leaves no gap.
- Every dispatcher arrow of §3.13 works with `If-Match` and refuses a stale version or an illegal arrow with the documented `409`; a terminal order never changes.
- `del_order_events` refuses updates and deletes; a replayed create or transition returns the original result.
- No audit row, outbox payload or log line carries a recipient's name or phone; both RLS lanes green; no contract change.

## 6. Not in this order

CSV import (DEL-3); offers, assignment, capacity and the dispatch stream (DEL-6); driver events, attempts, proofs and COD (DEL-7, DEL-8); slots and `rescheduleOrder` (the slots order); tracking tokens and recipient pages; the `address_pin_request` message (wave 2); the public intake door (wave 4); a per-order `max_attempts` override (§7 #3).

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | Offline conflict rule D-23 (domain-model §9 #1; Q-1) | Field fact wins, dispatcher alerted; DEL-7 implements it on this machine |
| 2 | Geocode confidence threshold | A constant 0.6 until `AccountSettings` gains a key (contract change) |
| 3 | Per-order `max_attempts` override (Q-3) | Not in wave 1; the account setting is copied at creation |
| 4 | Exchange as one order (Q-4) | One order of kind `exchange` with `out` and `in` items |
| 5 | Cancel after pickup (Q-6) | Becomes `failed` with the reason; `returned` on the site's check-in; a door refusal is DEL-7's attempt |

## 8. Executor notes (filled by the executor)

### 8.0 Counts

| Item | Commit | Tests (red → green) | Interpretation |
|---|---|---|---|
| A | see `git log` (`DEL-2: A …`) | `orders-table.test.ts` 5 red (migration out of the journal) → 5 green; `tenancy.test.ts` 14 green; `sequence-allocator.test.ts` 3 green; ELX_RLS=on; `migrate` twice on a scratch database (21 applied, then nothing); second `drizzle-kit generate`: no changes | 8.2 #1, #2 |

### 8.1 Deviations

### 8.2 Notes

1. **`core_sequences` (2.1, 2.2).** No migration on `main` created it, so this one does, as data §2.1 names it (`next_value`, the name CHECK of §7), not the plan's `value`. Provisioning does not create the rows yet, so `SequenceAllocator` upserts (`INSERT … ON CONFLICT DO UPDATE`, the row lock held to commit) through a new `ScopedRepository.upsert` in `packages/db`, whose target must lead with `account_id`.
2. **Columns beyond data §2.2 (2.1).** `del_order_items.position` keeps the request's item order (UUIDv7 ids of one millisecond are not monotonic); `del_order_events.note` is the contract's `OrderEvent.note`; a CHECK ties `type = transition` to a `to_status`. `idempotency_key` is nullable (system events carry none). `elx_platform` reads the four tables and writes none.

### 8.3 Not done here

## 9. Lead review and adversary
