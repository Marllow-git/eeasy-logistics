# Integration architecture

Foundation document 9. Date: 2026-10-31. Status: for owner review. Governed by ADR-0010 (VROOM over Hudhud), ADR-0013 (one-way channel stock sync), ADR-0014 (pack-time shipments via Eeasy shipping), ADR-0015 (storage first), ADR-0017 (payment port gated), ADR-0023 (own identity), ADR-0024 (outbox and queue), the proposed ADR-0027 (event envelope) and ADR-0040 (merchant webhook signing), and the proposed ADR-0036 (outbox kinds and worker queues) and ADR-0037 (messaging: templates only, no SMS before wave 3); derives from the domain model (2) and the contracts (3); informs waves 1 to 4 and the roadmap (12). Order: ARCH-1, decision 2.8.

The domain model is the vocabulary. Ports, aggregates, states, invariants (K-, D-, W-), outbox columns and events are cited from `domain-model.md` (document 2) by section and never redefined here. Merchant webhook payloads, signing and delivery are in `docs/contracts/webhooks.md`. Secrets, containers and alerts are in `platform.md` (document 6). Inbound webhook replay protection is in `identity-and-tenancy.md` (document 4) §8. Where a provider fact could not be checked from public material on 2026-10-31 it is marked **to confirm**; nothing marked so may be built on until confirmed in the wave's order.

## 1. Principles

1. **One port per external capability, one adapter per provider.** The port is a TypeScript interface in the owning context's `public/` folder (or the kernel's when more than one context needs it, ADR-0026); adapters live in that context's `infrastructure/<provider>/` folder and are chosen at boot by `packages/config`. Provider SDKs, provider types and provider error classes never cross the adapter: the port speaks domain types (E.164 phones, halalas, `geometry` points as `{lat, lng}`, our ids) and a closed set of typed failures (`unavailable`, `rejected(code)`, `rate_limited(retry_after_s)`, `not_found`, `unauthorised`).
2. **Every outbound side effect is an outbox row of a named `kind`** written in the business transaction (K-10, ADR-0024) and executed by a worker. No controller, service or consumer calls a provider that changes state outside our database. The kinds and queues are §4.
3. **Read-only computations are synchronous port calls**: geocode, matrix, solve, carrier quote, short-code lookup. They change nothing outside the system, so they are not outbox cases (document 2 §1.1). Each has a timeout, a cache where the answer is stable, a circuit breaker, and a stated degraded behaviour, so a provider outage degrades a screen and never fails a business write.
4. **Credentials have two homes.** Platform credentials (Hudhud key, WhatsApp provider token, Expo access token, storage keys, partner app client secrets) are environment secrets read once by `packages/config` (platform §3). Per-account credentials (Salla and Zid tokens, the merchant's Eeasy shipping API key, inbound webhook secrets) are encrypted at rest with a key from the secret store and a key-id column (platform §3), and are decrypted only inside the adapter for the duration of a call.
5. **Inbound is verify, store, emit.** A provider calling us is verified and stored by the kernel, then turned into an outbox event (document 2 §1.1, rows "Channel orders" and "Carrier status"). Contexts consume the event; none of them reads a provider payload (§3).
6. **Tenancy holds across the boundary.** Every worker job carries `account_id` and sets the request context before any repository call (document 4 §5). A suspended account's outbox effects pause (K-2); inbound webhooks for it are stored and emitted, and its consumers hold the events until reactivation.
7. **Stubs are adapters.** `local` and `ci` select a stub adapter for every port that costs money or reaches a third party; the stub is behind the same interface and records what it was asked (§9).

## 2. Port and adapter catalogue

Columns are the same for every port. "Wave" is the first wave that needs a working adapter (foundation plan §6). Timeouts are per HTTP call; retry and backoff for outbox kinds are in §4. The circuit breaker everywhere is: open after 5 consecutive failures or 50 % failures over at least 20 calls in 60 s, half-open after 30 s with one trial call, state exported as a metric (§10).

### 2.1 `DistanceMatrix` (Delivery)

| | |
|---|---|
| Methods | `matrix(points: Point[], profile: 'car', departAt?: datetime) → {durations_s: int[][], distances_m: int[][], source}`; `route(from, to) → {duration_s, distance_m}` for one ETA |
| Owner | Delivery, `delivery/public/ports` (ADR-0010) |
| Adapters | Hudhud matrix (first); OSRM self-hosted container on a Saudi OpenStreetMap extract (fallback, from wave 2); straight-line × 1.35 detour factor at 25 km/h (last resort, in process) |
| Kind | sync, read-only |
| Timeout | 5 s for up to 100 × 100; larger problems are split into tiles |
| Retry | one immediate retry on a network error; then the next adapter |
| Idempotency | not applicable (read) |
| Cache | per pair, per site and business date (ADR-0010) in Redis, key `mx:{account}:{site}:{date}:{geohash8 from}:{geohash8 to}`, expiring at the end of the business day; only missing pairs are requested |
| Breaker and degraded | breaker per adapter; when Hudhud is open the OSRM adapter answers and the result is marked `source = osrm`; when both are open the straight-line answer is used and the sequencing screen shows "approximate" |
| Stub | fixture matrix from straight-line distances, deterministic |
| Credentials | Hudhud B2B key, platform secret |
| Wave | 2 (routing rung 1); ETA on tracking in wave 1 uses `route` with the straight-line fallback allowed |

### 2.2 `Geocoder` (kernel)

| | |
|---|---|
| Methods | `geocode(text, city?, locale) → {point, confidence 0..1, district?, short_code?} \| not_found`; `lookupShortCode(code) → {point, address parts} \| not_found`; `reverse(point) → {text, district, city}` |
| Owner | kernel, `kernel/public/ports`: sites (kernel, §2.3 of document 2) and orders (Delivery) both need it |
| Adapters | Hudhud geocoding (first); National Address short code via Hudhud if its contract includes it, otherwise a Saudi National Address (SPL) API adapter (**to confirm** which). Built (INT-2, owner ruling 2026-11-02): a chain of sources in `GEOCODER_SOURCES` order, each behind its own breaker and asked only for the lookups it has: the official SPL API (short codes, with `NATIONAL_ADDRESS_API_KEY`) and its POI reverse lookup, the Sayyar mirror (short codes, text), then Hudhud as the fallback; the stub in local and ci. The adapter derives the confidence (Hudhud publishes none): 1.0 for an SPL or Hudhud short code, 0.95 for Sayyar's, 0.8 or 0.6 for a Sayyar text match, 0.9 for a single Hudhud search result and 0.7 for the first of several, 0.2 less for a settlement-level match |
| Kind | sync, read-only |
| Timeout | 2 s geocode, 2 s short code |
| Retry | one retry on network error |
| Cache | normalised text hash and short code → result, in `core_geocode_cache` (document 5 §2.1), 30 days for a hit and 24 hours for `not_found`, with Redis in front; the stub's answers are not cached |
| Breaker and degraded | intake never fails because geocoding failed: the order is stored with no point, `pin_source` unset and confidence 0, and it is listed in the dispatcher's "needs location" view; an address-pin request (§5) is the remedy |
| Stub | fixture table of Riyadh and Jeddah districts, unknown text returns `not_found` |
| Credentials | Hudhud key; SPL key if used; platform secrets |
| Wave | 1 |

### 2.3 `RouteOptimizer` (Delivery)

| | |
|---|---|
| Methods | `sequence(run: {vehicle, start, end?, shift window, stops[]}, matrix) → {ordered stop ids, eta per stop, unassigned[]}` (rung 1); `plan(vehicles[], jobs[], matrix, options) → routes[], unassigned[]` (rungs 2 and 3) |
| Owner | Delivery (ADR-0010) |
| Adapters | VROOM container on the private network (platform §2); nearest-neighbour over the same matrix, in process (fallback) |
| Kind | sync, read-only |
| Timeout | 10 s rung 1; 30 s rung 2 plan; rung 3 runs in a worker job with 60 s |
| Retry | none against VROOM; on timeout or error the fallback answers |
| Cache | none; a solve is cheap once the matrix is cached |
| Breaker and degraded | breaker on the VROOM adapter; the nearest-neighbour answer is marked `solver = fallback` and the driver app shows the same list without the "optimised" badge |
| Stub | the nearest-neighbour adapter itself; `ci` also runs the real VROOM image in a tagged suite |
| Credentials | none (private network) |
| Wave | 2 (rung 1), 4 (rungs 2 and 3) |

### 2.4 `MessageSender` (kernel)

| | |
|---|---|
| Methods | `sendTemplate({to E.164, template_key, locale ar\|en, params, idempotency_key}) → {provider_message_id}`; `listTemplates() → [{key, locale, status, category}]`; status callbacks and replies arrive inbound (§3) |
| Owner | kernel: driver and staff OTP (document 4 §3) and Delivery's recipient messages both send through it |
| Adapters | one WhatsApp Business provider adapter, for the provider eeasynew already uses (owner ruling 2026-11-01, Q-27; which provider is **to confirm** with eeasynew); SMS is a named second adapter with no implementation before wave 3 (ADR-0037) |
| Kind | outbox, kind `message` |
| Timeout | 5 s |
| Retry | §4.2 |
| Idempotency | the outbox row id, sent as the provider's client reference where supported; a resend after a timeout checks the reference first when the provider allows lookup (**to confirm** per provider) |
| Breaker and degraded | breaker per provider; while open, OTP requests return `503 messaging_unavailable` at the door (document 4 §3.2 budgets still apply) and recipient messages wait in the queue; platform §3 `MESSAGING_DISABLED=true` stops sends and marks rows `superseded` with reason `disabled` |
| Stub | `whatsapp-stub` (platform §2): records sends, exposes the last OTP per phone to tests |
| Credentials | provider token and webhook secret, platform secrets, **issued for this product only** (a system user or API key scoped to this product's number), never eeasynew's token; templates are platform-level, one set for all accounts |
| Wave | 0 (OTP template), 1 (recipient templates) |

### 2.5 `PushSender` (Delivery)

| | |
|---|---|
| Methods | `send(messages: [{push_token, title_key, body_key, locale, data, ttl_s, collapse_id}]) → tickets[]`; `receipts(ticket_ids) → [{id, ok \| error}]` |
| Owner | Delivery: push tokens live on DriverDevice (document 2 §3.5) |
| Adapters | Expo push service with an Expo access token (enhanced push security on) |
| Kind | outbox, kind `push`; receipt polling is a scheduled worker job, not an outbox row (it reads Expo and writes only our own DriverDevice rows) |
| Timeout | 5 s per batch of up to 100 messages |
| Retry | §4.2 |
| Idempotency | outbox row id in `data`; the driver app ignores a push id it has already shown |
| Token invalidation | a ticket or receipt error `DeviceNotRegistered` clears the push token on that DriverDevice in a Delivery transaction; the app re-registers on next start |
| Breaker and degraded | push is a hint: offers and runs are also fetched by the app on foreground and by polling (ADR-0009), so an open breaker delays, never loses, work |
| Stub | in-memory recorder; `ci` asserts on it |
| Credentials | Expo access token, platform secret; EAS project from the foundation plan §5 |
| Wave | 1 |

### 2.6 `ObjectStorage` (kernel)

| | |
|---|---|
| Methods | `signUpload(key, content_type, max_bytes, ttl_s) → {url, headers}`; `signRead(key, ttl_s, disposition) → url`; `head(key) → {size, sha256?} \| not_found`; `put(key, bytes, content_type)` (worker only: labels, exports); `deleteMany(keys[])` (only from kind `storage_lifecycle`) |
| Owner | kernel (ADR-0015) |
| Adapters | S3-compatible client: the Silo fork of MinIO in Compose (amended 2026-10-31, roadmap A-15), the host provider's bucket in staging and production |
| Kind | signing and `head` are sync and local (no network for signing); `put` runs inside the worker job that produced the file; deletion is outbox kind `storage_lifecycle` (§4) |
| Timeout | 10 s `head`, 60 s `put` |
| Layout | one bucket per environment; every key starts `acc/{account_id}/`: `proofs/{yyyy}/{mm}/{proof_id}`, `deposit-slips/{deposit_id}`, `labels/{package_id}.pdf`, `imports/{job_id}.csv`, `exports/{export_id}`; platform files under `platform/`. The API only signs keys under the caller's account prefix; the key is built server-side, never taken from the client |
| Signed URLs | upload 15 minutes, one object, size capped (proof photo 10 MB, slip 10 MB, CSV 20 MB); read 5 minutes for staff, 60 minutes for label print |
| Lifecycle | provider rules: abort incomplete multipart uploads after 1 day; `imports/` 30 days; `exports/` 7 days; noncurrent versions 30 days (versioning on, platform §6). Account-policy retention (proofs default two years, platform §6) and account-closure deletion run as `storage_lifecycle` rows so each deletion is audited |
| Degraded | `/ready` fails without storage (ADR-0015); a proof upload that fails stays `pending_upload` on the device and D-17 applies |
| Stub | Silo (MinIO fork) in `local` and `ci` |
| Credentials | bucket access key with rights on that bucket only, platform secret |
| Wave | 0 |

### 2.7 `CarrierShipments` (WMS)

| | |
|---|---|
| Methods | `quote(package dims and weight, origin site, destination) → [{carrier_code, service, price halalas, eta_days}]` (sync, display only); `createShipment({reference = package id, idempotency_key, origin, recipient, address, cod, weight_g, dims_mm, carrier_code, service, items}) → {eeasy_shipment_id, awb, carrier_code, label_url}`; `getLabel(eeasy_shipment_id, format) → pdf bytes`; `cancel(eeasy_shipment_id)`; `track(eeasy_shipment_id) → status history` |
| Owner | WMS (ADR-0014, W-12) |
| Adapters | Eeasy shipping public API (eeasynew #885); no fallback: when it is down, the own-fleet card still works |
| Kind | `quote` and `track` sync, read-only; `createShipment` and `cancel` outbox kind `carrier_call` |
| Timeout | quote 4 s; create 20 s; cancel 10 s; label 10 s |
| Retry | §4.2 |
| Idempotency | `Idempotency-Key: {package_id}:{method_generation}` (the generation increments each time the method is chosen again, W-13), and the package id as the merchant reference so a lost response is recovered by lookup |
| Breaker and degraded | breaker open: carrier cards show "carrier booking unavailable" and only the own-fleet card is selectable; queued `carrier_call` rows wait |
| Stub | recorded fixtures of #885 responses (§9) |
| Credentials | the merchant's Eeasy shipping API key, per account, encrypted with key id; inbound webhook secret likewise (§7) |
| Wave | 3 |

### 2.8 `ChannelOrders` and `ChannelStock` (kernel)

| | |
|---|---|
| Methods | `ChannelOrders`: `authorizeUrl(state)`, `exchangeCode(code) → tokens`, `refresh(tokens)`, `registerWebhooks(connection)`, `fetchOrder(ref)`, `mapOrder(raw) → channel order payload`; `ChannelStock`: `setQuantity(connection, channel_product_ref, quantity) → ok \| rejected`, `readQuantities(connection, refs[]) → map` (reconcile) |
| Owner | kernel: channel connections and inbound webhooks are kernel aggregates (document 2 §1); WMS calls `ChannelStock` through the kernel's `public/` folder from its publication handler |
| Adapters | Salla partner app; Zid partner app |
| Kind | OAuth exchange, `fetchOrder`, `readQuantities` sync; `setQuantity` and `registerWebhooks` outbox kind `channel_publish` (§4.1) |
| Timeout | 10 s |
| Idempotency | `setQuantity` is a set, not an increment, so a retry is harmless; supersede by (connection, product) (W-18) |
| Breaker and degraded | per connection and per provider; an open breaker leaves publications `pending`; the connection page shows the error (§8) |
| Stub | recorded fixtures plus a fake store that keeps quantities in memory |
| Credentials | partner app client id and secret (platform secrets); per-store access and refresh tokens (per account, encrypted with key id) |
| Wave | 4 |

### 2.9 `PaymentPort` (Delivery)

Named only (ADR-0017, document 2 §1.1). No adapter, no queue, no credentials until the owner approves digital COD; card and wallet are recorded as collected elsewhere with custody `not_held` (D-18). When approved, it becomes a new order with its own ADR choosing the tap-to-phone provider (Nearpay or Geidea) and the outbox kind for captures and refunds.

### 2.10 `MerchantWebhooks` (kernel)

| | |
|---|---|
| Methods | `deliver(subscription, envelope, attempt) → {status_code, duration_ms} \| error` |
| Owner | kernel (ADR-0040, `webhooks.md`) |
| Adapters | HTTP client with SSRF guard (§11) |
| Kind | outbox, kind `webhook` |
| Timeout, retry, ordering, dead letters | as `webhooks.md` §3: 10 s, backoff to 24 h, one in-flight delivery per subscription and aggregate |
| Stub | a local receiver container in `ci` that verifies signatures and records deliveries |
| Credentials | per-subscription secret, encrypted with key id |
| Wave | 4 |

Coverage check against document 2 §1.1: the external-system ports are `RouteOptimizer`, `DistanceMatrix` and `PaymentPort` (listed there by name), plus the channel orders and carrier status rows (§2.8 and §2.7 inbound side, §3). `Geocoder`, `MessageSender`, `PushSender`, `ObjectStorage`, `CarrierShipments` outbound, `ChannelStock` and `MerchantWebhooks` are the adapters behind document 2's outbox effects and context diagram (§1.2); this document names them as ports. The internal ports (`AccountContext`, `SitesQuery`, `FeatureGate`, `SequenceAllocator`, `AuditWriter`, `OutboxWriter`, `IdempotencyStore`, `CoverageQuery`, `OwnFleetOrderPort`) touch no external system and are out of scope.

## 3. Inbound webhooks

### 3.1 Pattern: verify, store, emit

| Step | Rule |
|---|---|
| 1. Receive | `POST /hooks/{provider}` (and `/hooks/zid/{connection_id}`, §3.2) on the api service, outside the five contract surfaces of document 3 §1 because the shape is the provider's, not ours; body limit 1 MB; raw bytes kept before any JSON parse |
| 2. Identify | resolve the connection (and so `account_id`) from the provider's store or merchant id, or the path; unknown or uninstalled connection → `200` with the row stored as `ignored`, so the provider stops retrying and nothing is emitted |
| 3. Verify | provider-specific check in §3.2, in constant time; failure → `401`, a row with status `rejected` holding headers (redacted) and no body, and a rate-limited security log line |
| 4. Replay window | where the provider signs a timestamp, reject more than 300 s from now (document 4 §8) |
| 5. Nonce | dedupe key = the provider's delivery or event id, else SHA-256 of the raw body; `(provider, dedupe_key)` unique in `core_inbound_webhooks` for 7 days; a duplicate returns `200` and is counted, nothing is emitted (document 4 §8 nonce table) |
| 6. Map and store | in one transaction: insert the `core_inbound_webhooks` row with the raw payload and status, map it in the adapter to the canonical payload, and write the outbox row (K-10). Status values: `emitted`, `ignored` (non-order event, uninstalled store), `duplicate`, `rejected`, `unmappable` (the adapter could not map it; alert, no event) |
| 7. Emit | channel orders → `core.channel_order.received`; Eeasy shipping updates → `core.carrier_update.received` (document 2 §6.3). Lifecycle events (install, authorize, uninstall, token revoked) and WhatsApp status and reply callbacks change kernel rows only and emit no domain event, because none exists for them in §6.3 |
| 8. Respond | `200` within 2 s; no provider call is ever made inside the request (the optional verify-by-fetch in §3.2 runs as a consumer step, not here) |

Raw payloads hold recipient PII: retained 30 days, then the body is deleted and the metadata row kept for one year (document 5 owns the retention table).

### 3.2 Per provider

| Provider | Endpoint | What the provider offers | Our check |
|---|---|---|---|
| Salla | `/hooks/salla` | an app-level webhook URL; a signature header computed as HMAC-SHA256 of the body with the app's webhook secret when the app chooses the signature strategy (header names `X-Salla-Signature` and `X-Salla-Security-Strategy`; **to confirm** on the partner portal); store events carry the merchant (store) id; app events (`app.store.authorize`, `app.uninstalled`) arrive on the same URL | signature strategy is required for our app; verify HMAC with the app secret; no timestamp in the signature (**to confirm**), so step 4 is skipped and step 5 dedupes on the event id plus body hash |
| Zid | `/hooks/zid/{connection_id}` | webhooks registered per store through the Zid API with an event and target URL; no body signature is documented (**to confirm**) | the path carries the connection id, and the per-connection random secret is sent as the Basic Auth password Zid supports at registration (`username` and `password` fields, confirmed 2026-10-31, `docs/research/provider-facts-2026-10.md`); it is compared in constant time and redacted from logs; then the consumer re-fetches the order with `fetchOrder` before acting (verify by fetch), so a forged call can at most trigger a read |
| Eeasy shipping | `/hooks/eeasy-shipping` | signed webhooks are a listed need of eeasynew #885 (foundation plan §5); the scheme is not yet defined | we ask #885 to adopt the ADR-0040 scheme unchanged (Standard Webhooks v1: `webhook-id`, `webhook-timestamp`, `webhook-signature: v1,` HMAC-SHA256 over `"<id>.<timestamp>.<raw body>"`, per-account `whsec_` secret, 300 s window); until then **to confirm** |
| WhatsApp provider | `/hooks/whatsapp` | message status (sent, delivered, read, failed) and inbound replies; Meta Cloud API signs with `X-Hub-Signature-256` (HMAC-SHA256 with the app secret); business solution providers use their own schemes (**to confirm** with the chosen provider) | provider scheme; statuses update the message log; an opt-out reply updates the opt-out list (§5.5) |
| Expo push | none | Expo exposes receipts by polling, not webhooks | not applicable (§2.5) |

### 3.3 Replay tooling for platform staff

- List and filter `core_inbound_webhooks` by account, provider, status and time; view the redacted headers and the raw body (an audited cross-tenant read, document 4 §5).
- **Re-map**: re-run the current adapter mapping on an `unmappable` or `emitted` row and emit again. A re-emitted event has a new envelope `id`, so consumers must also be idempotent on the business key: WMS and Delivery treat `(connection, channel order ref)` as unique for channel orders, and WMS treats `(eeasy_shipment_id, status, time)` as unique for carrier updates.
- **Re-fetch**: for channel orders, fetch the order from the channel and emit, used after an outage when the provider gave up retrying.
- The platform contract (document 3, `platform.yaml`) has outbox and channel publication replay but no inbound webhook listing or replay; those two operations are a contract addition owed by the wave 4 order (§12 notes).

## 4. Outbox kinds and worker queues

### 4.1 Kinds

The kinds are document 2 §2.7's six, plus `storage_lifecycle`, added by the proposed ADR-0036 because deleting stored objects is an irreversible external effect that platform §6 requires to be audited and that must be retryable per object; doing it from a scheduled job directly would be the one external effect outside the outbox (AGENTS.md). The contract enums in `platform.yaml` (`OutboxRow.kind`, `BulkReplayRequest.kind`) gain the value in the same change.

| Kind | Written by | Executes | Ordering | Supersede |
|---|---|---|---|---|
| `internal_event` | every context, in the business transaction | in-process consumers (document 2 §6.3 consumers column) | per aggregate (document 2 §6.2) | no |
| `webhook` | the kernel's webhook fan-out consumer, one row per matching active subscription per event | `MerchantWebhooks.deliver` | per (subscription, aggregate), `webhooks.md` §3 | no |
| `message` | the kernel (OTP) and Delivery consumers of the events that message recipients (§5); an OTP row carries the code encrypted with the credentials key and is deleted one hour after sending (data §5.2, §10) | `MessageSender` | none | key `msg:{order_id}:{template_group}`; stale check at send time (§4.3) (amended 2026-10-31, roadmap A-5) |
| `push` | Delivery consumers of `delivery.order.offered` and dispatcher actions | `PushSender` | none | key `push:{driver_id}:{order_id}`; expired offers are dropped |
| `channel_publish` | stock: the WMS summary projector into `wms_channel_publications` (document 2 §4.9, W-18); other channel writes (webhook registration at install): the kernel into `core_outbox` | `ChannelStock.setQuantity`, `ChannelOrders.registerWebhooks` | per connection, one in flight | stock: W-18 |
| `carrier_call` | WMS when `carrier` is chosen (W-12) or a carrier shipment is cancelled (W-13) | `CarrierShipments.createShipment`, `.cancel` | per package | a cancel supersedes an unsent create of the same generation |
| `storage_lifecycle` | the retention scheduler and the account closure tool, one row per batch of up to 1,000 keys | `ObjectStorage.deleteMany` then an audit row | none | no |

The relay reads `core_outbox` and `wms_channel_publications` and feeds the same `channel_publish` queue from both; the publication table stays WMS's dedicated outbox as document 2 §4.9 defines it.

### 4.2 Queues

One BullMQ queue per kind, named `outbox.<kind>`; the worker role runs all of them, each with its own concurrency so one slow provider cannot starve another (ADR-0024).

| Queue | Concurrency per worker | Provider rate limit (BullMQ limiter) | Attempts and backoff | Dead after |
|---|---|---|---|---|
| `outbox.internal_event` | 20 | none | 10 attempts, 1 s doubling to 5 min | 10th failure; parks later events of the aggregate (K-11) |
| `outbox.webhook` | 50, at most 4 in flight per merchant host | none global | `webhooks.md` §3 schedule | 24 h after the first attempt |
| `outbox.message` | 10 | 40 per second per provider (below the provider tier, **to confirm**); OTP jobs carry the highest priority | OTP: 3 attempts within 60 s; others: 5 attempts, 15 s, 1 min, 5 min, 15 min | last attempt |
| `outbox.push` | 4 (batches of 100) | 500 per second (Expo publishes about 600 per second per project, **to confirm**) | 3 attempts, 10 s, 30 s, 2 min | last attempt |
| `outbox.channel_publish` | 8, one per connection | per store: Salla and Zid limits **to confirm**; default 1 call per second per store | 1 min, 5 min, 15 min, 1 h, 3 h, 6 h | 24 h; WMS emits `wms.channel_publication.dead` |
| `outbox.carrier_call` | 5 | per Eeasy shipping key, from #885 (**to confirm**); default 5 per second | network or 5xx: 10 s, 30 s, 2 min, 5 min, 15 min; 4xx validation: no retry | 6th failure or first non-retryable error |
| `outbox.storage_lifecycle` | 2 | 10 batch calls per second | 1 min doubling to 1 h, 10 attempts | 10th failure |

Retries add full jitter. A `rate_limited(retry_after_s)` failure from an adapter reschedules at that time without consuming an attempt. An `unauthorised` failure (revoked channel or carrier token) marks the connection `needs_reauth` (§8), parks that connection's rows, and does not burn attempts.

### 4.3 Supersede and staleness

- **Channel publish**: W-18; the projector supersedes the pending row in its own transaction (document 2 §5.3).
- **Messages**: a newer row with the same `supersede_key` supersedes an unsent one (an "assigned" message not yet sent when "out for delivery" is written is dropped). At execution the handler re-reads the order through a Delivery read port and drops the message as `superseded` if the order is no longer in the state the template describes (no "out for delivery" text after delivery). OTP rows older than 4 minutes are superseded, since the code expires at 5 (document 4 §3.2).
- **Push**: an offer push whose offer is no longer `sent` is superseded.
- **Carrier**: a cancel for a generation whose create is still unsent supersedes the create; the package returns to `packed` without a provider call.

### 4.4 Relay

- Single leader by Redis lock (platform §5): `SET outbox:relay:leader <instance> NX PX 10000`, renewed every 3 s; an instance that fails to renew stops relaying before the TTL ends.
- The leader selects due rows (`status = pending`, `next_attempt_at ≤ now`) in batches of 500 with `FOR UPDATE SKIP LOCKED`, applies ordering (a row whose ordering scope has an earlier row not `done` or `dead` waits), marks them `enqueued` and adds jobs with `jobId` = row id, so a double enqueue is a no-op. Postgres `LISTEN/NOTIFY` on commit wakes it; a 1 s poll is the fallback.
- Ordering is enforced by the relay plus consumer parking (document 2 §6.2); it does not depend on BullMQ Pro groups.
- A sweeper re-enqueues rows `enqueued` for more than 5 minutes with no live job (after a Redis loss). Redis is not a source of truth (platform §2): every state that matters is on the row.
- The worker writes the outcome (`done`, retry with `next_attempt_at`, `dead`, `superseded`) and `last_error` (provider status code and a redacted message, never the payload) back to the row; skipped messages (opt-out, budget) are `done` with the skip reason recorded.

### 4.5 Dead letters and alerts

- Platform admin: every dead row is listed and replayable one by one or in bulk through `platform.yaml` `/outbox` and `/channel-publications` (`platform.outbox.read`, `platform.outbox.replay`); replay resets attempts and writes an audit row.
- Merchants see their own dead webhooks (`webhooks.md` §3), dead channel publications (via `wms.channel_publication.dead` and the connection page), and labels that could not be created (the package back at `packed` with the reason, §7).
- Alerts (platform §7) by kind, oldest due row older than: `message` OTP 30 s, other messages 2 min, `push` 1 min, `carrier_call` 2 min, `internal_event` 5 min, `channel_publish` 30 min, `webhook` 30 min, `storage_lifecycle` 6 h. Dead letters page on every dead row of `internal_event`, `message` (OTP), `carrier_call` and `storage_lifecycle`. Dead `webhook` and `channel_publish` rows are failures of merchant endpoints or channel stores that the merchant sees and fixes; they alert by rate (more than 20 per hour across the platform, or every row of one connection dead for 1 hour). This refines platform §7 "any dead-lettered job" and is part of the proposed ADR-0036.

## 5. Messaging

### 5.1 Templates by wave

Every template exists in Arabic and English (ADR-0016) and is chosen by the recipient's `preferred_language`, else the account's default locale. Parameters are never free text from a merchant.

| Wave | Template key | Category | Recipient | Triggered by | Parameters |
|---|---|---|---|---|---|
| 0 | `auth_otp` | authentication (copy-code button) | staff second factor and drivers | document 4 §3 | code, encrypted with the credentials key on the outbox row, which is deleted one hour after sending (data §5.2, §10) (amended 2026-10-31, roadmap A-5) |
| 1 | `order_assigned` | utility | recipient | `delivery.order.assigned` | merchant name, order number |
| 1 | `order_out_for_delivery` | utility | recipient | `delivery.order.out_for_delivery` | merchant name, driver first name, ETA window, tracking link (purpose `track`) |
| 1 | `order_attempted` | utility | recipient | `delivery.order.attempted` | merchant name, reason (localised label), reschedule link from wave 2 |
| 1 | `order_delivered` | utility | recipient | `delivery.order.delivered` | merchant name, order number, COD amount if any |
| 2 | `reschedule_request` | utility | recipient | a dispatcher action or `delivery.order.attempted` | reschedule link (48 h, document 4 §3.5) |
| 2 | `address_pin_request` | utility | recipient | a dispatcher action, or intake with geocode confidence below the account threshold (default 0.6) | pin link (48 h) |
| 2 | `order_rescheduled` | utility | recipient | `delivery.order.rescheduled` | new slot |
| 2 | `cash_block_notice` | utility | the driver's home-site dispatchers who opted in | `delivery.driver.cash_blocked` | driver first name, held amount, since |

Each account chooses which recipient templates are on (default: out for delivery, attempted, delivered). Merchant branding beyond the merchant's name in the text is not available: templates are platform-level, approved once.

### 5.2 Approval

Templates are submitted under the Eeasy business that eeasynew already verified with Meta, on **this product's own phone number** and display name (owner ruling 2026-11-01, Q-27), so business verification is not repeated and the two products do not share a number's quality rating. Preferred: a separate WhatsApp Business account under that verified business, which keeps our template namespace apart. If the provider puts the new number in eeasynew's WhatsApp Business account instead, every template name carries the `elx_` prefix so the shared namespace cannot collide. Whether Meta's messaging limits are counted per number or per business is **to confirm** with the provider. Meta states review takes up to 24 hours (confirmed 2026-10-31, `docs/research/provider-facts-2026-10.md`); re-categorisation of a utility template as marketing is not stated publicly (**to confirm** current policy with the provider). Rule: submit a wave's templates when its order starts and no later than three weeks before its exit; a wave does not exit on a template still pending. Template text lives in `packages/i18n` with the template key, so review comments change one file.

### 5.3 SMS fallback

Not in waves 0 to 2 (ADR-0037). `MessageSender` keeps a second adapter slot; a recipient whose number has no WhatsApp gets no message and the order still moves. OTP has no fallback either: a driver or staff member without WhatsApp cannot receive a code in waves 0 to 2; any alternative sign-in path belongs to document 4 and is not created here. The roadmap may schedule SMS for wave 3 or later on evidence of undelivered rates.

### 5.4 Rates and quiet hours

- Per order: at most 6 recipient messages; per recipient phone and account: at most 10 a day.
- Quiet hours 22:00 to 08:00 Asia/Riyadh for messages a person did not trigger in that moment (`reschedule_request`, `address_pin_request` from intake); they wait until 08:00 and pass the staleness check (§4.3) before sending. Messages that describe a delivery happening now (out for delivery, attempted, delivered) and OTP are never delayed.

### 5.5 Opt-out

A recipient opts out by the template's quick-reply button or by replying a stop word (`STOP`, `إيقاف`, `الغاء`). The kernel stores `(account_id, phone)` in an opt-out list; later recipient messages for that pair are skipped (`done`, reason `opted_out`). Opt-out never blocks OTP for a driver or staff member, and the merchant sees "messages off" on the order. A reply of `START` or `اشتراك` reverses it. Provider-side blocks reported in status callbacks are treated the same way.

### 5.6 Cost control per account

- Account limit `messages_per_month` (document 2 §2.1 limits and usage counters), set by the provisioning door; the usage counter increments when a row is sent.
- At 80 % the owner gets an in-app notice; at 100 % recipient messages are skipped with reason `budget` and the owner sees it; OTP is counted but never blocked.
- Estimate at the first-customer profile (500 orders a day, three recipient messages per order on average): about 45,000 utility messages a month. Meta's per-message price for Saudi utility templates is in the order of USD 0.01 before any provider margin (**estimate, to confirm** with the chosen provider), so about USD 450 to 700 a month; this number belongs in the D6 pricing decision (foundation plan §8).

## 6. Geo and routing

### 6.1 Hudhud provisioning

One platform B2B key per environment class: one for `staging`, one for `production`; `local` and `ci` use stubs. The key, quota and price per call are open question 2. The adapter sends no account ids or recipient names to Hudhud: geocoding sends address text and city; the matrix sends coordinates only.

### 6.2 Geocode at intake

1. If the order has a National Address short code, `lookupShortCode` answers first; a hit sets `point`, `pin_source = geocoded`, confidence 1.0.
2. Else `geocode(text, city)`; the result's confidence is stored as `geocode_confidence` with `pin_source = geocoded` (document 2 §3.1).
3. Below the account threshold (default 0.6) or `not_found`: the order is accepted without a reliable point and listed in "needs location"; from wave 2 an `address_pin_request` is sent (§5.1). A recipient pin sets `pin_source = recipient_pin`; a driver correction `driver_pin`; a dispatcher edit `manual`. A higher-trust source is never overwritten by geocoding.
4. Zone resolution (document 2 §3.4) runs on the point; no point means no zone, and the order waits in `pending` per the intake rules (foundation plan §6, wave 1).

Sites geocode the same way when created; the provisioning door confirms the point on a map.

### 6.3 Matrix caching

Per pair, per site and business date (ADR-0010, §2.1). Rung 1 asks only for the pairs of one run, so a re-sequence after a change costs only the new stop's row and column. Hudhud traffic-aware departure times, if offered (**to confirm**), are used from rung 3 only; earlier rungs request the default profile so a day's cache stays valid.

### 6.4 VROOM problem shape

| Rung | Wave | Vehicles | Jobs | Adds |
|---|---|---|---|---|
| 1 driver stop sequence | 2 | one: the driver's run; `start_index` into the custom matrix pointing at the driver's last ping (or the site; VROOM requires `start_index` when a custom matrix is supplied, confirmed 2026-10-31), `end_index` omitted (open route), `time_window` = shift, `capacity` = vehicle parcels | one per stop (orders at one point grouped), `service` = account setting (default 180 s), `time_windows` from the booked slot, `delivery` = parcel count | custom matrix (`matrices.car.durations`, `distances`) from §2.1; the answer is the stop order and per-stop ETA for the driver app; where the sequence is stored is left to the wave 2 order (contracts §12 point 4) |
| 2 dispatcher planner | 4 | every driver on an active shift who passes D-12; `skills` for vehicle kind; capacities | every accepted, unassigned order of the site and date; `shipments` (pickup and delivery pairs) for `pickup_request` and `return_pickup` | `priority` for late slots; "simulate" shows routes without writing; "commit" creates offers through the normal dispatch path (D-12, D-13), never assignments directly |
| 3 route automation | 4 | as rung 2 | as rung 2, re-solved on triggers (new order, offer declined, shift start) | worker job with 60 s budget; departure-time matrix if available; results still go through offers |

Unassigned jobs from VROOM are shown with the solver's reason; a rung never violates D-11 or D-12 because ineligible drivers are filtered before the problem is built.

### 6.5 Timeouts and fallbacks

| Failure | Behaviour |
|---|---|
| Hudhud matrix slow or down | OSRM container (from wave 2), then straight-line (§2.1); result labelled with its source |
| VROOM slow or down | nearest-neighbour from the start over the same matrix (§2.3) |
| Hudhud geocode down | intake continues without a point (§2.2) |
| OSRM data age | the OSRM image is rebuilt monthly from the Saudi extract; it is a fallback, so freshness is secondary |

OSRM is a new container beside `vroom` in platform §2 from wave 2; until then the straight-line rung is the fallback. Its memory need for a Saudi extract (several GB) is checked when the host is chosen (platform §10 point 1).

### 6.6 Cost estimate per 1,000 orders

Estimate at the first-customer profile, units only until the Hudhud quote exists (open question 2):

| Unit | Per 1,000 orders | Basis |
|---|---|---|
| geocode calls | about 700 | one per order, minus 30 % cache hits and short-code hits (assumed) |
| short-code lookups | about 300 | share of orders with a code (assumed) |
| matrix elements | about 80,000 | runs of 25 stops (676 elements each), 40 runs, three re-sequences each |
| VROOM solves | about 160 | self-hosted, no per-call cost |

## 7. Carrier shipments via Eeasy shipping (ADR-0014)

### 7.1 Sequence at pack time

1. The packer measures the package (W-10); the bench shows carrier cards from `quote` (sync, §2.7) beside the own-fleet card. Prices shown are Eeasy shipping's; this product computes none.
2. Choosing a carrier: in one WMS transaction the package moves `packed → awaiting_label`, `method_generation` increments, and a `carrier_call` outbox row is written (W-12, document 2 §4.14).
3. The worker calls `createShipment` with the idempotency key and the package id as reference.
4. Success: in one WMS transaction the handler stores `eeasy_shipment_id`, `carrier_code`, `awb`; fetches the label and writes it to `acc/{account_id}/labels/{package_id}.pdf`; stores `label_storage_key`; moves the package `awaiting_label → ready`; writes `wms.package.shipment_created` (document 2 §6.3). The bench, polling or on SSE (ADR-0009), shows the print button.
5. The shipment's tracking webhooks are bound to the account's Eeasy key; nothing is subscribed per shipment.

### 7.2 Failure handling

- Retryable failures follow §4.2; the bench shows "requesting label" and the attempt count.
- A non-retryable rejection (validation, unsupported destination, account blocked at Eeasy) or exhausted retries make the row `dead`; the handler then moves the package `awaiting_label → packed` with the method cleared (document 2 §4.14) and stores the reason (provider code mapped to a localised message). The packer chooses again; the next choice is a new generation and a new idempotency key. Document 2 §6.3 has no event for this transition, so no webhook fires and staff see it on the bench and in the package list.
- A lost response (timeout after Eeasy created the shipment) is resolved by the retry: the same idempotency key returns the original shipment, or, if #885 lacks idempotency keys, the handler looks the shipment up by reference before creating.
- Cancel before pickup (W-13): `ready → packed` writes a `carrier_call` cancel row; a cancel Eeasy refuses (already picked up) leaves the package `ready` and alerts staff.

### 7.3 Tracking webhook mapping

The kernel verifies and stores the update and emits `core.carrier_update.received` (§3); WMS consumes it. Eeasy's status vocabulary is defined by #885 (**to confirm**); the mapping is by meaning:

| Eeasy shipping meaning | Package transition (document 2 §4.14) | Stock (W-14) |
|---|---|---|
| shipment created, label printed | none | none |
| picked up by carrier, first scan | `ready → handed_over` | `dock → transit` |
| in transit, out for delivery, failed attempt | none; shown on the package timeline | none |
| delivered | `handed_over → delivered` | `transit → CUSTOMER` |
| returned to shipper | `handed_over → returned`; a Return is expected (W-17) | none until received |
| cancelled by carrier | none; staff alert | none |

An update for an earlier state than the package's current one is stored and ignored. Updates are idempotent per `(eeasy_shipment_id, status, time)` (W-14 consumer receipt).

### 7.4 Labels

The PDF is copied into our storage at creation so a label prints even when Eeasy is down; reads use signed URLs (60 minutes for print); the `label_url` in `wms.package.shipment_created` is such a URL (`webhooks.md` §5.1). Labels are kept one year, then deleted by `storage_lifecycle`.

### 7.5 What this product never does

Carrier pricing, carrier coverage, carrier selection rules, AWB numbering, carrier credentials, carrier pickups scheduling and COD remittance from carriers: all stay in Eeasy shipping (ADR-0001, ADR-0014, W-12).

### 7.6 Credentials

The merchant owner pastes the Eeasy shipping API key in account settings (or a platform admin enters it during provisioning); it is validated by one read call, stored encrypted with key id (platform §3) on a kernel connection row with provider `eeasy_shipping`, shown afterwards only by its prefix, and rotatable with an overlap. The inbound webhook secret for that account is stored the same way. Revocation at Eeasy surfaces as `unauthorised` and the connection becomes `needs_reauth` (§4.2).

### 7.7 Dependencies on eeasynew #885

| Need | Why |
|---|---|
| per-merchant API keys with a sandbox key | §7.6, §9 |
| quote for a package (weight, dimensions, origin, destination) returning carriers, services, price, ETA | carrier cards at the bench |
| create shipment with measured weight and dimensions, COD amount, items, merchant reference; idempotency key support | §7.1, §7.2 |
| label as PDF (sticker sizes 10 × 15 cm and A6 at least) | §7.4 |
| cancel before pickup with a typed refusal | W-13 |
| track by shipment id with status history | reconcile and support |
| signed tracking webhooks per ADR-0040, with event ids, a published status list and retries | §3.2, §7.3 |
| lookup by merchant reference | lost-response recovery |
| documented rate limits and error codes | §4.2 |

Go or no-go for carrier fulfilment in wave 3: **2027-01-15** (proposed; open question 3), the date by which a sandbox key and the endpoints above must exist so W-6 packing can build against them. No-go means wave 3 ships with the own-fleet card only and the carrier cards behind a feature flag in `allowlist` with no accounts (ADR-0006); nothing else in wave 3 waits on #885.

## 8. Channels (Salla, Zid)

### 8.1 Partner apps

One partner app per channel for this product, registered under the platform's partner accounts, separate from eeasynew's apps so tokens, scopes and review cycles do not couple the two products (ADR-0001). Whether Salla allows a second app under the existing partner account, or needs a new partner account, is open question 4 (foundation plan "Not checked"). Scopes (least privilege, §11): orders read, products read and write (quantity only is written), webhooks; nothing for customers, payments or shipping settings.

### 8.2 Install, OAuth and refresh

| Step | Salla | Zid |
|---|---|---|
| Start | the merchant installs from the Salla app store or from our connection page | the merchant starts from our connection page or the Zid app market |
| Authorise | authorisation-code flow, or Salla's "easy mode" where the `app.store.authorize` event delivers tokens to our webhook (**to confirm** which the app uses; easy mode is preferred because it needs no redirect handling) | authorisation-code flow with our redirect URI; the token response carries two credentials sent as two headers on every call (**to confirm**) |
| Map store to account | the install must be claimed: a signed-in owner opens our connection page, which shows a pending install matched by store id and a one-time code shown in the channel app page; an unclaimed install binds nothing and expires in 7 days | the `state` parameter carries a signed (account, user, nonce) value from our connection page, so the account is known at callback |
| Store | tokens encrypted with key id on the kernel connection row; one active connection per (account, provider, store id); a store id already bound to another account is refused with a typed reason |
| Refresh | a scheduled job refreshes tokens at 80 % of their lifetime (Salla access tokens about 14 days with single-use refresh tokens, **to confirm**); a refresh is serialised per connection under a row lock, because a single-use refresh token used twice locks the store out |
| Uninstall | the `app.uninstalled` (or Zid equivalent) webhook sets the connection `disconnected`, deletes tokens, supersedes pending publications |

### 8.3 Order intake

The adapter maps a channel order to the `core.channel_order.received` payload (document 2 §6.3: connection, channel order ref, recipient, address, lines, COD); phones are normalised to E.164, money to halalas, COD is set only when the channel's payment method is cash on delivery, lines carry the channel product ref and SKU. The consumer is chosen by account flags (document 2 §1.1). An order for a status the merchant excluded (for example unpaid bank transfer) is stored as `ignored`. Channel-side updates and cancellations of an already received order have no event in document 2 §6.3; until the domain model adds one, they are stored, shown in the connection's inbound log, and staff act by hand.

### 8.4 Stock publish

`wms.stock.available_changed` drives publications (document 2 §5.3); each publication carries the connection, our product and the mapped channel product ref. The product mapping (our SKU to channel product or variant id) is built at connect time by matching SKUs and is editable on the connection page; an unmapped product is not published and is listed. The value written is `available` (document 2 §4.10), never on-hand. Channel quantities are never read back into the ledger (W-18, ADR-0013).

### 8.5 Webhook subscriptions on the channel side

Salla delivers app events to the app's webhook URL and store events per the app's subscription list, set once on the partner portal. Zid subscriptions are registered per store through its API after install (a `channel_publish` row of the kernel, §4.1), and re-registered by the reconcile job if found missing.

### 8.6 Reconcile

Nightly per connection at 03:00 Asia/Riyadh: `readQuantities` for mapped products, compare with `available`, publish drift (ADR-0013); fetch orders created in the last 48 hours and emit any not yet received (§3.3 re-fetch); check webhook registrations. The run writes a summary on the connection: drift count, missed orders found, errors.

### 8.7 Merchant-visible status

The connection page shows: status (`connected`, `needs_reauth`, `disconnected`, `error`), last order received, last publication sent, publications pending and dead, last reconcile result, unmapped products, and the inbound log with localised reasons. These staff operations (list connections, connect, claim install, map products, reconnect, disconnect) are not yet in the contracts; the wave 4 channel order adds them to `staff.yaml` (§12 notes).

## 9. Environments

| Port | local | ci | staging | production |
|---|---|---|---|---|
| `DistanceMatrix` | straight-line stub | stub; tagged suite with OSRM on a small extract | Hudhud staging key, OSRM | Hudhud, OSRM |
| `Geocoder` | fixture stub | fixture stub | Hudhud staging key | Hudhud (+ SPL if chosen) |
| `RouteOptimizer` | VROOM container | VROOM container | VROOM | VROOM |
| `MessageSender` | `whatsapp-stub` | `whatsapp-stub` | provider sandbox or test number, allowlisted recipient phones only | provider |
| `PushSender` | recorder | recorder | Expo, staging EAS channel | Expo |
| `ObjectStorage` | Silo (MinIO fork) | Silo | provider bucket (staging) | provider bucket |
| `CarrierShipments` | recorded fixtures | recorded fixtures | Eeasy shipping sandbox key | Eeasy shipping |
| `ChannelOrders` / `ChannelStock` | fake store and fixtures | fake store and fixtures | Salla demo store, Zid test store | live stores |
| `MerchantWebhooks` | local receiver | receiver container | real merchant URLs (sandbox accounts) | real |
| Email (staff invites, document 4) | `mail-stub` | `mail-stub` | provider, allowlisted domains | provider |

Rules:

- **Contract tests against recorded responses.** Each adapter has a fixture folder of recorded provider requests and responses (captured from sandboxes, redacted, committed). `ci` runs the adapter against a replay server for those fixtures; a monthly scheduled job, outside the PR checks, re-runs the same calls against the sandboxes and opens an issue on any drift. Inbound fixtures include valid, invalid-signature, replayed and duplicate deliveries for each provider.
- **Outage simulation.** Every stub and the replay server accept a fault header or switch: latency, `5xx`, timeout, `429` with `Retry-After`, `401`. Integration tests cover for each port: breaker opens and the degraded path is taken; outbox rows retry and go `dead` at the stated count; a dead row does not block other aggregates (K-11); supersede drops the stale row.
- Staging never holds production credentials and production never selects a stub: `packages/config` refuses a stub adapter when `APP_ENV=production` (platform §3 startup checks) (amended 2026-10-31, PLAT-4 review).

## 10. Observability per integration

- **Spans** (platform §7): one span per port call, `integration.<port>.<method>`, attributes provider, account id, outcome, HTTP status, retry attempt, outbox row id; linked to the domain event's `correlation_id` (document 2 §7). Bodies are never recorded.
- **Metrics**: `integration_calls_total{port, provider, outcome}`, `integration_latency_ms{port, provider}` (histogram), `integration_breaker_state{port, provider}`, `outbox_due_oldest_age_seconds{kind}`, `outbox_rows{kind, status}`, `outbox_dead_total{kind}`, `inbound_webhooks_total{provider, status}`, `messages_sent_total{template, locale}`, `messages_skipped_total{reason}`, `message_budget_used_ratio{account}`, `channel_publication_drift{connection}`, `geocode_low_confidence_total`, `matrix_cache_hit_ratio`.
- **Alerts**: §4.5 thresholds; breaker open for more than 5 minutes on Hudhud, VROOM, the messaging provider or Eeasy shipping; inbound `rejected` above 20 per hour per provider (forgery or a rotated secret); `unmappable` any; OTP send failure rate (platform §7); channel token refresh failure.
- **Runbooks** (added to platform §9): replay a dead-lettered outbox row (exists); pause messaging (exists); **replay or re-map an inbound webhook**; **rotate a channel token and reconnect a store**; **re-sync channel stock for a connection**; **rotate the Eeasy shipping key for an account**; **switch messaging provider**; **Hudhud outage: confirm fallback**; **restore a deleted object from versioning within 30 days**.

## 11. Security

- **Credential storage and rotation.** Per-account credentials are encrypted with the credentials key and carry its key id (platform §3); the "rotate the credentials key" runbook re-encrypts in the background while both keys decrypt. Platform secrets rotate by redeploy with an overlap where the provider allows two (Hudhud, WhatsApp provider, Expo). Merchant webhook secrets rotate per ADR-0040. Secrets are never logged, never in outbox payloads (the worker loads them by connection id at execution), and never returned by any API after creation.
- **Least privilege per provider.** Storage key limited to one bucket; channel apps request only the scopes in §8.1; the Eeasy key is the merchant's own and limited by Eeasy to that merchant; Expo token limited to the project; the WhatsApp token limited to the business account's messaging.
- **SSRF on merchant URLs** (ADR-0040): `https` only, port 443 by default, DNS resolved by the worker at every delivery and the connection pinned to the checked address; private, loopback, link-local, CGNAT and metadata ranges refused, for IPv4 and IPv6; no redirects followed; response body read at most 64 KB. Provider endpoints are fixed in configuration, never taken from a request.
- **PII minimisation outbound.** Hudhud receives address text or coordinates only; VROOM receives coordinates and ids only; WhatsApp receives the recipient phone and template parameters only; Eeasy shipping receives what a shipment needs (recipient name, phone, address, COD, items); merchant webhooks carry no driver phone or surname (`webhooks.md` §5.1); push payloads carry ids and localisation keys, not addresses (the app fetches details over its authenticated API).
- **Logging redaction.** A shared redactor removes `Authorization`, `X-API-Key`, `X-Manager-Token`, signature headers, tokens in URLs (the Zid path secret), OTP codes, phone numbers (kept as last four digits) and address text from logs, spans and `last_error`. Raw inbound bodies exist only in `core_inbound_webhooks` with their retention (§3.1).
- **Inbound hardening.** Signature before parse; per-provider rate limit on `/hooks/*`; Cloudflare WAF in front (platform §8) with the webhook paths excluded from bot challenges.

## 12. Open questions for the owner

1. **WhatsApp provider.** Ruled 2026-11-01 (Q-27): reuse the WhatsApp setup eeasynew already runs (its verified Meta business and its provider), with a new phone number and our own credentials for this product (§2.4, §5.2). Open: which provider that is (Meta Cloud API direct or a business solution provider), to confirm with eeasynew before PLAT-9 builds its adapter.
2. **Hudhud contract.** Who signs the B2B agreement, the quota, the price per geocode and per matrix element, and whether National Address short-code lookup is included or needs the SPL API. Needed before wave 1 (geocoding at intake).
3. **eeasynew #885 timeline.** Accept the 2027-01-15 go or no-go date for carrier fulfilment in wave 3 (§7.7), and the request that Eeasy shipping signs its webhooks with the ADR-0040 scheme.
4. **Second partner apps.** Register new Salla and Zid partner apps for this product (proposed), which on Salla may need a second partner account; or reuse eeasynew's apps, which couples the two products' review cycles and tokens.
5. **Order status back to the channel.** ADR-0013 makes stock one way; merchants usually also expect the Salla or Zid order to show "shipped" and "delivered" with a tracking link. Should wave 4 write order status back to the channel (a new ADR and a `channel_publish` use), or stay read-only for orders?

Notes for other documents, not owner questions: the platform contract needs inbound webhook listing and re-map operations (§3.3) and the `storage_lifecycle` kind value (§4.1); the staff contract needs channel connection operations (§8.7); document 2 has no event for a channel-side order change (§8.3) or for a carrier request going dead (§7.2); platform §2 gains an `osrm` container from wave 2 (§6.5).
