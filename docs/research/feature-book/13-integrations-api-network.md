# Feature book 13 · Integrations, API and network

- **Date:** 2026-11-02. Every fact was read on 2026-11-02 unless its source line gives another date. Source ids (R1 to R12, PF, HUD, WS, WA, FC-INT, FC-COV, PT-CMP, T-xx, ADR-nnnn) are listed with paths or URLs in the source list at the end.
- **Scope:** the public API and its resource split, API keys, sandbox, rate limits and quotas, versioning, merchant webhooks and their health and reconciliation, the event catalogue, Salla and Zid connectors, Shopify, WooCommerce, Magento, noon and Amazon.sa, ERP connectors, the Eeasy shipping carrier integration, carrier choice and aggregation, maps, geocoding, distance matrix, map tiles, WhatsApp, push, mail, object storage, inbound webhooks and SSRF guards, integrator docs and sandbox accounts.
- **Labels:** [I] = inference by the researcher from the sources named. Everything else is what a source states. "Chosen" means what the repository's accepted ADRs, contracts, orders or the roadmap currently say; it is not a recommendation.
- **Aspect numbering:** each feature carries aspects 1 to 10 as numbered paragraphs, in the order the brief sets. Facts are one line each to keep the chapter within its length cap.
- **Not legal advice.** PDPL and licence readings are what the cited pages say; counsel must read them.

## Summary for the lead

1. The integration surface is designed but mostly unbuilt. Built: geocoder chain and cache (INT-2, PR #105) and push sender (INT-4, PR #93). Everything else in this chapter is planned in waves 1 to 4, deferred (INT-5, INT-6, map tiles) or missing (connectors beyond Salla and Zid, ERP, carrier aggregation).
2. Messaging changed shape. ADR-0041 (proposed, 2026-11-01) replaces the Meta Cloud API template adapter that INT-3 and PLAT-9 leg 2 assumed with the eeasynew WhatsApp engine (Baileys, unofficial). `integrations.md` §2.4 and §5 still describe the Meta model, and roadmap Q-27 still names a Meta provider. This is the largest difference between the current roadmap and the chosen shape.
3. Webhook signing is accepted (ADR-0040, Standard Webhooks v1). Health states, a warning tier and a no-discard rule for disabled subscriptions are not in INT-10; they are proposals in the platform comparison, not adopted.
4. Salla and Zid facts were confirmed on 2026-10-31 for token lifetimes and webhook signing. Zid's webhook secret travels as HTTP Basic Auth, not a query token; Salla's signature has no timestamp, so replay defence is dedupe plus fetch.
5. Carrier choice at pack is a manual choice from one list (ADR-0014). Rule-based carrier choice (INT-16) and channel buffers (INT-12) and status-mapping gates (INT-11) are market proposals with no roadmap row.
6. Carrier aggregation is not decided. The census cites ADR-0005 (own fleets), but ADR-0005 governs the Eeasy-operated executor fleet; the binding rules for third-party carriers are ADR-0014 and ADR-0001.
7. Google and HERE are not planned adapters. ADR-0010 calls Google optional; eeasynew already runs HERE behind its own key, which INT-2 declines to build.
8. Ten repository discrepancies are listed in the section "Discrepancies found in the repository"; D1 must be settled before PLAT-9 leg 2 and INT-3, and D3 and D4 before INT-11.
9. Owner questions that block build: Q-28 (Hudhud terms), Q-29 (#885 date and webhook scheme), Q-34 (channel write-back), and the four provisional defaults of ADR-0041 (the Q-27 row still names Meta).
10. Sandbox, quota metering and channel status vocabulary have no decided shape; they are listed as unanswered.

## Method and limits

- Read: `docs/architecture/integrations.md` (all), the contracts README §1 to §9, `webhooks.md`, `public.yaml`, the inbound and channel operations of `platform.yaml` and `staff.yaml`, ADR-0001, 0005, 0010, 0013, 0014, 0024, 0027, 0030, 0036, 0037, 0040, 0041, the §2 of INT-2, INT-4, PLAT-9 plans, roadmap rows and questions, the four in-repo research notes, the feature-coverage census (integrations rows), the platform comparison and six teardown notes (ShipHero, Logestechs, Omniful, Anchanto, Torod, Wasal).
- Not read: Shipsy, Safee and Fulfillor teardowns (no integration rows used); the Eeasy shipping (#885) contract (not in the repository); the Salla and Zid live docs beyond what the provider-facts note records.
- No new web search was run; the census and provider-facts notes carry the public-page reads and their confidence marks.

## Features

### 13.1 Public API and resource split

1. **Definition and goal.** Integrators create and track deliveries and read WMS data through one API key; no UI is needed.
2. **Workflow.** Key → `POST /orders` (Idempotency-Key, 201; `source_ref` unique per account while open) → `GET /orders/{id}/tracking` or webhooks; `POST /orders/{id}/cancel` only before pickup (409 `invalid_transition` otherwise) [R4, R3].
3. **Rules and edges.** Account comes from the key, never a parameter (ADR-0025). Outside coverage the order stays `pending` with `pending_reason` (D-3). Label batches capped at 100. WMS paths (`/products`, `/stock-summaries`, `/fulfilment-orders`) are `x-availability: after-wms-pilot` (Q-14 default) [R4, R2].
4. **Data.** Orders, tracking tokens, proofs, labels (under the account's storage prefix), key rows in `core_api_keys` [R7, R1 §7.4].
5. **Surfaces.** `/v1/public` (orders, reference, coverage, tracking, labels, proofs, webhook subscriptions, WMS); console and web use the staff surface instead [R4, R2 §1].
6. **Permissions.** `delivery.orders.read|create|cancel`, `delivery.proofs.read`, `core.webhooks.manage`; WMS scopes after the pilot. Keys never hold driver or platform permissions [R2 §11, R7].
7. **Dependencies.** DEL-2 (orders), DEL-8 (tracking token), outbox for webhooks, cursor pagination (ADR-0029) [R9, R2 §3].
8. **Metrics.** Requests per key per day (`core_api_key_usage`); no latency or error SLO is defined for the public surface [R7].
9. **Market and chosen shape.** Logestechs uses one key per customer account [T-LG §3.2]; ShipHero is GraphQL with a 28-day token [T-SH §3.2]; Torod splits order, shipment and warehouse resources [T-TO §3]. Chosen: REST, `/v1`, account from key, orders and tracking as resources, shipments and warehouses not exposed. Proposed but not adopted: a read surface for routes and stops (PT-CMP §4, INT-9).
10. **Roadmap.** Planned: INT-9, wave 4, depends on DEL-2, DEL-8, Q-13, Q-14 (both provisional defaults). Owner: Q-13, Q-14.

### 13.2 API keys: issue, rotate, revoke

1. **Definition and goal.** An owner or admin issues a key to an integrator, rotates it without downtime, or revokes it.
2. **Workflow.** `POST /api-keys` (staff, wave 4) → secret shown once → `POST /api-keys/{id}/rotate` (old key valid for the overlap) → `DELETE /api-keys/{id}` (revoke). A revoked or expired-overlap key returns `401 api_key_revoked` [R6, R2 §1].
3. **Rules and edges.** Keys are per account, hashed (SHA-256) with a public prefix, scoped to a permission subset; a create replay returns `409 secret_already_issued` and never the secret [R7, R8 §4, R2 §3]. A key may hold only the scopes listed for API keys [R2 §11; document 4 §3.4].
4. **Data.** `core_api_keys`: `name`, `prefix` (unique), `secret_hash bytea`, `scopes text[]`, `expires_at` (rotation overlap), `revoked_at`, `last_used_at`, `created_by` [R7].
5. **Surfaces.** Staff screens WEB-16 (wave 4); no key endpoints on the public surface [R4 tags, R1 §8].
6. **Permissions and audit.** `core.api_keys.manage` (owner and admin); audit row per create, rotate and revoke with actor type `user` [R2 §11, R7 `core_audit_log`].
7. **Dependencies.** Idempotency store (secret stripped before storage), rate limiter keyed by key id [R2 §3, R8 §8].
8. **Metrics.** Requests and last-used per key per day; no count of revoked-key rejections is defined [R7].
9. **Market and chosen shape.** Logestechs issues one `X-API-Key` per customer, shown once, regenerate only, no portal login [T-LG §3.2]; ShipHero exchanges a username and password for a token and has no API key [T-SH §3.2]. Chosen: static `X-API-Key` with hashed storage and overlap rotation, which keeps Logestechs' one-time reveal and adds the overlap (Q-13 provisional).
10. **Roadmap.** Planned: INT-9, wave 4; screens WEB-16. Owner: Q-13 (static key, provisional).

### 13.3 Sandbox keys

1. **Definition and goal.** Integrators test against data that never touches live orders or stock.
2. **Workflow.** Not designed in the contracts. The roadmap names "sandbox keys" in INT-9 and "sandbox accounts on staging" in OPS-7 [R9].
3. **Rules and edges.** Staging never holds production credentials; sandbox merchant webhooks go to real merchant URLs of sandbox accounts [R1 §9]. Eeasy shipping's sandbox key is requested from #885 [R1 §7.7]. Channel sandboxes are a Salla demo store and a Zid test store [R1 §9]. KSA stores have no public sandbox read.
4. **Data.** No sandbox flag or environment column appears in `data.md` or `identity-and-tenancy.md` [R7, R8] [I: sandbox is an environment, not a key attribute, in the current docs].
5. **Surfaces.** Staging only; OPS-7 onboarding runbook [R9].
6. **Permissions.** Not specified; presumably `core.api_keys.manage` [I].
7. **Dependencies.** OPS-1 staging host (waits on the owner's go), PLAT-2 native stack [R9 §0].
8. **Metrics.** None defined.
9. **Market and chosen shape.** OTO gives integrators a sandbox account with its own token [FC-INT S13]; ShipHero has no public sandbox and an experimental endpoint on request [T-SH §3.8]; Logestechs documents no sandbox base URL [T-LG §3.1]. Chosen: a staging environment with sandbox accounts (OPS-7). Whether sandbox is an account or an environment is unanswered.
10. **Roadmap.** Partial: named in INT-9 and OPS-7 (wave 4), not ordered as its own row. Owner: none registered.

### 13.4 Rate limits and quotas

1. **Definition and goal.** Protect the platform and merchants from runaway integrations; keep plan quotas separate.
2. **Workflow.** Request → budget check in Redis keyed by identity, then IP → on excess `429 rate_limited` with `Retry-After`; every response carries `RateLimit-Limit`, `-Remaining`, `-Reset` [R2 §7].
3. **Rules and edges.** Public keys 600 per minute, burst 100; order create 120 per minute; subscription create and URL change 5 per hour per account; staff 600 per minute per user; all are proposed defaults the platform can adjust per account [R2 §7]. No API-call quota exists; `core_usage_counters` covers orders, drivers, sites and api_keys only [R7]. Messages have a monthly cap (ADR-0037) [R1 §5.6]. Salla and Zid platform limits were not read [R1 §4.2 "to confirm"].
4. **Data.** `core_usage_counters` (metric check list above); `core_api_key_usage`; Redis budgets (no table).
5. **Surfaces.** Response headers and error body; the platform adjusts limits per account through the platform door [R2 §7].
6. **Permissions.** `platform.*` to adjust; no merchant screen for quotas (BILL-1 missing) [FC-COV §1].
7. **Dependencies.** PLAT-6 request frame with named route budgets [R12 §1]; Redis.
8. **Metrics.** No rate-limit counter is named in `integrations.md` §10 [R1 §10] .
9. **Market and chosen shape.** ShipHero: 4,004 credits restored at 60 per second, 7,000 requests per five minutes, HTTP 429 with no body, and an `analyze` flag that prices a query without running it [T-SH §3.3]. Logestechs and Wasal publish no limits [T-LG §3.2, T-WA §3.2]. Chosen: request budgets, no credit currency. Proposed (PT-CMP §4): per-key request budget with usage counters, no credits.
10. **Roadmap.** Partial: budgets in contracts (PLAT-6), per-key usage in INT-9; plan quotas missing (BILL-1, proposed). Owner: Q-33 (pricing, provisional).

### 13.5 Versioning

1. **Definition and goal.** Integrators keep working across releases; breaking changes are announced and run side by side.
2. **Workflow.** Additive changes stay in `/v1`; a breaking change adds `/v2` beside `/v1`; both served for one wave, then `/v1` is removed with a release note [R2 §2].
3. **Rules and edges.** Clients ignore unknown fields; enums marked `x-extensible-enum` read unknown values as "other" [R2 §2]. Webhook payloads follow the event envelope `version` (ADR-0027): additive keeps it, breaking bumps it and the old version is emitted for one wave. All 22 catalogue events are version 1 today [R3 §1, R3 §5].
4. **Data.** `version` integer on each outbox event (`core_outbox.event_version`) [R7].
5. **Surfaces.** Path `/v1`; `GET /webhook-event-types` lists versions [R4].
6. **Permissions.** None.
7. **Dependencies.** Contract CI: `redocly lint`, generated types, contract tests that fail on undocumented fields [R2 §9].
8. **Metrics.** None defined.
9. **Market and chosen shape.** ShipHero publishes dated changes and deprecations with no breaking-change policy [T-SH §3.7]; Wasal publishes a versioning policy and a deprecation window, but its docs and live host disagree [T-WA §3.4]. Chosen: ADR-0027 and contracts §2. Trade-off named by ADR-0027: two emitted versions cost storage and relay throughput.
10. **Roadmap.** Covered by contract rules (ARCH-1, merged); ADR-0027 is proposed and must be accepted by PLAT-8 (wave 0) [R9 §4].

### 13.6 Merchant webhooks and Standard Webhooks signing

1. **Definition and goal.** Push the 22 catalogue events to a merchant URL, signed so the merchant verifies with the official library for their language.
2. **Workflow.** Subscribe (`pending_verification`) → we send one signed `webhook.verification` with a one-time token → merchant calls `verify` → `active` → events via outbox kind `webhook`, one in flight per subscription and aggregate, in `sequence` order → 2xx within 10 s acknowledges [R3 §2 to §4, R1 §4.1].
3. **Rules and edges.** Headers `webhook-id` (envelope id), `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256 of "id.ts.body">`; secret `whsec_` + base64 of 32 random bytes, shown once; rotation signs with both for 24 h; receivers reject timestamps over 300 s [R3 §2, ADR-0040 §1 to §2]. `https` on port 443 only. `410` disables at once; `Retry-After` honoured on 429 and 503 [ADR-0040 §4]. The Standard Webhooks spec recommends a 15 to 30 s timeout against our 10 s [WS §1.1]. `v1a` (Ed25519) is not offered [ADR-0040 §3].
4. **Data.** `core_webhook_subscriptions` (url, `event_types`, status, `secret_ciphertext` with key id, previous secret with 24 h expiry, `verification_token_hash`); `core_webhook_deliveries` (envelope kept for redelivery; `test` flag) kept 30 days [R7].
5. **Surfaces.** Same operations on `/v1/public` and `/v1/staff`; web screens WEB-16 [R4, R6, R9].
6. **Permissions and audit.** `core.webhooks.manage`; each event type needs the creator's read scope, checked at create, update and every delivery, else `403 forbidden` with `details.missing_scope` [R3 §4]. Subscriptions pause when the creator loses a scope [R3 §4].
7. **Dependencies.** Outbox kind `webhook`, queue `outbox.webhook` (concurrency 50, at most 4 in flight per merchant host) [R1 §4.2]; SSRF guard (13.26); `MerchantWebhooks` port [R1 §2.10].
8. **Metrics.** `outbox_rows{kind,status}`, `outbox_dead_total{kind}`; test deliveries are excluded from statistics [R1 §10, R4].
9. **Market and chosen shape.** Logestechs sends a static password in five headers, no signature, no retries [T-LG §3.3]; Wasal signs the body only, with no timestamp, and its sample compares with plain equality [T-WA §3.4]; ShipHero signs the body with base64 HMAC and retries up to five times [T-SH §3.6]. Chosen: Standard Webhooks v1 (ADR-0040 accepted 2026-11-01; supersedes ADR-0030) because merchants verify with official libraries; the verification token and ordering stay ours.
10. **Roadmap.** Planned: INT-10, wave 4, with a conformance test against the official libraries; depends on INT-9, PLAT-8, Q-35. Q-43 ruled. Owner: Q-35 (30-day log, provisional).

### 13.7 Webhook health, retries, redelivery and reconciliation

1. **Definition and goal.** Merchants see failing endpoints and recover missed events; we keep an ordered, at-least-once stream.
2. **Workflow.** Attempts follow 30 s, 2 min, 10 min, 30 min, 1 h, 2 h, 4 h, then every 4 h until 24 h after the first attempt; then `dead`. A subscription whose deliveries are all dead for 72 h becomes `disabled` and the owner is told [R3 §3]. Redeliver any one delivery, including dead ones, `202` [R4].
3. **Rules and edges.** Suspended accounts pause deliveries and resume on reactivation [R3 §3]. A gap in `sequence` shows a dead delivery to the receiver. Reconciliation for orders is an `updated_from` filter on `GET /orders`; channel reconciliation is nightly (13.10). No webhook health tier (healthy, warning) exists in our docs [R3, R1 §4].
4. **Data.** `core_webhook_deliveries` (`status` pending, delivered, retrying, dead; `attempts`; `next_attempt_at`; `last_status_code`; `last_error` as a fixed class, never the response body) [R7, R3 §4].
5. **Surfaces.** Merchant: `GET …/deliveries?status=dead`, `redeliver` [R4, R6]. Platform: outbox rows of kind `webhook` [R5 `/outbox`].
6. **Permissions and audit.** `core.webhooks.manage`; platform `platform.outbox.replay` with audit row [R5].
7. **Dependencies.** Outbox worker queue and dead-letter view (PLAT-8); owner notification (mail or in-app) [R1 §4.5].
8. **Metrics.** `outbox_due_oldest_age_seconds{kind=webhook}`; platform alert when more than 20 webhook rows die per hour across the platform [R1 §4.5]; no per-merchant health metric.
9. **Market and chosen shape.** ShipHero moves an endpoint from HEALTHY to WARNING (email, at most daily) to UNHEALTHY (auto-disabled; only ShipHero reinstates it), discards events while disabled, and offers a reconcile by `updated_at_min` [T-SH §3.6]. Chosen: the 72-hour disable and 410 disable only; no warning tier. Proposed but not adopted: a warning state, no silent discard, and an updated-since reconciliation for INT-10 (PT-CMP §4).
10. **Roadmap.** Partial: retries and redeliver in INT-10; list filter in INT-9; health tier missing. Owner: Q-35.

### 13.8 Event catalogue and samples

1. **Definition and goal.** Integrators see every event type, its version, its Arabic and English description and a sample envelope, and can send a signed sample to their URL.
2. **Workflow.** `GET /webhook-event-types` → web samples page → `POST …/test-deliveries` sends a signed sample marked `"test": true`, ignoring filters and the ordering queue [R3 §4, R4].
3. **Rules and edges.** The 22 events are the domain rows marked webhook-yes; kernel events, offers, handovers, liability, deposits, cash blocks, shifts, movements, counts and channel failures are excluded [R3 §5]. Created events carry recipient name and phone for the subscriber's scope; no driver phone or surname leaves the system [R3 §5.1]. Channel-side order edits and cancellations have no event [R1 §8.3].
4. **Data.** Envelope fields `id, type, version, occurred_at, account_id, aggregate_type, aggregate_id, sequence, causation_id, correlation_id, payload` [R3 §1].
5. **Surfaces.** `public.yaml` `webhooks` section, samples page (WEB-16), docs (OPS-7) [R4, R9].
6. **Permissions.** Per-type read scope (section 13.6) [R3 §4].
7. **Dependencies.** Domain model §6.3 (document 2, not in this chapter's inputs) and ADR-0027 [R1 §3.1].
8. **Metrics.** None per event type.
9. **Market and chosen shape.** Wasal publishes seven event types with a versioned sample [T-WA §3.4]; ShipHero lists 20 topics [T-SH §3.6]; Logestechs puts a driver phone and a delivery PIN in its status payload [T-LG §3.3]. Chosen: 22 typed events, no PII beyond the recipient's name and phone, and no PIN. Proposed (T-LG §6, not adopted): a test that fails if a payload carries a phone number or PIN.
10. **Roadmap.** Planned: INT-10 (catalogue and tests), OPS-7 (docs). No open question.

### 13.9 Salla and Zid install, OAuth and token refresh

1. **Definition and goal.** Connect a merchant's Salla or Zid store to one account so orders arrive and stock is published.
2. **Workflow.** Start from our connection page or the store's app market → authorise (Salla Easy Mode delivers tokens to our webhook through `app.store.authorize`, the provider's recommendation; Zid code flow with a signed `state`) → claim: a signed-in owner matches a pending install by store id and a one-time code, unclaimed installs expire in 7 days → tokens stored → Zid webhooks registered per store → scheduled refresh → uninstall event → disconnected [R1 §8.2; PF §2, §5].
3. **Rules and edges.** Salla access tokens last 14 days; refresh tokens are single-use, valid one month, and reusing one invalidates the access token (confirmed 2026-10-31) [PF §2]. Zid authorisation codes last 10 minutes and are single-use; every call sends `Authorization` and `X-Manager-Token`; new tokens last 3 years, tokens issued before mid-2025 last 1 year; refresh tokens last 1 year and a refresh revokes the old one, so lifetimes are read from each response [PF §4]. Zid's uninstall event is `app.market.application.uninstall` [PF §5]. Zid logistics apps must be public and reviewed; private apps need a Professional or Enterprise plan or API access [FC-INT S7]. A Salla second partner account may be needed [R9 R-8].
4. **Data.** `core_channel_connections`: `channel` (salla, zid), `external_store_id`, `status`, `credentials_ciphertext`, `credentials_key_id`, `webhook_secret_ciphertext`; one active connection per store [R7]. Status values differ between documents (discrepancy D4).
5. **Surfaces.** Connection page (WEB-17, wave 4); staff `/channel-connections` (list and create marked wave 3, reauthorise and resync wave 4); inbound paths `/hooks/salla` and `/hooks/zid/{connection_id}` [R6, R1 §3.2].
6. **Permissions and audit.** `core.channels.manage`. The OAuth `state` is a single-use nonce bound to account, member and connection, valid 10 minutes; a store already connected elsewhere is refused with `store_already_connected` [R2 §1, R1 §8.2].
7. **Dependencies.** Kernel `ChannelOrders` port; outbox kind `channel_publish` for webhook registration; partner app client secrets in platform config [R1 §2.8, §4.1].
8. **Metrics.** Connection status and channel token-refresh failure alert; no refresh-success metric [R1 §10].
9. **Market and chosen shape.** Omniful's Zid setup needs an activation code, inventory sync and automatic dispatch enabled in Zid, and hub mapping before activation [T-OM §3.2]; Anchanto, Logestechs and Torod also connect both stores [T-AN §3.5, T-LG §1.8, T-TO §1]. Chosen: partner apps separate from eeasynew (ADR-0001), claim before bind, refresh serialised per connection under a row lock because a reused single-use token locks the store out [R1 §8.2, PF §2].
10. **Roadmap.** Planned: INT-11, wave 4; depends on DEL-2, Q-30, Q-34. Owner: Q-30 (new partner apps, provisional); risk R-8.

### 13.10 Channel order intake and reconcile

1. **Definition and goal.** Salla and Zid orders become delivery orders (source `channel`) without re-keying.
2. **Workflow.** Store webhook → verify (Salla: HMAC over the body; Zid: per-connection Basic secret, then fetch the order by id before acting) → raw row stored → adapter maps to `core.channel_order.received` → DEL-2 intake under the account's flag. Nightly reconcile at 03:00 Asia/Riyadh: fetch orders created in the last 48 hours not yet received; check webhook registrations [R1 §3.1, §3.2, §8.3, §8.6].
3. **Rules and edges.** Phones E.164; money in halalas; COD only when the store's payment method is cash on delivery; an excluded status (for example unpaid bank transfer) is stored as `ignored` [R1 §8.3]. Channel-side edits and cancellations of a received order are stored and shown, but emit no event, so staff act by hand [R1 §8.3]. Salla's signature has no timestamp, so dedupe is on event id plus body hash [R1 §3.2, PF §1].
4. **Data.** `core_inbound_webhooks`: `source` (salla, zid, eeasy_shipping, whatsapp), raw payload kept 30 days, metadata one year [R7, R1 §3.1]. The dedupe key differs between documents (discrepancy D5).
5. **Surfaces.** Connection inbound log with localised reasons (WEB-17); platform list, get, remap and refetch [R5 `/inbound-webhooks`, `/accounts/{id}/inbound-webhooks/refetch`].
6. **Permissions and audit.** `core.channels.manage` for the merchant; platform `platform.outbox.read` and `platform.outbox.replay`; raw bodies need `platform.inbound.raw_read` and write an audit row [R5].
7. **Dependencies.** DEL-2; geocoder (13.19) for the address; outbox.
8. **Metrics.** `inbound_webhooks_total{provider,status}`; any `unmappable` row alerts; the reconcile summary (drift, missed orders found, errors) is written per connection [R1 §8.6, §10].
9. **Market and chosen shape.** Omniful sets order-sync direction per connection (webhook for the primary app only) and says unmapped statuses stop orders syncing [T-OM §3.2]; Torod's store sync is a manual button [T-TO §3]. Chosen: webhook, scheduled reconcile and platform refetch. Proposed (PT-CMP §2): an updated-since read for reconciliation.
10. **Roadmap.** Planned: INT-11, wave 4. Gap: channel-side edits and cancellations have no domain event, so no merchant webhook carries them. Owner: Q-34 (write-back, default read-only).

### 13.11 Status mapping, failed log and manual re-sync

1. **Definition and goal.** Before the first sync the merchant confirms how store values map to ours; failed sync rows are visible and can be re-run.
2. **Workflow.** Connect → SKU-to-product mapping at connect, editable on the connection page; unmapped products are not published and are listed [R1 §8.4] → status mapping: not specified in our docs → failed rows shown with a localised reason → merchant re-syncs stock (`resyncChannelStock`, wave 4) → platform refetch or replay [R6, R5].
3. **Rules and edges.** Our docs gate product mapping only. A merchant-side re-fetch of an order is not in `staff.yaml`; only the platform console can refetch [R6, R5].
4. **Data.** `core_inbound_webhooks.status` (`emitted`, `ignored`, `duplicate`, `rejected`, `unmappable`); `wms_channel_publications.status` (`pending`, `sent`, `failed`, `dead`, `superseded`) with `last_error` [R7]. No status-mapping table exists.
5. **Surfaces.** Connection page (WEB-17); staff `POST /channel-connections/{connection_id}/resync-stock` (wave 4) [R6].
6. **Permissions and audit.** `core.channels.manage`; `wms.channel_publications.read`; platform replay permissions [R2 §11, R5].
7. **Dependencies.** PLAT-8 dead letters; `ChannelStock` port.
8. **Metrics.** `channel_publication_drift{connection}`; `outbox_dead_total{kind=channel_publish}`; a rate rule pages when a whole connection is dead for an hour [R1 §4.5, §10].
9. **Market and chosen shape.** Omniful maps Zid hubs and statuses before activation and offers Failed Logs with Manual Sync on Noon [T-OM §3.2]; the platform comparison lists this as a cross-platform pattern (PT-CMP §2). Chosen: product mapping and dead letters. Proposed, not adopted: status and warehouse mapping before the first sync, and a failed-log view with manual re-sync in INT-11 (PT-CMP §4).
10. **Roadmap.** Partial: inbound log and dead letters in INT-11 and INT-12; status-mapping gate missing. Owner: none registered.

### 13.12 Stock publication and buffers

1. **Definition and goal.** Publish the warehouse's available quantity to each mapped channel product, one way.
2. **Workflow.** `wms.stock.available_changed` → projector writes `wms_channel_publications` (a newer pending row supersedes an unsent one) → `channel_publish` queue, one in flight per connection → `setQuantity` (a set, so a retry is harmless) → retries at 1, 5, 15 min, 1, 3, 6 h → dead after 24 h → `wms.channel_publication.dead` [R1 §2.8, §4.2; R3 §5].
3. **Rules and edges.** The value is `available`, never on-hand; channel quantities are never read back into the ledger; a channel-side edit is overwritten and the UI says so; a channel outage never blocks a warehouse operation [R1 §8.4; ADR-0013]. The stores' own rate limits are "to confirm" [R1 §4.2].
4. **Data.** `wms_channel_publications`: `connection_id`, `product_id`, `quantity`, `status`, `attempts`, `next_attempt_at`, `superseded_by`, `channel_response`, `last_error`, `version` [R7].
5. **Surfaces.** Connection page (WEB-17); platform `/channel-publications` list and replay (wave 4) [R5]; staff-wms `/channel-publications` [R6].
6. **Permissions and audit.** `wms.channel_publications.read`; `core.channels.manage`; platform replay [R2 §11].
7. **Dependencies.** `ChannelStock` port; product mapping (13.11); nightly drift reconcile; outbox.
8. **Metrics.** Drift per connection; queue age and dead count (13.11).
9. **Market and chosen shape.** Anchanto proposes a per-channel buffer applied at publish (T-AN §6 P3); its Salla and Zid inventory directions conflict in its notes [T-AN §3.5]; ShipHero bulk inventory is CSV, replace-only [T-SH §3.9]. Chosen: one way, available only, no buffer. Proposed, not adopted: a per-channel buffer in INT-12.
10. **Roadmap.** Planned: INT-12, wave 4; depends on INT-11, WMS-3, Q-36. Buffer missing. Owner: Q-36 (content of WMS-W7 and WMS-W8).

### 13.13 Tracking push-back

1. **Definition and goal.** Write fulfilment progress (shipped, AWB, tracking link, delivered) back to the channel order.
2. **Workflow.** Not designed. Q-34 asks whether wave 4 writes order status back.
3. **Rules and edges.** Stock is one way (ADR-0013); a status write-back needs a new ADR and a `channel_publish` use [R9 Q-34, R1 §12 point 5]. Omniful pushes shipment and tracking back to Zid but no return status, because Zid has no return-status API [T-OM §3.2]; Anchanto syncs AWB and tracking to channels [T-AN §3.5].
4. **Data.** None designed.
5. **Surfaces.** None designed. The tracking link exists only in our API and on the recipient page [R4].
6. **Permissions and audit.** None designed.
7. **Dependencies.** Outbox kind `channel_publish`; `ChannelOrders` port.
8. **Metrics.** None designed.
9. **Market and chosen shape.** Omniful and Anchanto push AWB and status back; ours is read-only for orders (Q-34 default). Trade-off named in the integrations document: merchants usually expect "shipped" and a tracking link on the store order.
10. **Roadmap.** Missing; Q-34 default read-only (provisional). Owner: Q-34.

### 13.14 Shopify, WooCommerce, Magento, noon and Amazon.sa

1. **Definition and goal.** Connectors for merchants on other storefronts and for two KSA marketplaces.
2. **Workflow.** Not designed. Market: Shopify app install with OAuth and webhooks; WooCommerce REST keys per user; noon partner fulfilment APIs with an API user; Amazon SP-API restricted operations (shipping labels) need a restricted data token valid one hour [FC-INT §2, S25].
3. **Rules and edges.** Shopify apps pay Shopify's recurring and usage charges and a revenue share [FC-INT S18]; WooCommerce's OAuth 1.0a runs over HTTP [FC-INT §2]; noon commission (4 to 27 percent) is third-party and unverified; Amazon.sa is not confirmed as an SP-API region; Magento was not researched [FC-INT §2]. Storefront apps request broad data scopes (T-AN §3.5, T-TO §3); our rule is least privilege [R1 §8.1].
4. **Data.** None designed; `core_channel_connections.channel` allows only `salla` and `zid` [R7].
5. **Surfaces.** None designed.
6. **Permissions and audit.** None designed.
7. **Dependencies.** CONN-1 needs INT-9, INT-10, INT-11; CONN-2 needs INT-11 and INT-12 [FC-INT proposed orders 8 and 9].
8. **Metrics.** None designed.
9. **Market and chosen shape.** Logestechs connects WooCommerce, Shopify and Magento [T-LG §1.8]; Omniful documents Zid, noon, Shopify, Amazon and Trendyol [T-OM §2.7]; Torod connects Shopify, WooCommerce and Magento [T-TO §1]. Chosen: Salla and Zid only (INT-11). Proposed, not adopted: CONN-1 and CONN-2 on the INT-11 pattern, after an owner ruling.
10. **Roadmap.** Missing. CONN-1 (wave 4 or 5) and CONN-2 (wave 5 or later) are proposals in the feature census, not roadmap rows. Owner: not in the register; FC-INT Unanswered 13.

### 13.15 ERP connectors

1. **Definition and goal.** Two-way sync of orders, stock and invoices with an ERP.
2. **Workflow.** Not designed.
3. **Rules and edges.** Market names Odoo (Logestechs), Xero, SAP and Oracle (Anchanto), and a third-party guide naming `order.*` and `purchase.*` events (Omniful, unverified) [T-LG §1.8, T-AN §3.5, T-OM §3.4]. Invoices bring VAT and ZATCA questions the roadmap does not cover [FC-COV §2]; accounting is outside ADR-0002 scope [T-LG §5].
4. **Data.** None designed.
5. **Surfaces.** None designed.
6. **Permissions and audit.** None designed.
7. **Dependencies.** Would need the public webhooks (13.6) or a channel-style port; not designed.
8. **Metrics.** None designed.
9. **Market and chosen shape.** None chosen. The census did not research ERP vendors [FC-INT §2].
10. **Roadmap.** Missing; no order. Owner: FC-INT Unanswered 12, not in the register.

### 13.16 Carrier integration through Eeasy shipping: labels, tracking webhooks and the harmonisation table

1. **Definition and goal.** Create carrier shipments through Eeasy shipping at pack, keep the AWB and a label copy, and take carrier status updates.
2. **Workflow.** Pack with measured weight → choose a carrier → `carrier_call` create (`Idempotency-Key: {package_id}:{generation}`) → store `eeasy_shipment_id`, AWB and a label PDF copy → package `ready` and `wms.package.shipment_created` → tracking webhooks (bound to the account's key) → kernel verifies, stores and emits `core.carrier_update.received` → WMS maps the update per the table below [R1 §7.1, §7.3].
3. **Rules and edges.** Label sizes 10 × 15 cm and A6 are required from #885 [R1 §7.7]. Cancel is allowed only before pickup; a refusal leaves the package `ready` and alerts staff [R1 §7.2]. Carrier pricing, coverage, AWB numbering and COD remittance stay with Eeasy shipping [R1 §7.5]. Eeasy's webhook scheme is not yet defined; we ask #885 to adopt ADR-0040 [R1 §3.2]. Go or no-go date 2027-01-15 [R1 §7.7, Q-29].

| Eeasy shipping meaning (vocabulary to confirm with #885) | Package transition | Stock |
|---|---|---|
| shipment created, label printed | none | none |
| picked up by carrier, first scan | `ready → handed_over` | `dock → transit` |
| in transit, out for delivery, failed attempt | none; shown on the timeline | none |
| delivered | `handed_over → delivered` | `transit → CUSTOMER` |
| returned to shipper | `handed_over → returned`; a Return is expected | none until received |
| cancelled by carrier | none; staff alert | none |

An update for an earlier state is stored and ignored; updates are idempotent per `(eeasy_shipment_id, status, time)` [R1 §7.3].

4. **Data.** `wms_packages`: `eeasy_shipment_id`, `carrier_code`, `awb`, `label_storage_key`, `status` [R7]; `core_inbound_webhooks` with source `eeasy_shipping`; the account's Eeasy key encrypted with key id, shown afterwards only by prefix [R1 §7.6].
5. **Surfaces.** Pack bench carrier cards and print button; package list [R1 §7.1].
6. **Permissions and audit.** `wms.packing.write` to pack. The merchant owner enters the Eeasy key in account settings; the permission catalogue names no permission for it [R2 §11, R1 §7.6].
7. **Dependencies.** `CarrierShipments` port; outbox `carrier_call` (concurrency 5; retries at 10 s, 30 s, 2, 5, 15 min; dead at the sixth failure or the first non-retryable error); object storage (13.25) [R1 §4.2].
8. **Metrics.** Carrier call outcome per port; breaker-open alert after 5 minutes; dead `carrier_call` rows page on call [R1 §4.5, §10].
9. **Market and chosen shape.** Anchanto's Shipa flow creates shipments on pack and syncs AWB and status back [T-AN §3.5]; OTO signs webhooks with HMAC and registers them once per account [FC-INT S13]; ShipHero's custom-carrier label webhook promises a label within 20 seconds [T-SH §5 row 16]. Chosen: Eeasy shipping only (ADR-0014). The harmonisation table is in our document but is not versioned or visible to staff; Anchanto's visible, versioned per-carrier table is proposed (T-AN §6 P4) and not adopted.
10. **Roadmap.** Planned: INT-8, wave 3, behind an allowlist (ADR-0006); depends on WMS-7 and Q-29. Owner: Q-29 (go or no-go 2027-01-15; signed webhooks).

### 13.17 Carrier choice rules at pack

1. **Definition and goal.** At pack the packer picks one fulfilment method from one list: own fleet or a carrier [ADR-0014].
2. **Workflow.** Measure (W-10) → bench shows the own-fleet card and carrier cards from `quote` (synchronous, display only, 4 s timeout) → choose → package `packed → awaiting_label`, generation increments, `carrier_call` written → a terminal failure returns the package to `packed` with a reason and no method [R1 §2.7, §7.1, §7.2].
3. **Rules and edges.** No rule engine; prices shown are Eeasy shipping's, and the product computes none [R1 §7.1]. Carrier cards sit behind the allowlist until the go or no-go [R9 R-1]. When Eeasy shipping is down only the own-fleet card is selectable [R1 §2.7].
4. **Data.** `wms_packages.fulfilment_method` (`own_fleet`, `carrier`) and the generation counter [R7].
5. **Surfaces.** WMS pack bench (WEB-15 scanner-first) [R9].
6. **Permissions and audit.** `wms.packing.write` [R2 §11].
7. **Dependencies.** `quote` port; ADR-0006; ADR-0014.
8. **Metrics.** Breaker state for Eeasy shipping; no choice-level metric is defined.
9. **Market and chosen shape.** Omniful chooses carriers by ordered rules on weight, region, product, SLA and cost [T-OM §5 row 25]; Torod runs ordered first-match rules with a per-rule auto-print switch [T-TO §5 rows 2 to 3]; Anchanto routes by ordered rules [T-AN §5 row 3]. Chosen: manual choice from one list. Proposed, not adopted: INT-16, pack-time rules behind the allowlist with a dry run (PT-CMP §4).
10. **Roadmap.** Partial: manual choice in WMS-7 and INT-8; rules missing; INT-16 is a proposal. Owner: none registered.

### 13.18 Carrier aggregation (scope question)

1. **Definition and goal.** One API across many carriers: choose the carrier, print labels, receive tracking, and collect and remit COD, all through an aggregator.
2. **Workflow.** Not designed. Torod compares and books over 240 carriers and collects COD on a plan schedule [T-TO §1]; OTO claims over 460 carrier integrations [FC-INT §2].
3. **Rules and edges.** Torod calls itself an intermediary and disclaims liability for transport [T-TO §1]. COD held between collection and transfer raises a custody question against ADR-0007 [I]. ADR-0014 rejects direct carrier integration and keeps pricing and coverage in Eeasy shipping; ADR-0001 limits this product to Eeasy shipping for carriers [ADR-0014, ADR-0001]. The census cites ADR-0005 and AGENTS.md "own fleets only"; ADR-0005 governs the Eeasy-operated executor fleet, not third-party carriers, so the binding text is ADR-0014 [I].
4. **Data.** None designed; an aggregator would add an account credential and a COD ledger question.
5. **Surfaces.** None designed.
6. **Permissions and audit.** None designed.
7. **Dependencies.** INT-8; Q-29; a review of ADR-0001 and ADR-0014 [FC-INT proposed order 10].
8. **Metrics.** None designed.
9. **Market and chosen shape.** Torod, OTO, Shipa (through Anchanto) and Amazon Shipping are the models in the sources [T-TO, T-AN §3.5]. Chosen: none; ADR-0014 decides against direct carriers and does not address aggregators. An owner ruling is needed before any order is written [FC-INT Unanswered 7].
10. **Roadmap.** Missing. CARR-1 (wave 3 or 4) is a proposal after an owner ruling; no register row. Owner: FC-INT Unanswered 6 and 7, not in the register.

### 13.19 Geocoding and short codes (Hudhud, SPL National Address, Sayyar, Google, HERE)

1. **Definition and goal.** Turn an address text, a National Address short code or a pin into a located answer, and never fail an order because geocoding failed.
2. **Workflow.** Built (INT-2). Short code: `spl → sayyar → hudhud`; text: `sayyar → hudhud`; reverse: `spl → hudhud`; each source has its own breaker; results cached in Redis then `core_geocode_cache`; with no source answering, intake stores the order without a point and lists it under "needs location" [R10 §2.6, §2.11; R1 §2.2].
3. **Rules and edges.** Hudhud's search takes a query string only and returns no confidence, district or Arabic text; the 0.6 threshold and the 1.0 short-code value are product defaults with no source [HUD §1.3, §1.8]. Hudhud publishes no rate limit, quota, price or caching rule (Q-28); a 403 means the key lacks the service [HUD §1.4, §1.5]. Short codes match `^[A-Z]{4}[0-9]{4}$` after normalisation; SPL registration is free and its quotas were not readable [HUD §2]. Sayyar and the SPL point-of-interest lookup are undocumented consumer interfaces behind a switch [R10 §2.12]. Google's archived terms allow 30 consecutive days of cached latitude and longitude and forbid Google geocoding results on a non-Google map [HUD §4]. HERE is kept by eeasynew behind `HERE_API_KEY` and is not built here [R10 §6]. Only address text, city or a point leave the system; no account id or name [R1 §6.1].
4. **Data.** `core_geocode_cache`: key = SHA-256 of method and normalised input, provider, result, `expires_at`; a platform table with no account id [R7]. Orders carry `address_point`, `pin_source`, `geocode_confidence`; sites carry `national_address_short_code` with the CHECK [R7].
5. **Surfaces.** Order intake (DEL-2); site creation (provisioning confirms the point on a map); the "needs location" view; the address-pin request from wave 2 [R1 §6.2].
6. **Permissions and audit.** Internal port; no merchant key; no per-call audit.
7. **Dependencies.** `GEOCODER_SOURCES`, `NATIONAL_ADDRESS_API_KEY`, `HUDHUD_API_KEY`, `HUDHUD_API_URL` through `packages/config`; Redis breakers; 2 s per source, 6 s for the chain [R10 §2.7, §2.11].
8. **Metrics.** `geocoder_calls_total{method,source,outcome}`; `geocode_low_confidence_total`; `matrix_cache_hit_ratio` is the matrix's, not this one's [R1 §10, R10 §2.8].
9. **Market and chosen shape.** Logestechs accepts ids or exact names in English or Arabic and requires a city for a shared village name [T-LG §5]; Torod prices by city [T-TO §5 row 20]. Chosen: a source chain set by the owner's ruling of 2026-11-02, official SPL first [R10 §2.11]. Trade-off: two sources are unofficial and may refuse without notice [R10 §2.12].
10. **Roadmap.** Built: INT-2 merged (PR #105, wave 1); DEL-2 consumes it. Open: Q-28 (provisional). Owner: Q-28; INT-2 owner questions 4 and 5 (unofficial sources; SPL key).

### 13.20 Distance matrix and route solver

1. **Definition and goal.** Travel times and distances between stops, to order a driver's stops and show ETAs, with the VROOM solver.
2. **Workflow.** Planned: matrix elements cached per pair, site and business date; VROOM rung 1 orders one driver's run; nearest-neighbour is the fallback; an OSRM matrix (from wave 2) and a straight-line estimate are later fallbacks [R1 §2.1, §2.3, §6.5].
3. **Rules and edges.** Hudhud offers a distance matrix, but its endpoint and wire format are not stated in the sources read [PF §8]. VROOM's custom-matrix input needs `start_index` when a matrix is supplied (confirmed 2026-10-31) [PF §10]. The Geofabrik "GCC States" extract does not say whether it covers Saudi Arabia in full [PF §11]. ADR-0010 chose VROOM over the Hudhud matrix (owner ruling 2026-09-20); OR-Tools was dropped.
4. **Data.** `del_distance_matrix_cache` per pair, site and day, keyed by geohash [HUD §5, R1 §2.1].
5. **Surfaces.** Driver app stop list (rung 1); dispatcher planner later (DEL-16) [R1 §2.3, R9].
6. **Permissions and audit.** Internal; not on the public surface.
7. **Dependencies.** `DistanceMatrix` and `RouteOptimizer` ports; VROOM and, from wave 2, an OSRM container [R1 §2.1, §6.5]; Redis.
8. **Metrics.** `matrix_cache_hit_ratio`; a `solver = fallback` marker on each plan [R1 §2.3, §10].
9. **Market and chosen shape.** Wasal sells route optimisation with a distribution preview before confirm [T-WA §1 item 5]; Omniful lists traffic, distance and windows [T-OM §5 row 19]. Chosen: VROOM over a Hudhud or OSRM matrix (ADR-0010). Valhalla documents time-of-day matrices; the choice is open (Q-45).
10. **Roadmap.** Deferred to the end of wave 2 (A-24): INT-5 and INT-6. Open: Q-45 (routing engine), Q-18 (where the stop sequence is stored, decided in INT-6).

### 13.21 Map tiles

1. **Definition and goal.** Basemap tiles for the merchant web, the tracking page and the driver app.
2. **Workflow.** MapLibre renders; the tile source is Hudhud if its package includes map styles, else a self-hosted Protomaps PMTiles basemap copied to our storage (Q-19 default) [R9 Q-19, PF §12].
3. **Rules and edges.** MapLibre GL JS is permissively licensed [PF §12]. Protomaps tile data is ODbL and needs OpenStreetMap attribution; a modified or hosted fork must not use the Protomaps name [PF §12]. Hudhud map styles take a publishable key as a query parameter, so that key sits in the client by design [HUD §1.2]. Hudhud's consumer terms bar reproducing map materials outside its app; its B2B terms are unknown [HUD §1.5]. Saudi boundary rendering is not settled by any source read [PF §12].
4. **Data.** The tile file sits in platform storage under `platform/`; no tenant data [R1 §2.6].
5. **Surfaces.** Merchant web map (WEB-6 zones and coverage; WEB-8 tracking) and the driver app map [R9].
6. **Permissions and audit.** None.
7. **Dependencies.** Object storage (13.25); ADR-0033 (MapLibre behind a provider interface) [R9].
8. **Metrics.** None defined.
9. **Market and chosen shape.** Logestechs' admin portal uses Leaflet and Esri, with What3Words [T-LG §1.8]; no other teardown read names a map product [I]. Chosen: MapLibre with a provider interface (ADR-0033); the tile source is open (Q-19).
10. **Roadmap.** Deferred: set up last (A-24). Open: Q-19 (provisional). Owner: Q-19.

### 13.22 WhatsApp engine (messaging)

1. **Definition and goal.** Deliver OTP codes and recipient messages on WhatsApp from a linked number, with bilingual templates as the product rule.
2. **Workflow (ADR-0041, proposed).** Outbox `message` row → kernel renders the bilingual text and applies quiet hours, caps, staleness, opt-out and budget → `EngineMessageSender` signed command: `message.send.verification` for OTP (priority 1, 600 s hold) or `message.send.text` → the engine sends from a linked number → signed callbacks `message.status`, `suppression.changed`, `connection.event` → our callback door answers `200 {"ok":true}` [ADR-0041; WA §2.2, §2.5; R12 §2A].
3. **Rules and edges.** The engine is an unofficial multi-device WhatsApp Web client (Baileys 7.0.0-rc14, pinned); it has no template approval and accepts text up to 65,536 characters [WA §1]. Each linked number carries ban risk; an OTP that cannot leave within 10 minutes expires [WA §1, §2.3]. Pacing is 3 to 8 seconds per sender and the engine sets no count cap [WA §1]. The engine keeps bodies up to seven days; our OTP rows are deleted after one hour [WA §6; R7 §10]. Opt-out words differ: the engine recognises stop, إيقاف, start and تشغيل; ADR-0041 proposes the union with الغاء and اشتراك [WA §6; ADR-0041]. Meta's position on unofficial automation is not stated anywhere read [WA Unanswered 1]. Production runs on eeasynew's host [WA §4].
4. **Data.** `core_messaging_opt_outs`, `core_messaging_senders`, `core_accounts.engine_account_id`, `core_engine_callback_nonces` (24 h) [R12 §2A]; OTP code encrypted on the outbox row, deleted one hour after sending [R7 §10].
5. **Surfaces.** Admin links the platform number through the platform door; a merchant links its own number (later order, after PLAT-13) [ADR-0041 consequences; R12 §2A.4].
6. **Permissions and audit.** Platform admin for the platform sender; merchant owner for its own number; each link audited [ADR-0041].
7. **Dependencies.** An engine deployment for this product (OPS-1 hosts it), its own secret pair and callback base URL; the `message` queue (concurrency 10; OTP first; 40 per second per provider, "to confirm") [ADR-0041; R1 §4.2].
8. **Metrics.** `messages_sent_total`, `messages_skipped_total{reason}`, `message_budget_used_ratio`, OTP send failure rate; alerts on `needs_relink` and `banned` [R1 §10; WA §5].
9. **Market and chosen shape.** Torod sends an SMS at each stage [T-TO §5 row 11]; Omniful lists SMS, email and app messages [T-OM §5 row 23]. Chosen: WhatsApp only, no SMS before wave 3 (ADR-0037). The roadmap's Meta Cloud adapter is replaced by the engine under ADR-0041 (discrepancy D1).
10. **Roadmap.** Partial. PLAT-9 row merged (#75, fix #84); its plan header says leg 2 (engine adapter) is built and in review, and A-25 amends it. INT-3 (wave 1) and INT-7 (wave 2) depend on it. Owner: ADR-0041 defaults 1 to 4 (provisional); Q-27 row stale; PLAT-9 question 2 (SMTP) stands.

### 13.23 Push

1. **Definition and goal.** Alert drivers to offers, assignments, cash blocks and sync requests through Expo push, as a hint only.
2. **Workflow.** A Delivery consumer writes one `push` row for up to 100 devices (ids only) → the handler validates it and renders title and body from the catalogue in the driver's locale → one Expo send per row → tickets stored → receipts checked 15 minutes later by a job every 5 minutes; `DeviceNotRegistered` clears the token through a Delivery hook [R11 §2.3 to §2.5].
3. **Rules and edges.** Expo allows 600 notifications per second per project and up to 100 per request (ours is 500 per second); receipts are available after 15 minutes and cleared after 24 hours [PF §6]. A push is a hint; offers are also fetched on foreground and by polling (ADR-0009) [R11 §1]. Payloads carry ids and localisation keys only [R11 §1; R1 §11].
4. **Data.** `core_push_tickets` (outbox id, device id, ticket id, status, error; no token, title, body or data) [R7]. The push token lives on `del_driver_devices` (DEL-4) and is personal data, never logged [R11 §1].
5. **Surfaces.** Driver app (DRV-5); no staff surface [R9].
6. **Permissions and audit.** Internal. The Expo access token is limited to the project [R1 §11].
7. **Dependencies.** Outbox kind `push`, queue `outbox.push` (concurrency 4; 500 per second; three attempts at 10 s, 30 s, 2 min) [R1 §4.2]; `EXPO_ACCESS_TOKEN` with enhanced push security [R1 §2.5].
8. **Metrics.** `push_messages_total{outcome}`, `push_receipts_total{status}` [R11 §2.9].
9. **Market and chosen shape.** None of the teardowns read for this chapter covers driver push. Chosen: Expo push service, no SDK, ids only [R11 §2.2].
10. **Roadmap.** Built: INT-4 merged (PR #93, wave 1). No producer writes `push` rows until DEL orders exist; DRV-5 planned [R9].

### 13.24 Mail

1. **Definition and goal.** Transactional email for staff invitations, password resets and platform invitations.
2. **Workflow.** A `message` outbox row with channel `mail` → `MailSender` over SMTP with Arabic and English bodies from `packages/i18n` → the link is a one-time token issued by PLAT-11 [R12 §2.2].
3. **Rules and edges.** No attachments. Production requires `MAIL_SMTP_URL` and `MAIL_FROM`; Mailpit serves local and CI [R12 §2.2, §2.9]. Mail is not a new outbox kind; PLAT-9 records this as its reading of the seven kinds in ADR-0036 [R12 §2.2].
4. **Data.** The `message` outbox row (template key and parameters) [R12 §2.2].
5. **Surfaces.** Staff invitation and reset emails; platform invitations [R12 §2.3].
6. **Permissions and audit.** None beyond the outbox audit.
7. **Dependencies.** Outbox `message` queue [R1 §4.2]; the `messages` namespace in `packages/i18n`.
8. **Metrics.** Sent and skipped counts for `message` rows; no bounce or complaint metric is defined.
9. **Market and chosen shape.** Scheduled email reports are missing [FC-COV §3, RPT-1]; no teardown covers mail. Chosen: SMTP through `nodemailer` with a provider behind it.
10. **Roadmap.** Covered by PLAT-9 (merged). The mail adapter is specified in plan §2.2 and was not verified in code for this chapter. Scheduled reports are a proposal (RPT-1). Owner: PLAT-9 question 2 (SMTP provider).

### 13.25 Object storage

1. **Definition and goal.** Store proofs, deposit slips, labels, CSV imports, exports and platform files; serve them through expiring signed URLs.
2. **Workflow.** The API signs an upload with content type and size bound → the client PUTs → confirm → proof row `stored` → workers `put` labels and exports → reads signed for 5 minutes (staff) or 60 minutes (label print) → deletion through outbox kind `storage_lifecycle` [R1 §2.6; R2 §3].
3. **Rules and edges.** One bucket per environment; every key starts `acc/{account_id}/`; the server builds keys and never takes them from the client [R1 §2.6]. Lifecycle: incomplete multipart uploads abort after 1 day, `imports/` 30 days, `exports/` 7 days, noncurrent versions 30 days; proofs are kept two years by default; labels one year [R1 §2.6, §7.4]. Upload URL lifetime is 15 minutes in `integrations.md` and 10 minutes in the contracts README (discrepancy D6). Bucket region: a Saudi or Bahraini region is the provisional default (Q-10) [R9].
4. **Data.** Keys are held on rows (`label_storage_key`, proof keys); no storage table [R7].
5. **Surfaces.** Proof and slip uploads, CSV import, label print, export download [R2 §3, R1 §2.6].
6. **Permissions and audit.** Bucket access key scoped to one bucket; signed URLs built under the account prefix; deletion batches audited [R1 §4.1, §11].
7. **Dependencies.** Silo (MinIO fork) locally and in CI; the provider bucket in staging and production; outbox `storage_lifecycle` (ADR-0036) [R1 §9].
8. **Metrics.** `integration_calls_total` and latency for the storage port; no storage-specific metric [R1 §10].
9. **Market and chosen shape.** ShipHero exports Parquet through signed URLs valid 24 hours [T-SH §5 row 32]. Chosen: storage first (ADR-0015), short signed lifetimes, provider lifecycle rules for age-only prefixes.
10. **Roadmap.** Planned: INT-1, wave 1. Not in the §0 progress table at this read. Depends on PLAT-8 and OPS-1, which waits for the owner's go. Owner: Q-10 (hosting, provisional).

### 13.26 Inbound webhook handling and SSRF guards

1. **Definition and goal.** Verify, store and emit provider webhooks (Salla, Zid, Eeasy shipping, WhatsApp engine); stop merchant endpoints from reaching internal addresses.
2. **Workflow.** Inbound: identify the connection → verify by the provider's rule → replay window of 300 s where the provider signs a timestamp → dedupe → map, store and write the outbox row in one transaction → answer 200 within 2 s; no provider call inside the request [R1 §3.1]. Outbound: each delivery resolves the host once, refuses private and reserved ranges, connects to the checked address, follows no redirect and reads at most 64 KB [R3 §4; R1 §11; ADR-0040 §6].
3. **Rules and edges.** Body limit 1 MB; raw bytes kept before parsing. An unknown connection returns 200 with status `ignored`; a failed verification returns 401 and stores redacted headers without the body [R1 §3.1]. Zid's check compares a per-connection secret, then fetches the order, so a forged call can at most trigger a read [R1 §3.2]. Salla signs no timestamp, so dedupe is the only replay defence [PF §1]. OWASP: validate the address actually connected, not an earlier lookup; disable redirects; deny-lists are bypass-prone [WS §2.2]. The refused ranges do not name NAT64 (`64:ff9b::/96`) or 6to4 (`2002::/16`); the implementation list must be checked [WS §3 row 25]. Webhook paths are excluded from bot challenges at the edge [R1 §11].
4. **Data.** `core_inbound_webhooks` (payload 30 days, then deleted; metadata one year); `core_webhook_nonces` [R7; R1 §3.1].
5. **Surfaces.** Platform inbound list, get, remap and refetch, all in wave 4 [R5]. No merchant surface.
6. **Permissions and audit.** `platform.outbox.read`; raw bodies need `platform.inbound.raw_read` and write an audit row; remap and refetch need `platform.outbox.replay` [R5].
7. **Dependencies.** Kernel `MerchantWebhooks` and channel adapters; per-provider rate limit on `/hooks/*`; Cloudflare WAF in front [R1 §11].
8. **Metrics.** `inbound_webhooks_total{provider,status}`; alert when `rejected` exceeds 20 per hour per provider; any `unmappable` row alerts [R1 §10].
9. **Market and chosen shape.** Logestechs sends no signature and retries nothing [T-LG §3.3]; Wasal signs the body only [T-WA §3.4]. Chosen: per-provider verification in the kernel, verify then store then emit (ADR-0040, `integrations.md` §3).
10. **Roadmap.** Partial. The inbound pattern is in `integrations.md` §3; platform operations are declared; the Eeasy shipping scheme awaits #885 (Q-29); the merchant-side SSRF rules belong to INT-10 (planned). Owner: Q-29.

### 13.27 Integrator docs and sandbox accounts

1. **Definition and goal.** A published API reference, event samples, an onboarding runbook and sandbox accounts for integrators.
2. **Workflow.** Reference generated from the OpenAPI bundles; samples page from the event catalogue; onboarding and channel runbooks; sandbox accounts on staging [R2 §9; R9 OPS-7].
3. **Rules and edges.** One spec only: no second OpenAPI generator [R2 §9]. Contract tests against the running API fail on undocumented statuses or fields [R2 §9]. Provider fixtures are replayed in CI, and a monthly job re-runs the calls against sandboxes outside PR checks [R1 §9]. A penetration test gate before the public API opens to integrators is proposed, not in the roadmap [FC-INT proposed order 2]. Every string is Arabic and English (AGENTS.md); the docs language is not decided.
4. **Data.** None.
5. **Surfaces.** Developer docs (not designed beyond OPS-7); the web samples page (WEB-16) [R9].
6. **Permissions and audit.** None. Whether the docs are public is not decided.
7. **Dependencies.** Contract bundles (`redocly bundle`), INT-9, INT-10 [R2 §9; R9].
8. **Metrics.** None.
9. **Market and chosen shape.** ShipHero publishes a changelog and no public sandbox [T-SH §3.8]; Logestechs publishes Apidog docs with no sandbox URL [T-LG §3.1]; Anchanto's API reference sits behind a project password [T-AN §3]; Wasal's documented base path returns 404 on the live host [T-WA §3.1]. Chosen: docs generated from the contract bundles.
10. **Roadmap.** Planned: OPS-7, wave 4, after INT-9 and INT-10. The penetration-test gate (SEC-1) is a proposal in the census, not a roadmap row. Owner: none registered.

## Discrepancies found in the repository

Each item is a document fact the lead should reconcile. None was changed by this note.

- **D1 Messaging shape.** ADR-0041 (proposed) and A-25 say `integrations.md` §2.4, §5.2 and §5.5 were amended, but `integrations.md` on main still describes a single WhatsApp Business provider with `sendTemplate`, `listTemplates`, Meta approval and Meta webhook signatures [R1 §2.4, §3.2, §5.1 to §5.2, §12 point 1]. Roadmap Q-27 still names "its verified Meta business".
- **D2 Inbound contract.** `integrations.md` §3.3 and §12 say list, remap and refetch are "a contract addition owed by wave 4"; `platform.yaml` already declares `/inbound-webhooks`, `/inbound-webhooks/{id}/remap` and `/accounts/{id}/inbound-webhooks/refetch` [R5]. The platform `provider` enum omits `whatsapp`, which `data.md` allows [R7].
- **D3 Staff channel operations.** `integrations.md` §8.7 says the channel operations are not yet in the contracts; `staff.yaml` has them (channel create marked wave 3, reauthorise and resync wave 4, API keys and webhooks wave 4) [R6]. Contracts README §10 lists none of the channel connection operations for wave 3, and INT-11 is wave 4 [R2 §10; R9].
- **D4 Connection status values.** `integrations.md` §8.2 and §8.7 use `connected`, `needs_reauth`, `disconnected`, `error`; `data.md` allows `active`, `paused`, `disconnected` only [R1; R7].
- **D5 Inbound dedupe.** `integrations.md` §3.1 step 5: unique `(provider, dedupe_key)` for seven days; `data.md`: unique `(account_id, source, external_event_id)`. An unknown connection has no account id [R1; R7].
- **D6 Upload lifetime.** `integrations.md` §2.6: 15 minutes; contracts README §3: 10 minutes [R1; R2].
- **D7 Provider facts not yet reflected.** The 2026-10-31 provider-facts note confirmed the Salla signature header and its lack of a timestamp, and the Salla token lifetime and single-use refresh; `integrations.md` §3.2 and §8.2 still say "to confirm". The Expo 600 per second limit is confirmed; §2.5 and §4.2 still say "to confirm". The Meta 24-hour review claim is contradicted in part, but matters little under ADR-0041 [PF §1, §2, §6, §7; R1].
- **D8 Carrier aggregation citation.** The feature census cites ADR-0005 and AGENTS.md "own fleets only" against aggregation; ADR-0005 governs the Eeasy-operated executor fleet. The binding rules for third-party carriers are ADR-0014 and ADR-0001 [FC-INT; FC-COV; ADR-0005; AGENTS.md].
- **D9 Google and HERE.** ADR-0010 calls Google an optional adapter; INT-2 §6 says eeasynew keeps HERE behind `HERE_API_KEY`; the census marks both as missing and not planned. "HERE" appears in no foundation document [ADR-0010; R10 §6; FC-INT §2].
- **D10 Opt-out words.** ADR-0041 proposes the union of our words (STOP, إيقاف, الغاء; START, اشتراك) and the engine's (stop, إيقاف, start, تشغيل). The engine does not recognise الغاء or اشتراك [WA §6; ADR-0041]. `integrations.md` §5.5 lists only our first set [R1 §5.5].

## Feature index

| # | Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|---|
| 13.1 | Public API and resource split | Planned | INT-9 | 4 | Q-13, Q-14 |
| 13.2 | API keys: issue, rotate, revoke | Planned | INT-9 | 4 | Q-13 |
| 13.3 | Sandbox keys | Partial | INT-9, OPS-7 | 4 | none (U1) |
| 13.4 | Rate limits and quotas | Partial | PLAT-6, INT-9; BILL-1 proposed | 0, 4; BILL-1 2 | Q-33 |
| 13.5 | Versioning | Covered by contract rules | ARCH-1 | 0 | ADR-0027 accepted by PLAT-8 |
| 13.6 | Merchant webhooks, Standard Webhooks | Planned | INT-10 | 4 | Q-35 (Q-43 ruled) |
| 13.7 | Webhook health, retries, redeliver, reconciliation | Partial | INT-10, INT-9 | 4 | Q-35 |
| 13.8 | Event catalogue and samples | Planned | INT-10, OPS-7 | 4 | none |
| 13.9 | Salla and Zid install, OAuth, refresh | Planned | INT-11 | 4 | Q-30 |
| 13.10 | Channel order intake and reconcile | Planned | INT-11 | 4 | Q-34 |
| 13.11 | Status mapping, failed log, re-sync | Partial | INT-11, INT-12 | 4 | none |
| 13.12 | Stock publication and buffers | Planned; buffer missing | INT-12 | 4 | Q-36 |
| 13.13 | Tracking push-back | Missing | none | none | Q-34 |
| 13.14 | Shopify, WooCommerce, Magento, noon, Amazon.sa | Missing; CONN-1 and CONN-2 proposed | none | 4 or 5 (proposed) | census Q13 (U15) |
| 13.15 | ERP connectors | Missing; unresearched | none | none | census Q12 (U14) |
| 13.16 | Carrier integration via Eeasy shipping | Planned | INT-8, WMS-7 | 3 | Q-29 |
| 13.17 | Carrier choice rules at pack | Partial; INT-16 proposed | INT-8 | 3 | none |
| 13.18 | Carrier aggregation | Missing; scope question | none; CARR-1 proposed | 3 or 4 (proposed) | census Q6 and Q7 (U16) |
| 13.19 | Geocoding and short codes | Built (merged) | INT-2 | 1 | Q-28 |
| 13.20 | Distance matrix and route solver | Deferred | INT-5, INT-6 | 2 (end of wave) | Q-45, Q-18 |
| 13.21 | Map tiles | Deferred | WEB-6 depends; INT-1 | 1 (ruled last, A-24) | Q-19 |
| 13.22 | WhatsApp engine messaging | Proposed ADR-0041; PLAT-9 leg 2 | PLAT-9, INT-3 | 0 and 1 | ADR-0041 defaults 1 to 4; Q-27 stale |
| 13.23 | Push | Built (merged) | INT-4 | 1 | none |
| 13.24 | Mail | Covered in PLAT-9 | PLAT-9 | 0 | PLAT-9 question 2 |
| 13.25 | Object storage | Planned | INT-1 | 1 | Q-10 |
| 13.26 | Inbound webhooks and SSRF guards | Partial | INT-10, INT-11 | 4 | Q-29 |
| 13.27 | Integrator docs and sandbox accounts | Planned | OPS-7 | 4 | none (SEC-1 proposed) |

## Sources

Repository files are read on 2026-11-02 from the worktree at `origin/main` (commit 6ca087e), unless a line gives another date. Branch notes are read from `origin/docs/feature-coverage` and `origin/docs/platform-teardowns` on 2026-11-02.

- R1 `docs/architecture/integrations.md` (cited by section)
- R2 `docs/contracts/README.md` (cited by section)
- R3 `docs/contracts/webhooks.md`
- R4 `docs/contracts/openapi/public.yaml`
- R5 `docs/contracts/openapi/platform.yaml`
- R6 `docs/contracts/openapi/staff.yaml` and `staff-wms.yaml`
- R7 `docs/architecture/data.md`
- R8 `docs/architecture/identity-and-tenancy.md`
- R9 `docs/roadmap.md` (progress table, wave sections, owner register, amendments A-20 to A-26, risks R-1 and R-8)
- R10 `docs/orders/INT-2/plan.md` §2, §6, §7
- R11 `docs/orders/INT-4/plan.md` §1, §2
- R12 `docs/orders/PLAT-9/plan.md` §0, §2, §2A
- ADR-0001, ADR-0005, ADR-0010, ADR-0013, ADR-0014, ADR-0024, ADR-0027 (proposed), ADR-0030 (superseded), ADR-0036 (proposed), ADR-0037 (proposed), ADR-0040 (accepted 2026-11-01), ADR-0041 (proposed 2026-11-01): `adr/NNNN-*.md`
- AGENTS.md (repository root), hard rules
- HUD `docs/research/hudhud-geocoding-2026-11.md` (research 2026-11-02; primary pages cited inside it)
- WS `docs/research/webhook-signing-standards-2026-11.md` (research 2026-11-01)
- PF `docs/research/provider-facts-2026-10.md` (research 2026-10-31; read 2026-11-02)
- WA `docs/research/whatsapp-engine-2026-11.md` (research 2026-11-01 from eeasynew's checkout)
- FC-INT `origin/docs/feature-coverage:docs/research/features-platform-integrations-compliance-2026-11.md` (research 2026-11-02; its own sources are S1 to S28, cited as FC-INT Sn)
- FC-COV `origin/docs/feature-coverage:docs/research/feature-coverage-2026-11.md` (research 2026-11-02)
- PT-CMP `origin/docs/platform-teardowns:docs/research/platform-comparison-2026-11.md` (2026-11-02)
- T-SH `origin/docs/platform-teardowns:docs/research/shiphero-teardown-2026-11.md`
- T-LG `origin/docs/platform-teardowns:docs/research/teardown-logestechs-2026-11.md`
- T-OM `origin/docs/platform-teardowns:docs/research/teardown-omniful-2026-11.md`
- T-AN `origin/docs/platform-teardowns:docs/research/teardown-anchanto-2026-11.md`
- T-TO `origin/docs/platform-teardowns:docs/research/teardown-torod-2026-11.md`
- T-WA `origin/docs/platform-teardowns:docs/research/teardown-wasal-2026-11.md`

Provider facts that a public page states are dated by their research note. Nothing here was read live on a provider site for this chapter.

## Unanswered

1. Sandbox: is a sandbox an account or an environment, and which keys, scopes and data does it hold? (13.3)
2. Salla and Zid store-API rate limits (values not read; `integrations.md` §4.2 "to confirm"). (13.4, 13.12)
3. Is an API call metered or priced, and does a plan limit it? (BILL-1 is a proposal; Q-33.) (13.4)
4. The #885 webhook scheme and its status vocabulary (Q-29). (13.16, 13.26)
5. Whether a channel-side edit or cancellation must emit an event, and whether order status is written back (Q-34). (13.10, 13.13)
6. Hudhud's rate limits, pricing, caching and storage terms, short-code inclusion, Arabic search input and no-match response (Q-28). (13.19)
7. Whether SPL's and Sayyar's terms allow the chain as built (INT-2 question 4). (13.19)
8. WhatsApp (Meta) terms position on unofficial multi-device automation and OTP delivery to people who never messaged the number. The owner accepted the risk under ADR-0041; no source states the position. (13.22)
9. Whether eeasynew will provide a per-message purge for OTP bodies (ADR-0041 question 4). (13.22)
10. Whether Hudhud map styles are in the package, or Protomaps is used (Q-19); Saudi boundary rendering. (13.21)
11. Whether the OSRM extract covers Saudi Arabia in full, and Valhalla or OSRM (Q-45). (13.20)
12. Whether Google or HERE is wanted as a fallback geocoder beyond Hudhud (census question 15). (13.19)
13. ERP vendors, invoice flows and their VAT and ZATCA position (census question 12). (13.15)
14. Whether Magento, noon and Amazon.sa are wanted, and in which wave (census question 13). (13.14)
15. Whether aggregation is allowed for third-party carriers, and who holds COD in that case (census questions 6 and 7). (13.18)
16. Whether a webhook health tier is adopted, and whether events for a disabled subscription are queued or dropped (platform-comparison proposal). (13.7)
17. PDPL: whether Expo, the WhatsApp engine host and other processors are cross-border transfers, and whether location data needs a basis (counsel; census §4). (13.22, 13.23)
18. Whether an in-Kingdom storage duty applies to the object-storage region (draft Art. 23(2), census §4; Q-10). (13.25)
