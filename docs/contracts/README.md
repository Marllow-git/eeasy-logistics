# API contracts

Foundation document 3. Date: 2026-10-31. Status: for owner review. Governed by ADR-0008 (idempotency and `409` on stale transitions), ADR-0009 (SSE and polling), ADR-0014 (pack-time shipments), ADR-0015 (storage and coverage first), ADR-0024 (outbox), ADR-0025 (tenancy), the proposed ADR-0027 (event envelope) and ADR-0028 (location pings), and the proposed ADR-0029 (cursor pagination and SSE event names) and ADR-0030 (merchant webhook signing and delivery); derives from the domain model (document 2); informs data (5), web (7), driver app (8), integrations (9). Order: ARCH-1, decisions 2.1 to 2.4.

The domain model is the vocabulary. Aggregate names, attributes, states and invariants (K-, D-, W-) are cited from `docs/architecture/domain-model.md` by section and never redefined here. Actors, roles, tokens and rate-limit mechanics come from `docs/architecture/identity-and-tenancy.md` (document 4).

| File | What it holds |
|---|---|
| `README.md` | this document: surfaces, conventions, streams, waves |
| `errors.md` | the stable error `code` list |
| `REVIEW.md` | the adversary review findings and their outcomes |
| `webhooks.md` | the merchant webhook catalogue, signing and delivery |
| `openapi/components.yaml` | shared schemas (every aggregate of document 2), parameters, responses, security schemes |
| `openapi/staff.yaml`, `openapi/staff-delivery.yaml`, `openapi/staff-wms.yaml` | the web app surface, one file per bounded context (ADR-0026): kernel, Delivery, WMS; same base path and session |
| `openapi/driver.yaml`, `openapi/recipient.yaml`, `openapi/public.yaml`, `openapi/platform.yaml` | the other four surfaces |

## 1. Surfaces and base paths

| Surface | Base path | Actor (document 4 §1) | Credential (document 4 §4) | Security scheme |
|---|---|---|---|---|
| Staff | `/v1/staff` | merchant staff: owner, admin, dispatcher, site staff, warehouse staff, cashier, viewer | access JWT (15 min) in an httpOnly SameSite=Lax cookie, rotating refresh cookie (30 days) | `staffCookie` |
| Driver | `/v1/driver` | driver | access JWT (15 min) as bearer, device-bound rotating refresh token (90 days); cash PIN on cash actions | `driverBearer` |
| Public | `/v1/public` | integrator | static API key in `X-API-Key` (owner question 1 default), scoped to a permission subset; never driver or platform permissions | `apiKey` |
| Recipient | `/v1/recipient` | recipient | signed per-order token (HMAC over order id, purpose, expiry) in `X-Recipient-Token` | `recipientToken` |
| Platform | `/v1/platform` | platform super admin, admin, support | access JWT in a separate cookie, TOTP mandatory, 12 h idle expiry | `platformCookie` |

A credential is valid on its own surface only: a driver token on `/v1/staff` returns `401 unauthenticated`; a revoked API key, or an old key after its rotation overlap, returns `401 api_key_revoked`. The account of every request comes from the credential (K-3); no request body or parameter carries `account_id`, and responses on the four tenant surfaces omit it. Platform routes that read another account take the account id in the path, are declared `x-cross-tenant: true` (the `@CrossTenant()` handler of document 4 §5) and write an audit row per call with the `X-Support-Reason` header text.

Authorization: every operation names one permission in `x-permission`, a flat string `<module>.<resource>.<action>` (document 4 §2). Site-scoped roles are further filtered by membership `site_ids`. Two pseudo-permissions mark doors without a role check: `core.auth.anonymous` (sign-in doors, rate-limited by identity and IP) and `core.auth.self` (the caller's own session; `platform.auth.self` on the platform surface). Recipient operations carry `delivery.tracking.view`, `delivery.tracking.reschedule` or `delivery.tracking.pin_address`, granted by the token's `purpose` (document 2 §3.12), not by a role. Document 4 gives the format and examples but no full list; the strings used in the OpenAPI files are the proposed catalogue in §11, for the owner to confirm with the role bundles.

## 2. Versioning (plan 2.3)

- Every path carries `/v1`. Additive changes (a new optional field, a new operation, a new value in an enum marked extensible) do not bump the version. Clients ignore unknown fields.
- A breaking change (removed or renamed field, changed type, new required input, changed meaning) adds `/v2` beside `/v1`; both are served for one wave, then the `/v1` operation is removed with a release note. This mirrors the event `version` rule of ADR-0027.
- Webhook payloads follow the envelope `version` (document 2 §6.1), not the path version.
- Enums that can grow (`reason_code`, `feature_key`) are marked `x-extensible-enum: true`; clients treat an unknown value as "other".

## 3. Conventions

| Topic | Rule |
|---|---|
| Paths | plural kebab-case nouns (`/orders`, `/order-imports`, `/count-sessions`); a state transition is a verb sub-resource (`/orders/{order_id}/cancel`) |
| JSON | `snake_case` fields; `null` and absent are equivalent on read; `PATCH` is JSON merge patch (RFC 7396) |
| Time | ISO 8601 with offset (`2026-10-31T14:05:00+03:00`); business dates (cash day, slot day) are `YYYY-MM-DD` in Asia/Riyadh (document 2 §8) |
| Money | `{ "amount": 15000, "currency": "SAR" }`: integer halalas, never floats (`Money` schema, document 2 §8) |
| Ids | UUIDv7 strings for every resource (document 2 §8); human numbers (`D-000123`) are display fields and filterable |
| Idempotency | `Idempotency-Key` (UUID, client-generated) on every `POST`, `PUT`, `PATCH` and `DELETE` a client may retry; stored 24 h per principal (K-8); a replay with the same body returns the stored response; the same key with a different body returns `422 idempotency_key_reused`; a missing key returns `400 idempotency_key_required`. Driver order events stay deduplicated forever (D-15) and the replay must match the principal (driver and device) and the request hash. Secret-bearing operations (`createApiKey`, `rotateApiKey`, `createWebhookSubscription` and `rotateWebhookSecret` on the staff and public surfaces, `issueTrackingToken`) store their response with the secret removed: a replay returns `409 secret_already_issued` with `details.resource_id`, and the CI rule lists them by name. Secrets and PINs (`cash_pin`, passwords, OTPs) are removed from the body before the request hash is computed. Exempt from the key, and listed by the CI rule: the session doors under `/auth/` on every surface (sign-in, OTP, TOTP, invitation, password reset, refresh, logout: single-use or naturally idempotent, and most have no principal to scope a key), `POST /v1/driver/locations` (document 2 §7), and the read-only computations sent as `POST` because of their body (`/coverage/check`, `/v1/public/labels`) |
| Concurrency | dispatcher writes to Order and Assignment send `If-Match: "<version>"` with the `version` they read (D-22); missing returns `428 version_required`, a mismatch returns `409 version_conflict` with `details.current_status` and `details.version`. Responses for those aggregates carry `ETag: "<version>"` |
| Pagination | cursor only (ADR-0029): `?cursor=<opaque>&limit=<1..200, default 50>`; response `{ "data": [...], "next_cursor": "..." or null }`; a cursor is valid 24 h and only with the same filters and sort |
| Filtering | named query parameters per field (`status`, `site_id`, `driver_id`, `created_from`, `created_to`, `updated_from`); a comma list means "any of" (`status=assigned,picked_up`); `q` for free text where offered |
| Sorting | `sort=<field>` or `sort=-<field>` from the operation's documented list; default `-created_at`; `id` is always the tie-breaker |
| Language | `Accept-Language: ar` or `en` selects `message` text in errors and labels in reference lists; default is the account's locale (ADR-0016); bilingual data fields are `name_ar` and `name_en` |
| Uploads | never in the API body: the API returns a write-once signed upload URL (ADR-0015) valid 10 minutes, with content type, sha256 and maximum size (photos and slips 10 MB, CSV 20 MB) bound into the signature; the server picks the object key under the account prefix and clients refer to the file by `upload_id`; the client `PUT`s the file, then confirms (proofs, deposit slips, CSV imports). Reads are expiring signed URLs on a separate file domain with `Content-Disposition: attachment` |
| Async jobs | long work (CSV import) returns `202` with a job resource; poll it or stream it |
| Codes and challenges | OTP, second-factor and TOTP codes: at most 5 verification attempts per code or challenge, then invalidated; challenges expire after 5 minutes; a used TOTP code is refused for its whole window (document 4 §3) |
| Request ids | every response carries `X-Request-Id`; error bodies repeat it as `request_id` |

## 4. Error model (plan 2.4)

Every non-2xx body is the `Error` schema: `{ "code", "message", "details"?, "request_id" }`. `code` is a stable snake_case string from `errors.md`; clients branch on `code`, never on `message`, which is localised by `Accept-Language`. `details` is code-specific: `fields[]` with JSON pointers for `validation_failed`; `current_status` and `version` for `409` transition and version conflicts (D-5, D-22); `retry_after_s` for `rate_limited`. Each operation lists the codes it can return in the `description` of each specific status; the generic `4XX` response covers `validation_failed`, `idempotency_key_required`, `unauthenticated`, `token_expired`, `forbidden`, `feature_not_enabled`, `account_suspended`, `not_found` and `rate_limited` everywhere. A resource in another account, outside the member's `site_ids`, or off the driver's run is `404 not_found`, never `403` (document 4 §9, check 2); `403 driver_not_assignee` is kept only for a former assignee (D-23).

## 5. State transitions

Transitions are the domain model state machines (§3.13 to §3.17, §4.11 to §4.15) and nothing else. Each is an explicit operation whose `description` cites the arrow it performs.

- Dispatcher transitions on an order (`/orders/{order_id}/transitions`, `/offers`, `/assignment`, `/cancel`, `/reschedule`) require `If-Match`.
- Driver transitions go through one replayable endpoint, `POST /v1/driver/orders/{order_id}/events`, carrying `client_ts`, `point` and the event's `Idempotency-Key`; replays return the original result (ADR-0008, D-15, D-16, D-23).
- An illegal arrow, or a legal arrow by the wrong actor, returns `409 invalid_transition` with `{ "current_status", "version" }` in `details` (D-5). A terminal order never transitions (D-8).
- A successful transition returns the updated aggregate with its new `version`.

Example: a dispatcher assigns from a board that read version 7 while another dispatcher had already cancelled the order.

```http
PUT /v1/staff/orders/0192f100-1111-7222-8333-444455556666/assignment
Idempotency-Key: 0192f3b0-2a1c-7d00-9e00-0000000000a1
If-Match: "7"
Content-Type: application/json

{"driver_id":"0192e500-0000-7000-8000-0000000000d1"}

HTTP/1.1 409 Conflict
{"code":"version_conflict","message":"تغيّر الطلب منذ آخر تحميل","details":{"current_status":"cancelled","version":8},"request_id":"req_7Hq2"}
```

## 6. Server-sent events

| Stream | Path | Who | Event names |
|---|---|---|---|
| Dispatch board | `GET /v1/staff/streams/dispatch` | staff with `delivery.orders.read`, filtered to membership `site_ids` | `delivery.order.*`, `delivery.offer.expired`, `delivery.driver.cash_blocked`, `delivery.shift.started`, `delivery.shift.ended`, `telemetry.driver_location` |
| Import job | `GET /v1/staff/order-imports/{import_id}/stream` | staff with `delivery.orders.import` | `job.progress`, `job.completed` |
| Driver | `GET /v1/driver/stream` | the token's driver | `delivery.order.offered` (offers to this driver), `delivery.order.assigned`, `delivery.order.cancelled`, `delivery.order.accepted` (order taken back), `delivery.driver.cash_blocked` |
| Recipient | `GET /v1/recipient/tracking/stream` | the token's order | `delivery.order.*` for this order reduced to the public view (D-24); `telemetry.driver_location` only while `out_for_delivery` |

Rules (ADR-0029):

- The SSE `event:` is the domain event `type` (document 2 §6.3) and `data:` is the envelope (§6.1) with the payload reduced to what the reader may see; driver and recipient streams send `ReducedEnvelope` (no `account_id`, `causation_id` or `correlation_id`). Driver positions are not domain events (ADR-0028): they use `event: telemetry.driver_location` and carry no `id:`.
- `id:` is the envelope `id` (UUIDv7, time-ordered). On reconnect the client sends `Last-Event-ID`; the server replays the reader's events after that id from a 15-minute buffer. If the id is older than the buffer, it sends one `stream.resync` event and the client refetches through REST.
- The server sends `retry: 5000` once and a comment line (`: keep-alive`) every 20 s.
- A stream lives no longer than its credential: the server closes it when the access token expires (the client reconnects with a fresh token and `Last-Event-ID`), when the member or device is revoked, and when the account is suspended. The recipient stream re-reads the TrackingToken row (expiry and `revoked_at`) on connect and every 60 s.
- Polling fallback at 10 to 15 s (ADR-0009): every stream has a REST twin: `GET /v1/staff/driver-locations/latest` and `GET /v1/staff/orders?updated_from=`, `GET /v1/driver/offers` and `GET /v1/driver/orders`, `GET /v1/recipient/tracking`.
- The recipient stream also accepts the token as `?token=` because `EventSource` cannot set headers; only purpose `track` is accepted there. Recipient pages send `Referrer-Policy: no-referrer`, and query strings are excluded from access logs, traces and error reports on every surface.

On the wire (dispatch board, one domain event then one position):

```text
retry: 5000

id: 0192f3a1-7c4e-7b11-9a2b-6f0d1c2e3a4b
event: delivery.order.picked_up
data: {"id":"0192f3a1-…","type":"delivery.order.picked_up","version":1,"aggregate_id":"0192f100-…","sequence":6,"payload":{…}}

event: telemetry.driver_location
data: {"driver_id":"0192e500-…","lat":24.7136,"lng":46.6753,"client_ts":"2026-10-31T14:05:00+03:00"}

: keep-alive
```

## 7. Rate limits by surface

Mechanics are document 4 §8: per-route budgets in Redis keyed by the stable identity first and IP second, identical bodies and timing for unknown and disabled identities on sign-in doors. Proposed defaults, adjustable per account by the platform:

| Surface | Key | Default budget |
|---|---|---|
| Staff | user id | 600 requests per minute; sign-in 10 per email and 50 per IP per 15 min |
| Driver | device id | 300 per minute; `POST /locations` 12 per minute; OTP 5 per phone and 20 per IP per hour, 60 s resend cooldown (document 4 §3.2) |
| Public | API key id | 600 per minute, burst 100; order create 120 per minute; webhook subscription create and URL change 5 per hour per account (also on the staff surface) |
| Recipient | token | 60 per minute; reschedule and pin writes 5 per token per hour |
| Platform | user id | 300 per minute |

Every response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`; `429 rate_limited` adds `Retry-After`.

## 8. Webhooks

Merchant webhooks are the domain events marked "yes" in document 2 §6.3, delivered in the ADR-0027 envelope, signed and retried per ADR-0030. The catalogue, payloads and delivery rules are in `webhooks.md`; the subscription endpoints and the machine-readable `webhooks:` section are in `public.yaml`.

## 9. OpenAPI files and validation

- OpenAPI 3.1, one file per surface (plan 2.1); the staff surface is split by bounded context (ADR-0026) into `staff.yaml` (kernel), `staff-delivery.yaml` and `staff-wms.yaml`, which keeps each file under about 1,200 lines and lets each context own its contract. Each file starts with `openapi: 3.1.0`, `info` and `servers` and references shared parts as `./components.yaml#/components/schemas/Order`. Operation-specific request bodies live in the surface file's own `components.schemas`.
- Every operation has `operationId` (unique across all files), `summary`, `tags`, `x-wave`, `x-permission`, `security`, parameters, a request body for writes, a success response and typed error responses. Writes carry the `Idempotency-Key` parameter; dispatcher Order and Assignment writes carry `If-Match`.
- Extensions: `x-wave` (0 to 4), `x-permission`, `x-cross-tenant` (platform), `x-availability: after-wms-pilot` (public WMS paths, owner question 2), `x-extensible-enum`.
- CI (wave 0, `packages/contracts`): `redocly lint` with the recommended ruleset plus repository rules (operationId present and unique, `x-wave` and `x-permission` present, permission matches `^[a-z]+\.[a-z_]+\.[a-z_]+$`, every write declares `Idempotency-Key` unless listed as exempt, every `$ref` resolves); `redocly bundle` produces one file per surface; TypeScript types and clients are generated from the bundles for `apps/web` and `apps/driver`; contract tests generated from the bundles run against the API in Compose and fail on any undocumented status, field or error code.
- The YAML is the source of truth; generated code is never edited by hand.

## 10. Wave map

`x-wave` on each operation is the wave in which it must work (foundation plan §6):

| Wave | Operations |
|---|---|
| 0 Foundation | staff auth (invite accept, login, second factor, refresh, logout, password reset), `me`, account and settings, members, sites, audit log; platform auth, account provisioning with sites and coverage, rollout modes and flags, suspension, cross-tenant reads, outbox inspection and replay |
| 1 Delivery core | zones and coverage, drivers, vehicles, devices, driver auth with device registration and cash PIN, shift start and end, orders (create, CSV import job, list, get, events, transitions, cancel, edit), offers and manual assignment, driver order events with attempts, proofs (signed upload then confirm) and COD collections, driver locations, SSE streams, tracking tokens and the recipient tracking page |
| 2 Dispatch and money | slots and slot days, shift planning, reschedule and address pin (staff and recipient), handovers, deposits, cash reports, liability and cash-block clearing, diagnose console |
| 3 WMS core | locations and totes, products, lots, serials, suppliers, purchase orders, receipts, movements (read), stock levels and summaries, fulfilment orders, pick tasks, packages (pack, choose method, label), adjustments, count sessions |
| 4 Network | public API (orders, tracking, webhook subscriptions), API key self-service on the staff surface, WMS returns, channel publications; public WMS paths stay `x-availability: after-wms-pilot` |

## 11. Permission catalogue (proposed)

| Module | Permissions |
|---|---|
| core | `core.auth.anonymous`, `core.auth.self`, `core.account.read`, `core.account.manage`, `core.members.read`, `core.members.manage`, `core.sites.read`, `core.sites.manage`, `core.audit.read`, `core.api_keys.manage`, `core.webhooks.manage` |
| delivery (staff) | `delivery.orders.read`, `delivery.orders.create`, `delivery.orders.import`, `delivery.orders.dispatch`, `delivery.orders.cancel`, `delivery.orders.receive`, `delivery.zones.read`, `delivery.zones.manage`, `delivery.coverage.manage`, `delivery.drivers.read`, `delivery.drivers.manage`, `delivery.drivers.clear_cash_block`, `delivery.vehicles.manage`, `delivery.shifts.manage`, `delivery.slots.manage`, `delivery.proofs.read`, `delivery.cash.read`, `delivery.cash.receive`, `delivery.cash.deposit`, `delivery.cash.close_report`, `delivery.liability.record`, `delivery.tracking.manage`, `delivery.locations.read` |
| delivery (driver) | `delivery.driver.work`, `delivery.driver.cash`, `delivery.driver.locations` |
| delivery (recipient token) | `delivery.tracking.view`, `delivery.tracking.reschedule`, `delivery.tracking.pin_address` |
| wms | `wms.locations.read`, `wms.locations.manage`, `wms.products.read`, `wms.products.manage`, `wms.suppliers.manage`, `wms.purchase_orders.read`, `wms.purchase_orders.manage`, `wms.receipts.read`, `wms.receipts.write`, `wms.receipts.approve`, `wms.movements.read`, `wms.stock.read`, `wms.fulfilment.read`, `wms.fulfilment.manage`, `wms.picking.write`, `wms.packing.write`, `wms.returns.write`, `wms.adjustments.request`, `wms.adjustments.approve`, `wms.counts.write`, `wms.counts.approve`, `wms.channel_publications.read` |
| platform | `platform.auth.self`, `platform.accounts.read`, `platform.accounts.provision`, `platform.accounts.suspend`, `platform.rollout.manage`, `platform.flags.manage`, `platform.tenants.read`, `platform.outbox.read`, `platform.outbox.replay`, `platform.diagnose.run`, `platform.staff.manage`, `platform.audit.read` |

Role bundles (proposed, document 4 §2; site-scoped roles act only on their `site_ids`):

| Role | Holds |
|---|---|
| owner | every core, delivery and wms permission above, including `core.members.manage` (only the owner grants `owner`), `core.api_keys.manage`, `delivery.drivers.clear_cash_block`, `delivery.liability.record` and the three WMS approvals |
| admin | the owner set; billing and owner transfer are not permission strings and stay with the owner |
| dispatcher | `core.account.read`, `core.sites.read`, `delivery.orders.read`, `.create`, `.import`, `.dispatch`, `.cancel`, `delivery.zones.read`, `.manage`, `delivery.drivers.read`, `delivery.drivers.manage` (device revoke, PIN reset), `delivery.vehicles.manage`, `delivery.shifts.manage`, `delivery.slots.manage`, `delivery.proofs.read`, `delivery.tracking.manage`, `delivery.locations.read`, `delivery.cash.read` |
| site staff | `core.sites.read`, `delivery.orders.read`, `delivery.orders.receive`, `delivery.proofs.read` |
| warehouse staff | `wms.locations.read`, `wms.products.read`, `wms.purchase_orders.read`, `wms.receipts.read`, `wms.receipts.write`, `wms.movements.read`, `wms.stock.read`, `wms.fulfilment.read`, `wms.picking.write`, `wms.packing.write`, `wms.returns.write`, `wms.adjustments.request`, `wms.counts.write` |
| cashier | `core.sites.read`, `delivery.orders.read`, `delivery.cash.read`, `delivery.cash.receive`, `delivery.cash.deposit`, `delivery.cash.close_report`; never `delivery.orders.dispatch` or `delivery.liability.record` |
| viewer | every `*.read` permission of core, delivery and wms |
| driver | `delivery.driver.work`, `delivery.driver.cash`, `delivery.driver.locations`; never combined with a cash permission (M9) |
| platform super admin | every platform permission |
| platform admin | every platform permission except `platform.rollout.manage` and `platform.staff.manage`; holds `platform.outbox.replay` |
| platform support | `platform.auth.self`, `platform.accounts.read`, `platform.tenants.read`, `platform.outbox.read`, `platform.audit.read`, `platform.diagnose.run` (whitelisted fixes only) |

An API key may hold only `delivery.orders.read`, `delivery.orders.create`, `delivery.orders.cancel`, `delivery.proofs.read`, `core.webhooks.manage` and, after the WMS pilot, `wms.products.read`, `wms.stock.read`, `wms.receipts.read`, `wms.fulfilment.read`, `wms.fulfilment.manage` (document 4 §3.4). A webhook subscription receives an event type only while its creator holds the matching read permission (`webhooks.md` §4).

## 12. Open points for the owner

1. Plan owner questions 1 and 2 are applied as their defaults: static `X-API-Key`; public WMS paths present with `x-wave: 4` and `x-availability: after-wms-pilot`.
2. Cash PIN on a cash delivery (document 4 §3.2 unchanged): `cash_pin` travels in the `delivered` event and is never persisted. Online at the door (event within 120 s of `client_ts`) a wrong PIN is refused with `cash_pin_invalid` so the driver can retype; on an offline replay the field fact is recorded (D-23), the failure counts toward the lock and the driver is `cash_blocked` until a supervisor clears it. The 120 s online window is a proposal.
3. Document 2 has no event for an assignment ending (unassign or transfer); the driver stream uses `delivery.order.accepted` and the driver app refetches its run. A `delivery.assignment.ended` event would be clearer.
4. Route sequencing (wave 2, VROOM) has no attribute for stop order in document 2; its contract is left to the wave 2 order.
5. D-24 wording: the recipient view also shows the merchant name and the slot window. Proposed D-24 text: "status, ETA, driver first name, last position while out_for_delivery, merchant name, slot window"; the lead amends the domain model.
