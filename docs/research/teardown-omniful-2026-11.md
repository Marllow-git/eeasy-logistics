# Omniful teardown, 2026-11

Date: 2026-11-02. Branch `docs/teardown-omniful` from `origin/main` at `1e0c184`. Author: researcher agent for the lead.
Roadmap basis: `docs/roadmap.md` §1.2 to §1.5 (DEL-2, DEL-3, DEL-6 to DEL-10, DEL-18, WMS-1 to WMS-8, INT-8 to INT-12, WEB-5 to WEB-17, DRV-1 to DRV-5). Census row: `origin/docs/ksa-platform-census:docs/research/ksa-platform-census-2026-11.md`. Shape only, not repeated: `origin/docs/shiphero-teardown:docs/research/shiphero-teardown-2026-11.md`. Our design: `docs/architecture/domain-model.md`, `integrations.md`, `web.md`, and `adr/` at `1e0c184`.

Grades: **[F]** page fetched and read on 2026-11-02; **[S]** search summary only, page not fetched; **[T]** third-party profile or aggregator, not Omniful's own text; **(inferred)** my reading. Source IDs (O1 to O39) map to section 8. Every registry row carries its read date.

Method and limits: the developer portal `docs.omniful.tech` returned only its title, `dev.omniful.ai` did not resolve, and `omniful.ai/platform/*`, `/pricing`, `/security` and the OpenAPI file returned 404 or no content. No logged-in access. The pricing deck was a PDF; I extracted its text locally with `pdftotext` into a scratch directory, which I removed afterwards, and ran no script on it.

## 1. Summary for the lead

1. Omniful is a Riyadh-HQ SaaS suite (OMS, WMS, TMS, POS, a shipping gateway and two mobile apps), founded 2022 and funded with a $5.85M seed in 2023 (O25 [F], O31 [S], O23 [F]).
2. Its engineering postings are Golang and React in Gurugram, India; its Riyadh postings are sales and implementation (O28 [F], O29 [F]). Stack is from job posts only (inferred).
3. KSA proof is thin: Panda, Spar and Sadhan are named only in search summaries (O31 [S]); Arab News lists Salla, Zid, Jahez, Amazon, Noon and ToYou as channels (O25 [F]); Zid and Noon connectors have step-by-step setup pages (O18, O19 [F]).
4. Borrow 1, carrier choice by rules with a cost option, over a quote step: `quote` already exists in our `CarrierShipments` port (integrations.md §2.7). Adapt, bounded rules (O27 [F]).
5. Borrow 2, partial fulfilment (in-stock lines ship, the rest follows) and conditional order tags (origin city, country, weight, package count). Adapt to WMS-6 and DEL-2 (O10, O9 [F]).
6. Borrow 3, connector onboarding: mandatory warehouse settings before activation, status mapping before first sync, and a failed-log and manual-sync screen (O19, O18 [F]). Maps to INT-11 and PLAT-8 dead letters.
7. Stronger 1 (stated design, not measured): stock is an append-only ledger with invariants (ADR-0011; domain-model §4.4, W-4 to W-9). Omniful publishes no stock-ledger model, so this is an absence of evidence, not proof of a gap.
8. Stronger 2: the account comes from the token (ADR-0025). Omniful's public order API puts `seller_code` in the path (O22 [T]).
9. Stronger 3: an offline driver app with an outbox and cash custody (ADR-0007, ADR-0008). Omniful's driver app documents COD payment proof and no offline mode (O13 [F]).
10. Gaps this exposes in our plan: no order hold, no partial shipping, no inter-site transfer, no warehouse scanner app (WMS screens are web only, web.md), and no ZATCA e-invoicing in the roadmap or ADRs (grep at 1e0c184). Omniful's own ZATCA claims are vendor [S] (O35).

## 2. Product map

"Where it lives": W = web dashboard, A = mobile app, API = public API, E = engine (no direct UI described). Omniful's own pages are marketing-heavy; "how it works" is what the page states, and gaps are marked.

### 2.1 OMS (order management)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Sales-channel intake | Connector creates orders; only orders with mapped statuses sync; seller, store and hub are mapped in settings (Settings > Sales Channels) | W, connector | O18, O19 [F] |
| Public order API | Create, bulk create, update, cancel, approve, shipping address and details, attachments, invoice, logs (19 operations) | API | O22 [T] |
| Smart order routing | Picks a hub from inventory availability, hub capacity and shipping cost. Distance is implied ("closer hub"); SLA, fallback and split are not described | E, configured by "prioritise factors" | O7 [F] |
| Partial order fulfilment | Items in stock are processed now and the rest follows; no backorder, cancel or hold rule stated; no settings | E | O10 [F] |
| Order tags | Labels set by hand or by condition on origin city, country, order weight, package count. Examples: high-priority, fragile, international, partial fulfilment | W | O9 [F] |
| Approve, review, edits | `PUT .../orders/{id}/approve` exists; the Shopify listing names "review and approval" and "order edits" | API, Shopify app | O22 [T], O23 [F] |
| Returns | Customer return after delivery (wrong, damaged, size, dissatisfied) and courier-partner return after failed delivery; reverse shipment to hub; QC in WMS and OMS. No refund or channel pushback described | W, API | O11 [F] |
| Reports | Orders, pending orders ("lingering in a pending status"), item-level, fulfilment, PO and STO reports | W | O4 [F], O8 [F] |

### 2.2 WMS (warehouse)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Multi-hub | "Manage Multiple Hubs"; a hub is a facility for receiving, storing, processing and distributing; stock transfer orders (STO) move goods between hubs. No setup steps | W | O4 [F] |
| Inbound | Gate entry, goods receipt note (GRN), inspection in one flow; PO and STO; inventory updated on receipt | W, A | O3 [F], O4 [F] |
| Putaway | Rule-based putaway and location assignment (WMS page); barcode scan of the storage bin; real-time sync | A, W | O3 [F], O5 [F] |
| Picking | Single-order and multi-order pick lists with barcode scan; zone-based; route optimisation. Wave and cluster picking appear only in search summaries | A, W | O3 [F], O5 [F], O6 [F], O31 [S] |
| Packing | Order details, item scanning, packing slips, automated validation, configurable packing; packaging material support added in 4.9.35 | A | O5 [F], O24 [F] |
| Consolidation | Combines several orders into one shipment; algorithm flags candidates | A | O5 [F] |
| Cycle count | Scheduled and ad hoc counts; configurable parameters; audit trail; counts on the go | A, W | O3 [F], O5 [F] |
| Adjustment, pallets | Correct stock, change product attributes, move between locations; break pallets into cases or units and regroup | A | O5 [F] |
| Lots, batches, expiry | Batch management report; a "Serialisation" article title; Shopify listing: batch tracking and expiry dates | W, Shopify | O4 [F], O23 [F] |
| Kitting and assembly | Named in the WMS page and the feature list; no text | W | O3 [F] |
| Outwarding | "Confirms packing and shipment"; dispatch controls for peak volumes (claims) | W, A | O3 [F] |

### 2.3 TMS and last mile

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Trip creation, first and last mile | Trip creation and first-mile to last-mile flows; bulk shipment creation; sorting-hub management and inter-hub routing (AWS listing) | W | O12 [F], O15 [T] |
| Dispatch | Assigns deliveries to drivers and manages schedules. Assignment logic not described | W | O14 [F] |
| Route optimisation | Uses traffic, distance, delivery windows and vehicle capacity; no method or figures | E | O14 [F], O15 [T] |
| Geo zones, geofencing | Zone management; geofencing appears in the AWS listing only | W | O12 [F], O15 [T] |
| Driver app | Notifications on assigned packages, route and schedule changes; pickup, delivery and payment proof; electronic signature or photo; iOS and Android | A | O13 [F], O14 [F], O15 [T] |
| Live tracking | GPS of drivers and parcels; customer updates by SMS, email or app | W, A | O14 [F], O15 [T] |
| Capacity and load | Vehicle capacity and load distribution tracked in real time (claim) | W, A | O12 [F] |

### 2.4 Shipping gateway (OmniShip)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Carrier rules | Routes by weight, region, product type and SLA, or by cost. Example: "Orders above $500 go through premium courier"; frozen goods to temperature-controlled service | E, W | O27 [F] |
| Rate comparison | "Carrier comparison (rate, speed, SLA)" as a core function; quote call not described | W, API | O27 [F] |
| Labels and AWB | Generates AWB and label automatically; invoices and labels customisable | W | O27 [F] |
| Carriers | Aramex, SMSA, Barq, DHL, Fetchr named; "100+" carriers claimed | W | O27 [F] |
| Tracking and returns | "Real-time Tracking API"; webhooks keep order and warehouse in sync; return automation rules; COD as a service type (collection not explained) | API, E | O27 [F] |

### 2.5 POS

Smart POS for in-store sales, terminals, payment processing, loyalty and ZATCA-style invoices (A4 and thermal, QR). Claims only; the POS module page returned 404. Offline selling not found. (O35 [S], O16 [F] for the price line.)

### 2.6 Mobile apps

| App | Facts | Evidence |
|---|---|---|
| Hub Operations (App Store id1554310013) | Free; version 4.9.38; iOS 12.1 or later; listed language English; "Data Not Collected"; 77 MB; Business; no ratings yet. Notes: packaging material in packing (4.9.35); "regional language localisation support" (4.9.20). Year of latest release not shown | O24 [F] |
| Advanced Picker Plus | Same feature set as Hub Operations; no separate store listing found | O6 [F], O24 [F] |
| Google Play | No listing found by search | O24 [S] |
| Driver app | See 2.3; language and offline not stated | O13 [F] |

### 2.7 Channel connectors

Zid, Noon, custom channel, Shopify, Amazon, Trendyol are documented (section 3.3). Salla is named as a channel by Arab News but has no connector page found. Noon and Zid connectors both use the store and hub mapping of section 4.1 (inferred from the two setup pages).

## 3. API and integration anatomy

### 3.1 Public order API

- Base URL `https://prodapi.omniful.com`, version v1, HTTP bearer auth "by default every request must be authenticated" (O22 [T]).
- Two path families: `/sales-channel/public/v1/orders[...]` and `/sales-channel/public/v1/tenants/sellers/{seller_code}/orders[...]` (O22 [T]). The second puts the tenant in the path.
- Three GET operations are marked "to be deprecated on 30-07-2026" (O22 [T]). That date is before this read (2026-11-02), so the status is unknown.
- Listing shows only `200` responses, no pagination, rate-limit or webhook section. The OpenAPI file (`raw.githubusercontent.com/api-evangelist/...`) returned 404 (O38 [T]).
- Token issuance: "generated during the integration process"; no steps (O20 [F]).

### 3.2 Connector pattern (Zid, Noon, custom)

- **Zid** [F, O18]: prerequisites are an owner or admin account and an activation code sent to the store email. Zid steps: Settings > Shipping/Delivery Options, activate the partner app, turn on Inventory Synchronization and Automatic Order Dispatching (both required), enter the code in Omniful, choose Fulfilment+Shipping or Shipping Only, confirm the shipping service code. Omniful then needs hub mapping per Zid hub and status mapping; "Fetch Order Status" loads Zid statuses, and unmapped statuses stop orders syncing. Direction: orders Zid to Omniful (webhook only for the primary connected app); catalogue pulled periodically; inventory pushed from Omniful, which is the inventory master; shipment and tracking pushed back; cancellation pushed if enabled. Returns are not pushed back: the doc states that Zid has no API for return status.
- **Noon** [F, O19]: Omniful side: Settings > Apps & Integration > Sales Channel Apps, add store with an integration name; Noon Partner Portal: Authorize. Create a warehouse in the Warehouse Automation Tool; set "Act as your own integrator", then the webhook URL and webhook secret; processing time and delivery model are mandatory; activate the warehouse. The API user must hold the Project Owner role. Orders Noon to Omniful; SKUs must already exist in the master catalogue; stock and cancellations pushed back. Troubleshooting: Failed Logs and a Manual Sync button. For warehouses outside SA, EG and UAE the fulfilment partner creates the shipment (Noon rule, as stated).
- **Custom channel** [F, O20]: sellers create orders and products through API calls; access tokens; order-creation events to a seller URL; real-time inventory by webhook. No endpoints, payloads or status mapping on the page.
- **Shopify** [F, O23]: free install, listing in Arabic and English (machine translated), developer in Riyadh; sync features named ("order sync", "real-time sync", "stock reservation", "multi-location", "batch tracking", "expiry dates") without direction.
- **Salla** [F, O25 for the channel claim; O32 for absence]: Arab News names Salla as a sales channel (2024-02-24). The Salla help index read on 2026-11-02 has no Omniful article, and the Omniful Salla document URL returned 404 (O33 [F]). Unconfirmed.
- **Amazon, Trendyol** [F, O17, O21]: named as plug-and-play integrations; no setup steps read.

### 3.3 Shipping and carrier APIs

Carrier and tracking calls are on the gateway side (O27 [F]). No carrier API contract, idempotency rule or retry policy read.

### 3.4 Webhooks

- Outbound: order-creation events to a seller URL and real-time inventory updates by webhook (O20 [F]). Event names, payloads, signing and retries not found on Omniful's pages.
- Inbound (Noon): Omniful exposes a webhook URL and a webhook secret entered in the Noon store (O19 [F]).
- A third-party ERP guide names `order.*` and `purchase.*` as inbound event families and a "Webhook Secret Key" (O37 [S]). Not verified.

### 3.5 Sandbox, limits, SDKs, versioning

Not found: no sandbox account, rate-limit statement, SDK list or changelog was readable (O1, O17 [F]; docs portal not readable).

### 3.6 Build signals

- Senior Golang Developer, Gurgaon, posted 2025-08-26 (O28 [F]): Golang; PostgreSQL, MongoDB, Redis; Kafka or RabbitMQ "a plus"; Docker and Kubernetes; AWS or GCP; REST, gRPC and WebSockets; microservices and CI/CD.
- React Frontend Engineer and a Data Scientist, both Gurgaon (O29 [F]). Technical Lead Golang lists Kafka, RabbitMQ or NATS and event-driven architecture (O30 [S]).
- Riyadh roles: Implementation Consultant and Business Development (O29 [F]).
- Inferred: a Go microservice backend with a React front end, event messaging, and Riyadh-facing implementation teams. Postings are recruiter text and may be stale.

## 4. Operational model

### 4.1 Tenancy and hierarchy

- Seller (path `seller_code` in the tenant API, O22 [T]) to sales-channel store (connector mapping, O18, O19 [F]) to hub or warehouse (mapped per channel, O18 [F]).
- Ours: account to sites (`branch`, `warehouse`, `both`), with membership site scoping (ADR-0018; domain-model §2 and §3.1 site table).
- Whether Omniful has a multi-tenant database or per-tenant deployments is not documented (inferred from the seller path only).

### 4.2 Roles and approvals

- "Configurable rules, roles, approvals, and process flows" (O3 [F]). No role catalogue, permission matrix or approval list found.
- Noon connector needs the Project Owner role on the user (O19 [F]).

### 4.3 Billing

Two price sources, both USD, both undated, and they disagree on TMS.

- **Pricing deck** [F, O16, PDF read 2026-11-02, undated, "partners" deck]: setup fee $4,000 per module; OMS $900/month up to 25K orders ($0.036 per order) or $1,500/month up to 50K ($0.030), extra orders $0.10 down to $0.05 above 100K; WMS $500/month for 5 users, $800 for 10, $1,200 for 20, $2,000 for 50, extra user $30/month; TMS $500/month up to 5K shipments ($0.10 each), up to 50K at $2,000/month ($0.04), above 50K +$0.03; POS $500/month for 2 terminals up to $1,500 for 10; bundles save 20% to 25% of setup fees. The deck also claims "reduce picking errors by up to 80%" and "process orders 5x faster" (claims).
- **AWS Marketplace TMS listing** [F, O15, no date]: Essential $199/month and $0.40 per unit; Professional $499 and $0.25; Enterprise $1,999 and $0.10; 1-month term; 12, 24 and 36-month terms with discounts up to 25%; "we do not offer refunds"; SaaS, no API delivery option.
- **Shopify app** [F, O23]: free install, "no additional fees currently", fees billed in USD.
- Inferred: meters are per order, per user, per shipment and per terminal, with a setup fee for each module, so pricing scales by module count.

### 4.4 Automation

- Named rule types: hub selection (routing factors), carrier selection (weight, region, product type, SLA, cost), order tags (origin city, country, weight, package count), partial fulfilment (automatic), return automation rules (O27, O9, O7, O10 [F]).
- No rule builder, trigger list or action list is described. Contrast ShipHero's 58 triggers and 64 actions (shiphero teardown H12, shape only).
- Top-level claim: "workflow automation from a single dashboard" (O1 [F]).

### 4.5 Allocation and holds

- Routing picks one hub. No split of one order across hubs is stated, except partial fulfilment of in-stock items (O7, O10 [F]).
- Shortage: in-stock items go first; the page does not say what happens to the rest (O10 [F]).
- Holds: no hold concept, reason or release action documented. "Approve Order" (O22 [T]) and "review and approval" (O23 [F]) suggest an approval gate before processing (inferred).
- Sync holds: an unmapped channel status stops the order from syncing (O18, O19 [F]).

### 4.6 Exceptions and operations

- Order logs endpoint per order (O22 [T]); Failed Events and file-processing logs (O19 [F]); Noon Failed Logs and Manual Sync (O19 [F]).
- Pending order report for stuck orders (O4 [F]).
- Stock sync: Omniful is the inventory master for Zid and Noon (O18, O19 [F]); ours is one-way channel stock via outbox (ADR-0013). Same direction, same master.

### 4.7 Company, customers, market

- Founded 2022; CEO and co-founder Mostafa Abolnasr; co-founder Alankrit Nishad (O25 [F]).
- Seed $5.85M, 2023, led by VentureSouq; 500 Global, DASH Ventures and Jahez Group named (O31 [S]).
- HQ Riyadh (Shopify developer address, O23 [F]); census row says craft.co [S].
- Arabic: `omniful.ai/ar` is Arabic-primary, with OMS, WMS, TMS, "أومني شيب" (OmniShip), inventory, returns and reports (O2 [F]). The census row said the homepage showed no Arabic UI; that is true of the English homepage, not of the Arabic site.
- Aramex partnership (2024-05-13): Omniful OMS for Aramex e-commerce fulfilment; rollout MENA first, then US, Europe and Asia; no volumes stated (O26 [F]).
- Customers: Panda, Spar and Sadhan (O31 [S]); Laverne Group KSA case: delivery in Riyadh from 4 to 6 days to 2 to 3 hours (vendor blog, 2025-04-25, O27 [F]).
- Compliance: no security, trust or data-residency page found (O39 [S]). PDPL position not found.

## 5. Mapping to our roadmap and domain model

Borrow? values: **yes** (take the shape), **adapt** (take the idea with changes), **no** (reason and ADR given), **already** (we have it). ADR references are to `adr/`; order ids to `docs/roadmap.md`.

| # | Feature | Omniful | eeasy-logistics today (order id or gap) | Borrow? |
|---|---|---|---|---|
| 1 | Multi-hub | Hubs, multi-hub management (O4) | Sites `branch`/`warehouse`/`both` (ADR-0018); PLAT-12 | already |
| 2 | Inter-hub stock transfer (STO) | STO between hubs (O4) | Gap. Movements are per site; totes move by transfer batch only (domain §4.1 W-2) | adapt: new WMS-9 (section 6) |
| 3 | Inbound receiving | Gate entry, GRN, PO and STO (O3, O4) | WMS-4 (PO, receipts, over-receipt approval, put-away) | already; gate entry no (no detail, owner question) |
| 4 | Putaway | Rule-based location assignment (O3) | WMS-4 put-away, no rules | no for now; revisit at pilot |
| 5 | Picking methods | Single, multi-order, zone, route (O5, O6); wave and cluster [S] | WMS-6 pick tasks, tote per order (domain §4.6) | adapt: waves after pilot volume data, as ShipHero row 5 |
| 6 | Partial fulfilment | In-stock lines first (O10) | Gap. Short pick puts the order `on_hold` (domain §4.12, W-9) | yes: amend WMS-6 (section 6) |
| 7 | Order holds and approval | Approve endpoint and review step (O22, O23); no hold model | Gap. `on_hold` exists only for stock and short picks; no hold flag | adapt: new DEL-19 (section 6) |
| 8 | Order routing to hub | Factors: stock, hub capacity, shipping cost (O7) | Gap for cross-site choice; allocation is per site over pickable locations (domain §4.10) | adapt after the multi-site answer (section 7) |
| 9 | Order tags | Labels and conditional tags (O9) | Gap | adapt: new DEL-20 (section 6), bounded, no general rules (ADR-0006) |
| 10 | Packing | Slips, validation, packaging material (O5, O24) | WMS-7 packages, measured weight, labels (ADR-0014); packaging material not modelled | already; packaging material no (no demand evidence) |
| 11 | Cycle counts | Scheduled and ad hoc, audit trail (O3) | WMS-5 count sessions; variances above threshold need another approver (domain W-16) | already |
| 12 | Lots, batches, expiry | Batch report, expiry dates (O4, O23) | WMS-2 lots with expiry date; tracking modes (domain §4.2). FEFO allocation not stated | already; check FEFO in WMS-6 (inferred gap) |
| 13 | Serial numbers | Serialisation article (O4) | WMS-2 serial tracking mode | already |
| 14 | Kitting and assembly | Named, no text (O3) | Gap | no: no evidence of demand; owner question |
| 15 | Pallets | Break and regroup pallets (O5) | Gap | no: no evidence of demand; owner question |
| 16 | Warehouse mobile app | Hub Operations and Picker Plus (O5, O24), iOS, English listing | Gap. Warehouse staff use web screens; WEB-15 is "scanner-first" on web (web.md, WEB-15) | adapt: new WMS-10 (section 6) |
| 17 | Returns | Customer and courier-partner returns, QC (O11) | DEL-18 returns and exchange; WMS-8 dispositions restock, quarantine, scrap; failed attempts to `failed` then `returned` (domain §3.13) | already, and more explicit on disposition |
| 18 | Dispatch and assignment | Assign deliveries to drivers (O14) | DEL-6 manual dispatch, DEL-10 auto-dispatch, DEL-16 routing (INT-6, VROOM, ADR-0010) | already |
| 19 | Route optimisation | Traffic, distance, windows, capacity (O14, O15) | INT-5, INT-6 (deferred to end of wave, A-24) | already (planned) |
| 20 | Driver app | Notifications, proofs, COD payment proof, iOS and Android (O13, O15) | DRV-1 to DRV-5; offline outbox (ADR-0008); COD with PIN (ADR-0007, ADR-0034) | already, stronger on offline and custody |
| 21 | Proof of delivery | E-signature or photo (O14) | DEL-7 proofs by signed upload | already |
| 22 | Customer tracking | Live tracking (O14, O15) | DEL-8 tracking token, public view (domain D-24) | already |
| 23 | Customer messages | SMS, email, app (O14) | INT-3 WhatsApp templates only; no SMS before wave 3 (ADR-0037; ADR-0041) | no: ADR-0037 and ADR-0041 decide the channel |
| 24 | COD | COD payment proof in driver app; COD service type (O13, O27) | DEL-7, DEL-11 custody; ADR-0017 digital COD | already |
| 25 | Carrier choice by rules | Rules on weight, region, product, SLA, cost (O27) | INT-8 Eeasy shipping carriers; `quote` already in the port (integrations §2.7) | adapt: bounded rules over `quote`; no marketplace of carriers (ADR-0014; ADR-0005 for fleets) |
| 26 | Carrier count | "100+" carriers claimed (O27) | Gap by design: Eeasy shipping is the carrier API (ADR-0014) | no: ADR-0014 |
| 27 | Channel connectors, Zid and Salla | Zid steps with mapping, activation code (O18); Salla unconfirmed (O25, O32) | INT-11 partner apps, install and OAuth; INT-12 channel stock (ADR-0013) | yes: copy the mapping-before-sync screen and failed-log view (INT-11) |
| 28 | Channel connectors, Noon, Amazon, Trendyol, Shopify | Documented (O19, O17, O21, O23) | Not on the roadmap; scope is last-mile and WMS (ADR-0002) | no for now: owner question on channel scope |
| 29 | Public API keys | Bearer token; seller in path (O22) | INT-9 keys, sandbox keys; account from token (ADR-0025) | already; no path tenant (ADR-0025) |
| 30 | Webhooks | Order and inventory webhooks; webhook URL and secret (O19, O20) | INT-10 signed with Standard Webhooks (ADR-0040, ADR-0030) | already, stronger spec |
| 31 | Sandbox and API docs | Not found (O1, O17) | INT-9 sandbox keys; OPS-7 docs | already (planned); nothing to copy |
| 32 | Analytics | Reports and dashboards, SLA trends (O3) | DEL-17 SLA and scorecards; reporting views (domain-model §3.1, doc 5 §9) | already (planned) |
| 33 | POS | Smart POS, terminals (O16, O35) | Out of scope (ADR-0002) | no: ADR-0002 |
| 34 | ZATCA e-invoicing | Claimed for OMS and POS (O35 [S]) | Gap. No ZATCA item in roadmap or ADRs (grep at 1e0c184) | owner question; proposed TAX-1 (section 6) |
| 35 | Status mapping before sync | Unmapped status stops sync; mapping is set per connection (O18, O19) | Gap in INT-11 text (no mapping gate stated) | yes: add mapping gate to INT-11 (section 6) |

## 6. Proposed order amendments and new orders

Eight at most. None is an order until the owner rules; each names its dependencies and ADR cost.

1. **Amend WMS-6 (partial fulfilment).** Let a fulfilment order ship its allocated lines and keep the rest as a backorder line, with an explicit flag per order; keep W-9 for the short pick. Evidence: O10 [F] (concept only). Owner decision: default on or off, and whether one order may ship in two packages. ADR: domain §4.12 change, needs a new ADR if the state machine changes.
2. **New DEL-19 (order holds and release).** A hold is a flag with a reason code, set by staff or a rule, released by staff; a hold blocks offers and assignment but never changes an event already written; every set and release is audited (PLAT-7). Depends on DEL-2, PLAT-7. Evidence: O22 [T] approve endpoint; O23 [F] review and approval; ShipHero H14 shape. ADR: new ADR (order state machine, domain §3.13).
3. **New DEL-20 (order tags).** Labels set by staff, and conditional tags on origin city, country, weight and package count. Bounded: no trigger engine (ADR-0006). Depends on DEL-2. Evidence: O9 [F]. ADR: none if tags are labels only.
4. **New WMS-9 (inter-site transfer orders).** A transfer order between two sites of one account, moving stock through `transit` with movement batches and two receipts (ADR-0018). Depends on WMS-1, WMS-3. Evidence: O4 [F] (STO title and summary). Owner decision: is multi-site stock in the pilot?
5. **Amend INT-8 (carrier choice by rules).** Choose the Eeasy shipping service from rules (weight, region, COD, service) over the existing `quote` port before `createShipment`; log the rule that chose it. Evidence: O27 [F]. ADR: check against ADR-0014 wording (inferred), owner to rule.
6. **New WMS-10 (warehouse scanner app).** Pick, pack, put-away and count on a handheld, Arabic and English, offline-capable on the DRV-2 outbox pattern. Depends on WMS-6, WMS-7, DRV-2 pattern. Evidence: O5 [F], O24 [F]. ADR: ADR-0004 and ADR-0021 put the driver app in the monorepo; a second app needs a new ADR. Owner decision.
7. **New TAX-1 (ZATCA e-invoicing for merchant orders), not yet an order.** Scope, invoice numbers and QR, and whether any invoice is issued by eeasy or by the merchant. Evidence: O35 [S] only. Needs the owner's regulatory scope before any order exists.
8. **Amend INT-11 (mapping gate before first sync).** Before the first order sync, a connection must map every external status and the hub or warehouse, with a failed-log view and a manual re-sync button. Evidence: O18, O19 [F]. Reuses PLAT-8 dead letters. ADR: none.

## 7. Unanswered (owner questions)

1. Omniful's auth flow, webhook event catalogue, signing, retries, rate limits, sandbox and versioning: the developer portal was unreadable. Owner may open a trial or ask Omniful sales.
2. Omniful's order hold model, allocation fallback and split rules: no page describes them.
3. Whether the 30-07-2026 deprecation on the orders API happened (O22 [T]).
4. Price: the deck (undated) and the AWS listing disagree on TMS. Which is current; any SAR price (none shown in USD sources).
5. Salla: is there a live Omniful connector? Arab News says yes (2024); no connector page was found.
6. Offline behaviour and languages of Hub Operations and the driver app: App Store lists English only; no Play listing found.
7. Security, certifications, data residency and PDPL: no page found.
8. Customers in KSA beyond the search summaries (Panda, Spar, Sadhan).
9. ZATCA: Omniful claims it; does our roadmap need TAX-1? Owner ruling needed.
10. Kitting and pallets: do KSA merchants need them? Owner question; no evidence here.
11. Census correction: the census row says no Arabic UI on the Omniful site; `/ar` is Arabic-primary (O2 [F]). Lead to correct the census row.
12. Stack beyond job posts: no engineering blog found; the stack is inferred.

## 8. Source registry

Read date for every row: 2026-11-02, unless the row gives an article date. [F] fetched; [S] search summary; [T] third-party.

| ID | Source | Grade | Read / dated |
|---|---|---|---|
| O1 | https://omniful.ai (homepage; modules, claims, integrations Amazon and Trendyol) | F | 2026-11-02 |
| O2 | https://www.omniful.ai/ar (Arabic site) | F | 2026-11-02 |
| O3 | https://www.omniful.ai/warehouse-management (WMS page) | F | 2026-11-02 |
| O4 | https://www.omniful.ai/knowledge-base/warehouse-management (25 article titles) | F | 2026-11-02 |
| O5 | https://www.omniful.ai/knowledge-base/warehouse-management/advanced-hub-operations-app | F | 2026-11-02 |
| O6 | https://omniful.ai/knowledge-base/warehouse-management/advanced-picker-plus-app (returned Hub Operations content) | F | 2026-11-02 |
| O7 | https://omniful.ai/knowledge-base/order-management/feature-smart-order-routing | F | 2026-11-02 |
| O8 | https://www.omniful.ai/knowledge-base/order-management (19 OMS titles) | F | 2026-11-02 |
| O9 | https://www.omniful.ai/knowledge-base/order-management/feature-order-tags | F | 2026-11-02 |
| O10 | https://omniful.ai/knowledge-base/order-management/feature-partial-order-fulfilment | F | 2026-11-02 |
| O11 | https://www.omniful.ai/knowledge-base/order-management/feature-return-order-processing | F | 2026-11-02 |
| O12 | https://www.omniful.ai/knowledge-base/transport-management-system (nine TMS features) | F | 2026-11-02 |
| O13 | https://www.omniful.ai/knowledge-base/transport-management-system/feature-advanced-driver-app | F | 2026-11-02 |
| O14 | https://www.omniful.ai/knowledge-base/transport-management-system/feature-last-mile-delivery | F | 2026-11-02 |
| O15 | https://aws.amazon.com/marketplace/pp/prodview-nbrqcgim4fb5a (TMS listing, undated) | T | 2026-11-02 |
| O16 | https://docs.omniful.ai/partners/omniful-pricing-packages.pdf (pricing deck, undated; text via pdftotext) | F | 2026-11-02 |
| O17 | https://www.omniful.ai/docs/integration (integration docs index) | F | 2026-11-02 |
| O18 | https://omniful.ai/docs/integration/zid-integration-document | F | 2026-11-02 |
| O19 | https://www.omniful.ai/docs/integration/noon-integration-document | F | 2026-11-02 |
| O20 | https://www.omniful.ai/knowledge-base/plug-and-play-integrations/feature-custom-sales-channel | F | 2026-11-02 |
| O21 | https://www.omniful.ai/knowledge-base/plug-and-play-integrations | F | 2026-11-02 |
| O22 | https://apis.apievangelist.com/store/omniful-inc-orders-api/ (third-party profile of the Orders API) | T | 2026-11-02 |
| O23 | https://apps.shopify.com/omniful?locale=ar (Shopify listing; launch 2025-05-19) | F | 2026-11-02 |
| O24 | https://apps.apple.com/app/id1554310013 (Hub Operations) | F | 2026-11-02 |
| O25 | https://www.arabnews.com/node/2466001/amp (article 2024-02-24) | F | 2026-11-02 |
| O26 | https://enterpriseam.com/logistics/2024/05/13/aramex-omniful-set-to-deploy-oms-in-e-commerce-fulfillment-services/ (2024-05-13) | F | 2026-11-02 |
| O27 | https://omniful.ai/blog/shipping-gateway-integration-mena (article 2025-04-25) | F | 2026-11-02 |
| O28 | https://www.omniful.ai/careers/senior-golang-developer (posted 2025-08-26) | F | 2026-11-02 |
| O29 | https://www.omniful.ai/careers (five open roles) | F | 2026-11-02 |
| O30 | https://jobs.hub71.com/companies/omniful-2/jobs/56681954-omniful-senior-golang-developer-microservices-architecture (Technical Lead listing via search) | S | 2026-11-02 |
| O31 | https://www.wamda.com/ar/2023/12/omniful-raises-5-85-million-seed-mena-expansion-arabic (seed, investors; customers via press search) | S | 2026-11-02 |
| O32 | https://help.salla.sa (Salla help index; no Omniful article in the first 100,000 characters) | F | 2026-11-02 |
| O33 | https://www.omniful.ai/docs/integration/salla-integration-document (404) | F | 2026-11-02 |
| O34 | https://www.omniful.ai/docs/integration/shopify-integration-document (404) | F | 2026-11-02 |
| O35 | https://www.omniful.ai/partners-resources/omniful-pos-module (404); POS claims from https://www.omniful.ai/smart-pos-system and https://www.omniful.ai/use-case/tax-e-invoicing | S | 2026-11-02 |
| O36 | Census row: origin/docs/ksa-platform-census:docs/research/ksa-platform-census-2026-11.md | doc | 2026-11-02 |
| O37 | Third-party ERP integration guide naming `order.*` events and a webhook secret (search summary; not fetched) | S | 2026-11-02 |
| O38 | https://raw.githubusercontent.com/api-evangelist/omniful-inc/refs/heads/main/openapi/omniful-inc-orders-api-openapi.yml (404) | T | 2026-11-02 |
| O39 | Security and compliance search: no Omniful page found; results were other companies | S | 2026-11-02 |

Our-side documents (repo at `1e0c184`): `docs/roadmap.md` §1.2 to §1.5; `docs/architecture/domain-model.md` §2, §3.1, §3.13, §4.1 to §4.16, §6; `docs/architecture/integrations.md` §2.7, §2.8, §3; `docs/architecture/web.md` (warehouse staff on `/wms/*`); `adr/0002`, `0004`, `0005`, `0006`, `0007`, `0008`, `0011`, `0013`, `0014`, `0016`, `0017`, `0018`, `0021`, `0025`, `0030`, `0037`, `0040`, `0041`.
