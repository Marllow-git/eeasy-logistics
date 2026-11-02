# Feature book, chapter 01: Orders and intake

Dated 2026-11-02. Branch `docs/feature-book-01-orders` from `origin/main` (`6ca087e`). Repo facts were read at `1e0c184`; every repo path cited here is unchanged at `6ca087e`. Research for the lead: it changes no roadmap row, ADR, contract or plan. Proposals are marked **proposed** and are not orders.

## Summary for the lead

1. Wave 1 covers the order core on paper: four kinds, gap-free numbers, manual create and edit, the state machine under `If-Match`, the event log, geocoding and coverage at intake, and CSV import (DEL-2, DEL-3). DEL-2 is in flight on `feat/DEL-2-orders-intake` (3f9d62b, unmerged); DEL-3 has not started. `main`'s DEL-2 plan §8.2 is an empty placeholder.
2. No roadmap row names order holds, service levels with cutoffs, bulk actions, dangerous-goods or cold-chain flags, COD eligibility or fee rules, delivery instructions, or labels for orders outside WMS.
3. The contract's `getOrderLabel` (x-wave 1) returns an own-fleet label PDF that no roadmap row produces.
4. Shape changes proposed against the roadmap: holds as flags with reason codes and audit (new ADR, because §3.13 changes); approval as a named state with fail, postpone and return outcomes; tags as labels only, no rule engine; service levels per site with the price left to Q-33; bulk actions as WEB-5 calls to the per-order doors.
5. Document defects: roadmap DEL-2 says "auto-override" (intent: auto-accept); `Order.pending_reason` on `main` lacks `needs_location` (the in-flight branch adds it); `awaiting_review` is in the contract and data.md with no rule that sets it; the order has no parcel count, yet VROOM and vehicle capacity count parcels while driver capacity counts orders (D-10).
6. ADR-0007 credits Logestechs with a COD chain, settlement report and deficit ledger that no public page read shows. Do not cite it as evidence until the 2026-09-21 source is found.
7. The Friday and Saturday weekend, in force since 29 June 2013, is confirmed. Ramadan delivery hours and Saudi delivery-time norms have no source; they stay open.
8. `cod_not_allowed` is `400` in DEL-2's plan and `422` in `errors.md` and the contract; the in-flight branch answers `422`.
9. Proposed order ids collide across notes: DEL-19 means intake hardening in FC, order holds in OM, and service levels in WS. The lead assigns ids.
10. Owner questions: 19 under "Unanswered"; the decision-relevant ones are Q-4, Q-6, holds, multi-parcel, service levels and dangerous goods.

## Method and conventions

- Repo facts come from `main`, read 2026-11-02 at `1e0c184` (cited paths unchanged at `6ca087e`). Branch notes come from `origin/docs/feature-coverage`, `origin/docs/platform-teardowns` and `origin/feat/DEL-2-orders-intake`. Each bracketed tag resolves in the source list at the end.
- Teardown facts keep the grade their note gave: F fetched, S search summary, T third party, I inference. Facts from the repo are stated as the repo states them.
- Status is against the roadmap on `main`: Covered, Partial, Missing, Excluded. "In flight" means on the DEL-2 branch only.
- Aspect 9 gives the shape already decided in an ADR or domain section, or **proposed** where none exists.

## 1 Features

### 1.1 Order kinds (delivery, return pickup, exchange, pickup request)

- **(1) Definition and user goal.** A dispatcher or merchant creates one order whose kind says what the stop is: deliver to the recipient, collect from the recipient, swap in one stop, or collect from a third party to the site. One record and one state machine serve all four [DM §3.1, §3.13].
- **(2) Workflow.** Kind is set at create; `UpdateOrderRequest` has no kind field [OAS-SD]. Delivery runs assigned, picked_up, out_for_delivery, delivered. A return or exchange is "delivered" at the kind's destination [DM §3.1]. For `pickup_request` the destination is the site; the domain has no receipt state there except check-in to `returned` (inference from [DM §3.13]). Failed and attempted apply to every kind.
- **(3) Business rules and edge cases.** A non-zero `cod_amount` is allowed only on `delivery` and `exchange` (D-4, `cod_not_allowed`) [DM §3.18; ERR]. The public intake will take the same kind field: `CreateOrderRequest` is shared with public intake [OAS-C]. Returns and exchanges are a standard KSA e-commerce flow [FOD §2 S1, S2]. Logestechs prices a `SWAP` and a `BRING` with two money fields, collect from and pay to the receiver [LT D5].
- **(4) Data.** `del_orders.kind` with a CHECK over the four values [DATA §2.1]. Invariant D-4 [DM §3.18]. Recipient data is kept for the life of the account (Q-37) [DATA §10].
- **(5) Surfaces.** Merchant web: create form and `kind` list filter (WEB-5) [RM WEB-5; OAS-SD listOrders]. Driver app: order detail, kind label not specified [RM DRV-4]. Recipient messages: four wave-1 templates, none kind-specific [INT §5.1]. API: wave 4 [RM INT-9].
- **(6) Permissions, roles, audit.** Create `delivery.orders.create`; read `delivery.orders.read`; site scope applies [OAS-SD]. Audit row `delivery.order.created` with kind and site, no recipient data [PLAN §2.3].
- **(7) Dependencies.** Site kind `branch` or `both`, else `site_kind_mismatch` [OAS-SD createOrder; ERR; ADR-0018]. Zones and coverage (DEL-1). Dispatch for pickups (DEL-6). Returns into stock (WMS-8). No external provider.
- **(8) Metrics and reporting.** No metric row. Counts by kind and status belong to DEL-17 reports over views (wave 4) [RM DEL-17].
- **(9) Market and chosen shape.** Torod runs returns and exchanges as a separate service [FOD §2 S1, S2]; Logestechs has return routes and bundle returns [LT §1.6 L8]. Chosen (existing): one order with kind and item direction, no separate return entity [DM §3.1, §3.2]. The reason given in the domain is one state machine and one event log for all kinds. ADR: none; the domain model is the decision. Exchange shape stays open (Q-4).
- **(10) Roadmap mapping.** Partial. DEL-2 creates all four kinds (wave 1, in flight); DEL-18 makes return and exchange flows work end to end (wave 4); pickup scheduling has no row (proposed P2 in FOD §6, wave 2). Owner: Q-4, Q-6.

### 1.2 Items and multi-parcel

- **(1) Definition and user goal.** The order lists what the parcel holds, so the merchant reconciles declared values, returns and COD totals. A multi-parcel order is one order shipped as several parcels, each with its own label or tracking number.
- **(2) Workflow.** Items are set at create and locked from `picked_up` (`order_locked`) [OAS-SD updateOrder; DM §3.2]. Plan limits: at most 200 items, quantity 1 to 9999 [PLAN §2.3]. Parcels for multi-box shipments are WMS packages, one per box, measured at pack [DM §4.7; ADR-0014]. An own-fleet order has no parcel entity. A short pick puts the WMS fulfilment order on `on_hold` [DM §4.12].
- **(3) Business rules and edge cases.** Item names are mandatory in Arabic and English [OAS-C OrderItem; ADR-0016]. `declared_value` is in halalas; `direction` defaults to `out`, `in` for return and exchange [DM §3.2]. The `Order` schema has no parcel count [OAS-C Order]. VROOM takes parcel count as the stop's load and vehicle capacity is in parcels [INT §6.4; RM DEL-4], while driver capacity counts open assignments, i.e. orders [DM D-10]. Bulky multi-box orders are common in furniture and appliances (inference [FOD §2]).
- **(4) Data.** `del_order_items`: `order_id`, `name_ar`, `name_en`, `sku`, `quantity` (CHECK > 0), `direction` (CHECK), `wms_product_id` (opaque), `declared_value`, `currency`; index `(account_id, order_id)` [DATA §2.1]. `wms_packages.delivery_order_id` is an opaque reference [DM §4.7]. Items are not in the personal-data inventory [DATA §10].
- **(5) Surfaces.** Merchant web order detail (WEB-5). Driver app order detail and pickup by scan (DRV-4) [RM DRV-4]. Packing bench (WEB-15). Recipient page shows no items (D-24) [DM §3.18]. API at wave 4.
- **(6) Permissions, roles, audit.** `delivery.orders.create` and `delivery.orders.read` [OAS-SD]. Item changes audit the changed keys, not values [PLAN §2.8]. Packing permissions belong to WMS and were not read.
- **(7) Dependencies.** `wms_product_id` refers to WMS products (WMS-2) [DM §3.2]. Multi-parcel for own-fleet orders would depend on WMS-7 packages (ADR-0014). Carrier shipment per package at pack (INT-8).
- **(8) Metrics and reporting.** Items per order and parcels per order are not defined. Capacity counts orders (D-10), so a five-parcel order takes one capacity slot today [DM D-10].
- **(9) Market and chosen shape.** Torod, Shipox, OTO and Salla: no multi-parcel feature found, unverified [FOD §2]. ShipHero ships several packages per order with containers [SH §1.5 D6, D8]. Wasal stops carry package count and weight [WS §2.2]. Chosen (existing): parcels are WMS packages (ADR-0014); own-fleet multi-parcel is not decided. **Proposed:** a `parcel_count` planning field on the order (default 1) so VROOM and capacity read one number; it needs an amendment to [DM §3.1] and [OAS-C Order].
- **(10) Roadmap mapping.** Items: Covered (DEL-2, wave 1). Multi-parcel: Partial (WMS-7 packages, wave 3, inside WMS); missing for own-fleet orders. Owner: multi-parcel under one order before WMS (new); source of parcel count (new).

### 1.3 Recipient and address

- **(1) Definition and user goal.** Capture who receives the parcel and where, so the driver can find them and the zone check can run. Recipient: name, E.164 phone, alternate phone, preferred language `ar` or `en`. Address: text, city, district, National Address short code, point, pin source and geocode confidence [OAS-C Recipient, Address; DM §3.1].
- **(2) Workflow.** At create the geocoder runs before the transaction. A point sent with the request wins (`manual`, confidence 1.0). Else the short code goes through `lookupShortCode`; else free text with city goes through `geocode`. Confidence below 0.6, or not found, leaves no reliable point: the order is created and listed as "needs location" [INT §6.2; PLAN §2.4; FB §8.2 #5]. Recipient pin requests use a 48-hour link, from wave 2 [INT §5.1; RM DEL-14, WEB-11]. A higher-trust pin is never overwritten by geocoding [INT §6.2].
- **(3) Business rules and edge cases.** Short code pattern `^[A-Z]{4}[0-9]{4}$` [OAS-C Address]; SPL describes four letters and four digits, the digits being the building number [HH §2.1, S]. Hudhud's lookup returns Arabic and English addresses [HH §1.7, S]; our `Address` has one `text` field and no building, street or unit fields [OAS-C Address]. E.164 pattern `^\+[1-9][0-9]{7,14}$` [OAS-C Recipient]; a Saudi mobile check is not in DEL-2 [FOD §2, Torod S1]. Intake-triggered pin requests wait for the quiet hours, 22:00 to 08:00 Asia/Riyadh [INT §5.4]. Business dates use Asia/Riyadh [DM D-11].
- **(4) Data.** Recipient and address columns on `del_orders`; `address_point geometry(Point,4326)` with GiST; `geocode_confidence real` [DATA §2.1]. Cache `core_geocode_cache`: 30 days for a hit, 24 hours for not found [INT §2.2]. Recipient data is kept for the life of the account (Q-37, open) [DATA §10]. Audit and outbox carry no recipient name or phone [PLAN §2.3]. In-flight: idempotency replays keep the `Order` body with recipient data for 24 hours [FB §8.3].
- **(5) Surfaces.** Merchant web: detail and a "needs location" view [INT §2.2]; pin dialogs (WEB-11, wave 2). Driver app: address on the run and the stop. Recipient page: no address (D-24). Messages carry the merchant name, order number and, per template, driver first name, ETA window and tracking link; never the address [INT §5.1]. Platform console: support reads only.
- **(6) Permissions, roles, audit.** Create and edit `delivery.orders.create`; pin `delivery.orders.dispatch` [OAS-SD pinOrderAddress]. A pin audit row records the source. The geocoder adapter sends address text and city only, never account ids or recipient names [INT §6.1].
- **(7) Dependencies and integrations.** INT-2 geocoder chain: SPL official API, Sayyar mirror, Hudhud fallback, stub [INT §2.2]. DEL-1 zones. DEL-14 pin tokens. Hudhud agreement, quota and price open (Q-28) [RM §4].
- **(8) Metrics and reporting.** Geocode outcomes by source and outcome: `geocoder_calls_total{source,outcome}` [FB §8.2 #21]. Count of needs-location orders on the dispatcher view. The 0.6 threshold is a constant until an account setting exists [PLAN §7 #2]. Assumed cost: about 700 geocode calls per 1,000 orders [INT §6.6].
- **(9) Market and chosen shape.** Torod shows missing-address alerts and suggests districts [FOD §2 S1]. Logestechs accepts ids or exact English or Arabic names and asks for a city when a village name is shared [LT D5]; it lists National Address integration [LT L3]. Chosen (existing): geocode at intake, short code first, confidence stored, zone on the point [INT §6.2; ADR-0015]. **Proposed:** a missing-part and district prompt at intake (FC DEL-19, wave 2; FOD P1 suggests wave 1); bilingual address fields.
- **(10) Roadmap mapping.** Partial. Covered: INT-2 (wave 1; built per INT §2.2), DEL-2 (in flight). Missing: missing-part and district prompts (proposed), bilingual address (no row). Owner: Q-28 (Hudhud terms), Q-37 (retention), bilingual and building fields (new).

### 1.4 COD and payment method

- **(1) Definition and user goal.** The amount the driver collects on delivery, and how the recipient pays: cash, card, mada or wallet. The merchant needs the amount and the method to reconcile [OAS-C Order, Money; DM §3.11].
- **(2) Workflow.** `cod_amount` is set at create and editable until `picked_up`; every change is audited with before and after [OAS-SD updateOrder]. At delivery the driver records one CodCollection per payment; amounts must sum exactly to `cod_amount` in the same transaction (D-7; `cod_amount_mismatch`) [DM §3.18; ERR]. Cash starts with custody `collected` in the driver's hands; card, mada and wallet start and stay `not_held` (D-18) [DM §3.11, §3.16]. Digital methods wait for owner approval (ADR-0017).
- **(3) Business rules and edge cases.** Non-negative integer halalas; non-zero only on `delivery` and `exchange` (D-4). `allowed_cod_methods` defaults to `[cash]` [OAS-C AccountSettings]. A non-cash collection needs an external reference (`method_not_allowed`) [ERR]. In-flight: COD above 100,000,000 halalas is refused at the body [FB §8.2 #25]. Secondary KSA benchmarks, to verify: Salla hides COD below SAR 20 and caps the waybill at SAR 1,000; carrier COD fees per Salla are SAR 8 plus 1 or 2 percent; mada refunds within 30 days [FRC summary item 7; FRC S1, S2].
- **(4) Data.** `del_orders.cod_amount bigint` with CHECK (D-4) [DATA §2.1]. CodCollection is insert-only: amount, method, external reference [DM §3.11]. Custody entries are append-only (D-19). Retention: ledger rows are append-only, and the account purge deletes them with the account [DATA §10].
- **(5) Surfaces.** Merchant web COD panel (WEB-5) [RM WEB-5]. Driver app: deliver with COD split and the cash tab (DRV-4) [RM DRV-4]. Recipient message `order_delivered` carries the COD amount [INT §5.1]. Webhooks: wave 4 (INT-10).
- **(6) Permissions, roles, audit.** `delivery.cash.read` for collections [OAS-SD listOrderCollections]. Cash actions need the driver's cash PIN (ADR-0034) and a cashier for handovers [DM §3.11; ERR]. Amount changes audited [OAS-SD updateOrder].
- **(7) Dependencies and integrations.** DEL-7 collections (wave 1); DEL-11 handovers and custody, DEL-12 deposits (wave 2) [RM]; ADR-0007 custody model; ADR-0017 digital COD gate; `PaymentPort` not built (no adapter, no credentials) [INT §2.9].
- **(8) Metrics and reporting.** The cash report closes per site and business date only when every collection is with cashier or bank (D-21) [DM §3.11, D-21]. A per-order expected-against-collected view for the merchant is missing (FRC row; FC DEL-23, wave 2, proposed).
- **(9) Market and chosen shape.** Salla sets COD limits and fee rules [FRC S1]. Logestechs claims automatic COD fee calculation; the public pages show no custody chain [LT L9, §5]. Torod marks COD as under review, collected, then transferred about one week later, on a plan schedule of twice monthly to twice weekly [TR T24, T2]; the schedule and the one-week figure are not reconciled [TR §4]. Wasal shows COD as a stop field, and payment on delivery only on its top tier [WS §2.4]. Chosen (existing): ledger custody with handover and deposit, no merchant payout (ADR-0007; DM §3.11). Proposed: a read-only merchant COD statement over the ledger (FC DEL-23), as Torod's status ladder suggests [TR §5 row 13].
- **(10) Roadmap mapping.** Partial. Covered: `cod_amount` and D-4 (DEL-2, wave 1), collections (DEL-7, wave 1), custody and deposits (DEL-11, DEL-12, wave 2). Missing: COD eligibility per account (FC DEL-19 wave 2; FOD P1 wave 1), COD fee and limits, merchant statement, reversal on return or cancel (FC DEL-23). Owner: COD limits and fees, and who records reversals (FC §4 #10); ADR-0017 gate.

### 1.5 Time windows and service levels

- **(1) Definition and user goal.** The promised delivery window for the recipient, and the internal rules for which day an order is served: cutoff, service days and SLA days. Time window: a slot with `starts_at`, `ends_at`, capacity and booked count [DM §3.9; OAS-C Slot]. Service level: no entity in the domain or the roadmap.
- **(2) Workflow.** A slot is booked at acceptance or reschedule. A full slot refuses (`slot_full`, 409); a closed slot day refuses; the slot must belong to the order's site and zone (`slot_not_available`) [DM §3.9; ERR]. Reschedule takes `attempted` to `accepted` with a new slot [DM §3.13] and is wave 2 [OAS-SD rescheduleOrder]. The in-flight branch answers `404` until DEL-9 lands [FB §8.3].
- **(3) Business rules and edge cases.** The Saudi weekend is Friday and Saturday, in force since 29 June 2013 [WEB1]. A slot day is per site, zone and date and can be closed [DM §3.9], so a weekend closure is a closed slot day (inference). Ramadan hours: no source read on 2026-11-02; open. Wasal defines a named service with cutoff time, SLA days, service days and per-depot availability; items past cutoff move to the next service day [WS §2.2]. Route windows are honoured only from INT-6 (wave 2, deferred to the end of its wave) [INT §6.4; RM INT-6].
- **(4) Data.** `del_slot_days` (site, zone, date, open or closed) and `del_slots` (window, capacity, booked) [DM §3.9; DATA §2.1]. A service-level record would be new; none is specified.
- **(5) Surfaces.** Merchant web: slot picker on create and reschedule (proposed in WEB-5 once DEL-9 lands). Driver app: window on the stop. Recipient page: ETA only, no window (D-24). Message `order_out_for_delivery` carries an ETA window that wave 1 cannot compute [INT §5.1; FC §1].
- **(6) Permissions, roles, audit.** `delivery.orders.dispatch` for reschedule [OAS-SD]; slot-day management permission not read. Transitions audit with reason.
- **(7) Dependencies and integrations.** DEL-9 (wave 2, after DEL-6); DEL-14 reschedule link (wave 2); INT-6 windows in VROOM (wave 2); Q-18 (where stop sequence and ETA live) [RM §4].
- **(8) Metrics and reporting.** Slot fill (booked over capacity), window hit rate and failed attempts by window: none defined; proposed for DEL-17 (wave 4) [RM DEL-17].
- **(9) Market and chosen shape.** Locus closes a window at a zone's order limit; DispatchTrack offers feasible windows only; Bringg sets slots per date and service area [FOD §3 S15, S17, S21]. OptimoRoute and Locus honour hard windows in routing [FOD §3 S22, S17]. Wasal: services with cutoffs and SLA days [WS §2.2]. Torod shows an expected delivery date on tracking [TR §5 row 30, T1]. Chosen (existing): slots as capacity per site, zone and day, booked at acceptance [DM §3.9]; no ADR. **Proposed:** a named service per site (cutoff, SLA days, service days) feeding intake, with price left to Q-33 (PC §4 DEL-32; WS §6 P5).
- **(10) Roadmap mapping.** Partial. DEL-9 slots, DEL-14 reschedule and INT-6 windows are all wave 2. Missing: service levels (proposed), window as a customer choice at checkout, Ramadan hours. Owner: Q-18; whether windows are customer-facing or planning-only (FOD §7 #8); service levels and cutoffs (new).

### 1.6 Manual create and edit

- **(1) Definition and user goal.** A dispatcher or site staff keys one order, and corrects recipient, address, items, COD or notes before pickup. The screen is WEB-5 [RM WEB-5].
- **(2) Workflow.** `POST` create with `Idempotency-Key`, returns `201` with `version` 1 [OAS-SD createOrder]. `PATCH` requires `If-Match`: missing gives `428`, stale gives `409 version_conflict` with current status and version [OAS-SD updateOrder; ERR]. Recipient, address and items lock at `picked_up` (`order_locked`); cod locks there too; notes stay editable until terminal (in flight) [FB §8.2 #11]. An address edit re-runs geocode and coverage [PLAN §2.8]. In flight: a text-only edit keeps a higher-trust pin, and an accepted order whose new point is uncovered keeps its status with zone null [FB §8.2 #12].
- **(3) Business rules and edge cases.** Recipient name at most 200 characters; phone E.164; address text at most 500, city required; notes at most 1000 on create [OAS-C]. Items at most 200 [PLAN §2.3]. Missing `If-Match` answers `428 version_required`; the plan said `400`, the contract and README say `428`, and the branch follows the contract [FB §8.2 #10].
- **(4) Data.** `del_orders` with `version` (optimistic concurrency, D-22); `del_order_items`; `del_order_events` append-only [DM §3.1, D-22; DATA §2.1]. `UpdateOrderRequest` carries recipient, address, items, cod_amount and notes [OAS-SD].
- **(5) Surfaces.** Merchant web create and detail forms, Arabic and English, RTL [ADR-0016; RM WEB-5]. API create: wave 4 [RM INT-9]. The driver app has no order-edit path in DRV-4.
- **(6) Permissions, roles, audit.** Create and edit `delivery.orders.create`; transitions `delivery.orders.dispatch`; cancel `delivery.orders.cancel`; site scope applies [OAS-SD]. COD changes audit before and after (K-7) [OAS-SD updateOrder]. Other edits audit changed keys only [PLAN §2.8].
- **(7) Dependencies and integrations.** DEL-1, INT-2, the DEL-2 state machine, PLAT-6 idempotency, PLAT-7 audit, PLAT-10 roles [RM].
- **(8) Metrics and reporting.** Edits per order and 409 version conflicts per day: none defined; proposed for operations reporting.
- **(9) Market and chosen shape.** Torod locks payment method and price after creation; a change means a new order, while customer, package size, addresses and weight stay editable [TR §2 T26]. Omniful's listing names order edits [OM O23]. Chosen (existing): optimistic version on every write, locks after pickup [DM D-22, §3.2]. Adopt the named locked-field list in DEL-2 (TR §5 row 5, proposed).
- **(10) Roadmap mapping.** Covered: DEL-2 legs 1 and 2 (in flight); WEB-5 (wave 1). Owner: none beyond Q-1 for later driver writes.

### 1.7 CSV import

- **(1) Definition and user goal.** A dispatcher uploads a spreadsheet of orders and gets an accepted count, a job status and per-row errors. Torod treats Excel upload as a core intake path [FOD §2 S1].
- **(2) Workflow.** `createOrderImport` takes the file name (must end `.csv`), site, sha256 and size (at most 20 MB) and returns the job and an upload ticket valid 10 minutes [OAS-SD; OAS-C UploadTicket]. The client PUTs the file; `submitOrderImport` queues it and answers `202` with the job. Job status moves through `awaiting_upload`, `queued`, `running`, `completed`, `failed`; progress streams as `job.progress` and `job.completed` over SSE [OAS-C Job; OAS-SD streamOrderImport]. Row errors list row, column, code and message [OAS-SD ImportRowError].
- **(3) Business rules and edge cases.** `.csv` only [OAS-SD]. The sha256 is bound into the signed upload; a mismatch is `upload_mismatch` (422) [OAS-C UploadTicket; ERR]. Not written anywhere: whether a row goes through the manual intake rule (receive as pending or auto-accept), and the row cap. Proposed: each row uses the same intake as manual create (inference; the lead rules).
- **(4) Data.** `del_order_imports` [DATA §2.2]: `status` (Job), `storage_key`, `total_rows`, `processed_rows`, `created_count`, `error_count`, `errors_storage_key` [DATA §2.2]. The job is not a domain aggregate [OAS-C Job]. The file sits under the account prefix in object storage, write-once [ADR-0015].
- **(5) Surfaces.** Merchant web CSV import (WEB-5) [RM WEB-5]. Template download is a Wasal feature (required column `address`) [WS §2.2]; none is specified for us. No API path.
- **(6) Permissions, roles, audit.** `delivery.orders.import` on all import operations; the site on the request is checked [OAS-SD].
- **(7) Dependencies and integrations.** DEL-2 create path; INT-1 object storage (signed upload) [RM DEL-3].
- **(8) Metrics and reporting.** Per job: total, processed, created and error counts [OAS-C Job; DATA §2.1].
- **(9) Market and chosen shape.** Torod: Excel upload [FOD §2 S1]. Wasal: CSV or Excel with a template [WS §2.2]. Omniful: file-processing logs and failed events [OM §4.6]. Logestechs: none found [LT §1.4]. Chosen (existing): CSV only, signed upload, asynchronous job, per-row errors [OAS-SD]. Excel input is an owner choice; Wasal's note says add it only if asked [WS §5].
- **(10) Roadmap mapping.** Covered on paper: DEL-3 (wave 1, not started; depends on DEL-2 and INT-1) and WEB-5 CSV import. Owner: Excel input (new); per-row intake rule (new).

### 1.8 API and channel intake

- **(1) Definition and user goal.** Orders arrive without a person keying them: a merchant system calls our API, or a Salla or Zid store pushes orders through our partner app. Order sources in the contract: `manual`, `csv`, `api`, `channel`, `wms_package` [OAS-C Order].
- **(2) Workflow.** API create takes `Idempotency-Key` (required, `400` without it) and the same intake as staff [OAS-C CreateOrderRequest; ERR]. Channel: partner app install and OAuth; a verified webhook triggers `fetchOrder`; the adapter maps the order to `core.channel_order.received` (connection, reference, recipient, address, lines, COD); the Delivery consumer creates the order; orders in a status the merchant excluded are stored as `ignored` [INT §2.8, §3.1, §8.3]. Nightly reconcile at 03:00 Asia/Riyadh fetches the last 48 hours [INT §8.6]. Channel-side cancellations have no event: staff act by hand [INT §8.3].
- **(3) Business rules and edge cases.** Webhook order: store raw bytes; resolve connection; verify in constant time; reject stale timestamps beyond 300 s; dedupe on the provider event id for 7 days [INT §3.1]. Unknown connection: `200` with the row stored as `ignored`. Salla and Zid verification in [INT §3.2]. Provider credentials never sit in the merchant's hands: no merchant platform password is taken [INT §2.8; ADR-0013]. Shopify and WooCommerce are not on the roadmap (scope question).
- **(4) Data.** `del_orders.source` and `source_ref` (opaque, at most 120 characters) [OAS-C CreateOrderRequest]. `core_channel_connections` with encrypted credentials and key id [DATA §10]. Raw inbound payloads hold recipient data: kept 30 days, metadata one year [INT §3.1; DATA §10].
- **(5) Surfaces.** Merchant API and webhooks: keys (INT-9), subscriptions (INT-10), wave 4. Channel connection page and inbound log (WEB-17, wave 4) [RM WEB-17]. Recipient messages after intake follow the staff path [INT §5.1]. Platform console: support reads with a reason header only [ERR reason_required].
- **(6) Permissions, roles, audit.** API keys are per account and the account comes from the token, never a request parameter [ADR-0025; RM INT-9]. Logestechs issues keys to one customer account, shown once, by a company admin [LT D3]; our key lifecycle is INT-9 (create, rotate, revoke, usage).
- **(7) Dependencies and integrations.** INT-9 (DEL-2, DEL-8, Q-13, Q-14); INT-10 (ADR-0040 Standard Webhooks; Q-35); INT-11 (DEL-2, Q-30, Q-34); PLAT-8 outbox [RM]. Salla and Zid partner apps are new (Q-30).
- **(8) Metrics and reporting.** Inbound counts per connection by status (emitted, ignored, duplicate, rejected, unmappable) [INT §3.1]; reconcile summary with drift, missed orders and errors [INT §8.6].
- **(9) Market and chosen shape.** Logestechs: one key per customer, webhooks unsigned, no retries, payload carries driver phone and a delivery PIN [LT D3, D4] (a negative example). Logestechs also accepts a `webhookUrl` per create request [LT §5]; not adopted, because it conflicts with subscriptions and the SSRF guard. Omniful: no status mapping before the first sync is a risk; an unmapped status stops the sync [OM O18, O19]. Torod's WooCommerce plugin takes the merchant's own password [TR T35]; not adopted. Chosen (existing): verify, store, emit; Standard Webhooks signing (ADR-0040); no merchant password (ADR-0013, ADR-0023). Shape to borrow: the key-issue screen with one-time reveal, and the resource split of orders, shipments and warehouses [PC §4 INT-9].
- **(10) Roadmap mapping.** Partial. INT-9, INT-10 and INT-11 are all wave 4. The staff create operation is live in the contract at wave 1. Missing: status mapping gate before first sync (proposed INT-11 amendment, OM §6 item 8); Shopify and WooCommerce (CONN-1, proposed in FC). Owner: Q-13, Q-14, Q-30, Q-34; channel scope beyond Salla and Zid.

### 1.9 Order numbers and labels

- **(1) Definition and user goal.** A short number that the merchant, recipient and driver quote, and a printable label for the handover [DM §3.1; OAS-SD getOrderLabel].
- **(2) Workflow.** The number is allocated inside the creating transaction from `SequenceAllocator`, so a rolled-back create rolls the number back [DM D-2; PLAN §2.2]. The label is a signed URL to an own-fleet label PDF (`GET /orders/{id}/label`, x-wave 1) [OAS-SD]. Carrier labels come from INT-8 at pack (wave 3) [RM INT-8; ADR-0014]. Package labels come from WMS-7 (wave 3) [RM WMS-7].
- **(3) Business rules and edge cases.** Unique per account, monotonic, gap-free [DM D-2]. Shown as `D-` and six digits, wider when needed [PLAN §2.2]. Search accepts the number with or without the prefix [PLAN §2.7]. Labels bilingual [ADR-0016]. Printed waybills are how KSA merchants hand over parcels (secondary) [FOD §2 S9]. Torod keeps the original order number on a returned shipment [TR §2 T27].
- **(4) Data.** `del_orders.number bigint`, unique `(account_id, number)` [DATA §2.1]; sequence row in `core_sequences` [FB §8.2 #1]. Label files: object storage under the account prefix, signed read URL (ADR-0015). Label retention: not defined.
- **(5) Surfaces.** Merchant web: print from order detail (WEB-5). Packing bench (WEB-15, wave 3). Driver run list shows the number. Recipient messages carry the number on `order_assigned` and `order_delivered` [INT §5.1].
- **(6) Permissions, roles, audit.** Label read `delivery.orders.read` [OAS-SD]; the number shows wherever the order shows.
- **(7) Dependencies and integrations.** DEL-2 sequences; INT-1 storage for label files (proposed); WMS-7 and INT-8 for carrier and package labels; `OwnFleetOrderPort` returns the number and label to the packer in the same transaction (W-11) [DM §1.1, §4.7].
- **(8) Metrics and reporting.** Labels printed per day and reprints: not defined in any row.
- **(9) Market and chosen shape.** Torod: label printing and `label_url` on create; bulk print [FOD §2 S1; TR §2]. Salla: a waybill per order from the order page [FOD §2 S9]. ShipHero: bulk ship labels for up to 1,000 identical orders before picking [SH §5 row 8, H4]. Logestechs: one-action label print for many orders [LT §4.3 S2]. Chosen (existing): number at create, label at pack for carriers (ADR-0014). **Proposed:** a per-order own-fleet label from order detail (FC DEL-20), with bulk print as a list action (see 1.15).
- **(10) Roadmap mapping.** Partial. Number: Covered (DEL-2, wave 1). Label: the contract endpoint exists at wave 1 but no roadmap row builds the own-fleet PDF; WMS-7 and INT-8 cover package and carrier labels at wave 3. Owner: labels for orders outside WMS, wave 1 or 2 (FC DEL-20; FOD P3).

### 1.10 Holds and tags

- **(1) Definition and user goal.** A hold stops an order from moving (no offer, no assignment) until a named reason is cleared. A tag is a label for search, routing or printing. The domain has neither [DM §3.1, §3.13].
- **(2) Workflow.** Only `on_hold` exists, in WMS, for a short pick [DM §4.12]. **Proposed:** a dispatcher sets and clears a hold; a hold blocks offers and assignment and never rewrites an event [PC §2, §4; OM §5 row 7].
- **(3) Business rules and edge cases.** ShipHero holds: address, fraud, operator, payment, client and hold-until date; a client hold is set only by the owning client; rules run top-down and do not apply retroactively [SH H12, H14]. ShipHero does not say whether a hold blocks picking or allocation [SH §4.3]. Omniful tags: staff labels or conditions on origin city, country, weight, package count [OM O9]. Governance: ADR-0006 allowlist; no rule engine in scope [PC §2; OM §6 item 3].
- **(4) Data.** None yet. **Proposed:** hold flag with reason code, set-by and cleared-by, timestamps, audit; tags as a label list on the order. No ledger is involved.
- **(5) Surfaces.** Merchant web: badge and filter on the orders list (WEB-5). Driver app: held orders not offered (DEL-6 would check). Recipient page and API: none.
- **(6) Permissions, roles, audit.** Hold and release by a dispatcher role (proposed); every set and release audited (PLAT-7) [PC §4 DEL-31].
- **(7) Dependencies and integrations.** DEL-2 machine (a new ADR, since §3.13 changes); DEL-6 offer rules; account reason codes [OAS-C AccountSettings].
- **(8) Metrics and reporting.** Open holds by age and reason: proposed; no row.
- **(9) Market and chosen shape.** ShipHero: holds as flags set and cleared by rules (above). Omniful: an approve endpoint and a review step [OM O22 T, O23]. Chosen: none yet. **Proposed:** holds as flags with reason codes and audit rows, blocking offers and allocation, never rewriting events; tags as staff labels and bounded conditional tags with no trigger engine, behind ADR-0006 [PC §4; OM §6 items 2 and 3]. Trade-off named in the sources: a rule that sets holds is a bounded automation, which ShipHero has and we do not plan.
- **(10) Roadmap mapping.** Missing. The same feature has three proposed ids: DEL-31 (PC), DEL-19 and DEL-20 (OM), WMS-4a (SH). Owner: hold reasons; whether holds block offers and allocation; whether any rule may set a hold (new).

### 1.11 Approval states

- **(1) Definition and user goal.** An order that needs a human check before dispatch waits in a visible state. The roadmap calls the intake form's variant "receive as pending" [RM DEL-2].
- **(2) Workflow.** Today: `pending` with `pending_reason` in `outside_coverage`, `awaiting_review`, and (in flight) `needs_location` [OAS-C Order; DM D-3; FB §8.1]. Transitions: pending to accepted by a dispatcher or the intake rule; pending to cancelled by a dispatcher [DM §3.13]. Nothing in the domain or roadmap sets `awaiting_review`.
- **(3) Business rules and edge cases.** Accept refused outside coverage (`outside_coverage`, 422) [ERR]. In flight: accept refused without a point (`needs_location`) [FB §8.2 #24]. Logestechs shipments wait for customer-care approval, then dispatcher assignment; approval can fail, postpone or return. Those are schema names only, not described flows [LT §1.1, D2, D4].
- **(4) Data.** `pending_reason` CHECK lists `outside_coverage` and `awaiting_review` [DATA §2.1]. `needs_location` is added on the branch and not yet in data.md (plan item F) [FB §8.1].
- **(5) Surfaces.** Merchant web: status filter and the dispatcher's needs-location view [INT §2.2; RM WEB-5]. Driver app: pending orders are never offered (D-12).
- **(6) Permissions, roles, audit.** Accept `delivery.orders.dispatch`; each transition is an event and an audit row [OAS-SD transitionOrder; PLAN §2.9].
- **(7) Dependencies and integrations.** DEL-1 coverage; INT-2 geocoder; PLAT-12 intake setting.
- **(8) Metrics and reporting.** Time in pending by reason: proposed; not in any row.
- **(9) Market and chosen shape.** Logestechs: approval as a state before dispatch, with fail, postpone and return outcomes [LT §5 row 2]. Chosen (existing): pending with named reasons (DM D-3). **Proposed:** approval as a named state with fail, postpone and return outcomes, in one table with Q-6 (PC §4 DEL-2 amendment). A closer reading of the state table would be: postpone is `pending` with a date, return is `failed` then `returned` (inference).
- **(10) Roadmap mapping.** Partial. DEL-2 covers `pending` with reasons (wave 1, in flight). `awaiting_review` has no producer; no row covers postpone or return outcomes. Owner: what sets `awaiting_review` (new); whether approval is a customer step (new).

### 1.12 Cancellation rules

- **(1) Definition and user goal.** A dispatcher or the system ends an order before delivery. A cancel after pickup is not a cancel: the parcel comes back through a failed order and a check-in [DM §3.13; RM Q-6].
- **(2) Workflow.** `cancelOrder` (`delivery.orders.cancel`, `If-Match`, reason code) moves pending, accepted, offered or assigned to cancelled and clears the assignment and capacity [OAS-SD cancelOrder; DM D-10]. From picked_up, out_for_delivery or attempted it moves to failed with the reason; site staff then check in to returned [PLAN §2.9; DM §3.13; OAS-SD checkInReturn]. Terminal orders refuse with `invalid_transition` [ERR].
- **(3) Business rules and edge cases.** In flight: cancel after pickup lands failed, though the operation description still says "after pickup use fail" [FB §8.2 #17]. A reason code is required from the account's active codes [FB §8.2 #18]. The branch notes conflict: a new account has an empty list (#18) and, after round 1, a six-code starter set (#27). Whether a refused door counts as an attempt is open (Q-6). Logestechs allows cancel only before pickup [LT D2].
- **(4) Data.** Transition event with `reason_code` and `note`; `terminal_at` on terminal status; events are append-only (D-15, trigger) [DM §3.3, §3.18; DATA §2.1].
- **(5) Surfaces.** Merchant web: cancel with a reason (WEB-5). Driver app: assignment ends through the DEL-6 event (in flight: `delivery.order.cancelled` and `failed` clear the assignment) [FB §8.3]. Recipient messages: no cancelled template exists; the four templates do not cover it [INT §5.1].
- **(6) Permissions, roles, audit.** `delivery.orders.cancel` (dispatcher); `delivery.orders.receive` for check-in [OAS-SD]. Audit `delivery.order.transitioned` with from, to and reason [PLAN §2.9].
- **(7) Dependencies and integrations.** DEL-6 (assignment cleanup); WMS: `delivery.order.cancelled` returns the package to packed [DM §6.3]; DEL-7 attempts; collected COD on a cancelled order has no reversal (see 1.4).
- **(8) Metrics and reporting.** Cancels by reason and stage (before or after pickup): proposed; not in any row. FOD notes cancellations are frequent on COD orders (inference).
- **(9) Market and chosen shape.** Logestechs: cancel before pickup only [LT D2]. Zid moves an order to canceled when the customer refuses or returns it, with an `order.canceled` webhook [FOD §2 S13]. Torod: payment method and price locked after create, and a soft hide flag that the teardown rejects as a second state [TR §2 T26, §5 row 6]. Chosen (existing): the Q-6 default, cancel after pickup becomes failed then returned (RM §4). No hide flag.
- **(10) Roadmap mapping.** Covered: DEL-2 (wave 1, in flight). Owner: Q-6 (refusal at the door as an attempt, or straight to failed); COD reversal on cancel after collection (new, FC DEL-23).

### 1.13 Intake rules: receive as pending, auto-accept, coverage before carrier

- **(1) Definition and user goal.** At creation the account decides whether a valid order is accepted at once (auto-accept) or waits for a dispatcher (receive as pending). No order reaches a driver or a carrier outside zones its site covers [RM DEL-2; DM D-3].
- **(2) Workflow.** `AccountSettings.intake_rule` is `receive_as_pending` or `auto_accept` [OAS-C AccountSettings]. It is evaluated at create, and again when a pending order's address changes [PLAN §2.6; FB §8.2 #12]. Under auto-accept an order with a zone becomes accepted; without one it stays pending with its reason, and the system arrow runs pending to accepted once a zone exists [DM §3.13; PLAN §2.6]. Coverage: a point inside a zone that the order's site covers; otherwise `pending` with `outside_coverage` [DM D-3; ADR-0015]. Own-fleet package choice outside coverage is refused (`outside_coverage`, W-11) [DM §4.16; ERR].
- **(3) Business rules and edge cases.** No default for `intake_rule` in the contract [OAS-C AccountSettings]. In flight: coverage is checked again under the row lock before accept [FB §8.2 #24]. Business date and time zone Asia/Riyadh [DM D-11]. Logestechs: approval first, then dispatch [LT D2]. Omniful picks a hub by stock, capacity and cost; cross-site choice has no row for us [OM §2.1, §5 row 8].
- **(4) Data.** `intake_rule` in account settings [PLAN §2.6, PLAT-12]; `zone_id` on the order, null without a point [OAS-C Order]; coverage rows `(site_id, zone_id)` [DM §3.4].
- **(5) Surfaces.** Merchant web: account settings screen (WEB-3 settings) [RM WEB-3]; dispatcher pending view (WEB-5). Driver app: no pending orders.
- **(6) Permissions, roles, audit.** Settings change by a role that PLAT-10 grants (owner or admin, to confirm). A settings PATCH writes an audit row with the before state [FB §8.2 #27; RM PLAT-12].
- **(7) Dependencies and integrations.** DEL-1; INT-2; PLAT-12 effective settings; DEL-6 offers; WMS-7 own-fleet card (W-11).
- **(8) Metrics and reporting.** Auto-accepted share, pending by reason, outside-coverage count per day: proposed for RPT-1 (FC §3).
- **(9) Market and chosen shape.** Market: Logestechs holds shipments for approval; Locus and Bringg set capacity per zone and window [FOD §3 S17, S15]. Chosen (existing): two rules, coverage before any carrier or driver, both in DM D-3 and ADR-0015. The roadmap's "auto-override" is auto-accept; the term is a typo to fix in the next amendment.
- **(10) Roadmap mapping.** Covered: DEL-1 coverage and DEL-2 intake (wave 1, in flight). Defect: DEL-2 row says "auto-override". Owner: default `intake_rule` for a new account (not stated); geocode threshold as a setting (PLAN §7 #2).

### 1.14 Dangerous goods and cold chain flags

- **(1) Definition and user goal.** An item flagged as hazardous or temperature-controlled, so the order takes a compliant service and vehicle. The owner has not ruled on scope [FC §2 item 5].
- **(2) Workflow.** None in the domain, contract or roadmap. Market: a temperature class chooses a service (Omniful: frozen goods go to temperature-controlled service) [OM §2.4 O27]; hazardous goods get carrier-specific handling (Aramex: liquids need a separate account and approval for discounted labels) [FOD §2 S10].
- **(3) Business rules and edge cases.** No rule in our docs. KSA regulation on hazardous carriage was not read on 2026-11-02; do not infer it. ShipHero's custom-carrier label request carries `dangerous_goods_code` (October 2026) [SH §1.5 D6]. Torod's shipment types include cold and heavy [TR §2 T2].
- **(4) Data.** None. Any future flag would sit on `del_order_items`, which has no such column [DATA §2.1].
- **(5) Surfaces.** None built. A future flag would show on order detail (WEB-5), the driver stop, and the carrier label (INT-8).
- **(6) Permissions, roles, audit.** None defined.
- **(7) Dependencies and integrations.** Vehicle kind and skills (DEL-4, DEL-10: proposed matching, FOD §3); carrier service mapping (INT-8; ADR-0014).
- **(8) Metrics and reporting.** None.
- **(9) Market and chosen shape.** Options the sources show: item flags that steer a service (Omniful), a shipment-type enum (Torod cold), a carrier-side code (ShipHero). Chosen: none. The sources say scope first [FOD §7 #4; FC §2 item 5].
- **(10) Roadmap mapping.** Missing; checked in the roadmap, domain model, data model and contracts. Owner: in scope, which item classes and which temperature ranges (new; FOD §7 #4). No order is proposed until ruled.

### 1.15 Bulk actions

- **(1) Definition and user goal.** A dispatcher selects many orders on the list and acts once: print labels, accept, assign, cancel, export or hide.
- **(2) Workflow.** Not in the contract: each door takes one order with its own `If-Match` and `Idempotency-Key` [OAS-SD]. Torod bulk-ships or hides selected orders [TR §2 T26]. ShipHero bulk-ships up to 1,000 identical orders before picking [SH §5 row 8, H4].
- **(3) Business rules and edge cases.** Not defined. **Proposed:** per-row results, no all-or-nothing; each row keeps its own version check (inference; a trade-off the lead rules). Naqel's connector prints labels for up to 50 orders (third-party, search) [FOD §5 S28].
- **(4) Data.** None new; each row writes its own append-only event [DM §3.3].
- **(5) Surfaces.** Merchant web list selection (WEB-5 scope note, proposed).
- **(6) Permissions, roles, audit.** The permission of each action applies per row; a batch never widens site scope [OAS-SD].
- **(7) Dependencies and integrations.** DEL-2 doors; DEL-6 for assign; DEL-20 labels (FC, proposed).
- **(8) Metrics and reporting.** Batch size and per-row failures: proposed.
- **(9) Market and chosen shape.** Torod, ShipHero and Logestechs all have batch print or ship [TR, SH, LT]. Chosen: none. **Proposed:** a WEB-5 scope note calling the existing doors, with labels and bulk print (FC DEL-20; FOD P3).
- **(10) Roadmap mapping.** Missing. WEB-5 names list, create, detail and CSV import only [RM WEB-5]. Owner: wave 1 or 2 (FOD P3 says wave 1 or 2; FC says wave 2).

### 1.16 Notes and instructions

- **(1) Definition and user goal.** Free text on the order for staff, for the driver, and on each event. Delivery instructions, such as a gate code, a landmark or a leave-at-door note, are shown to the driver.
- **(2) Workflow.** `notes` on create (at most 1000) and edit [OAS-C CreateOrderRequest; OAS-SD updateOrder]. A `note` on transitions, attempts, reschedules, pins and return check-in (at most 1000 on transitions) [OAS-SD TransitionRequest, NoteRequest, AddressPinRequest]. Note events show in the timeline [OAS-C OrderEvent].
- **(3) Business rules and edge cases.** Delivery instructions and access notes are not in the domain or contract; the census found them in no source [FRC feature table, delivery instructions row]. KSA addresses rely on landmarks and short codes (inference). Free text can hold names and phones, but `notes` is missing from the personal-data inventory [DATA §2.1 has the column; DATA §10 does not list it].
- **(4) Data.** `del_orders.notes`; `del_order_events.note` [DATA §2.1; DM §3.3]. Retention: not stated; the personal-data table needs a row.
- **(5) Surfaces.** Merchant web notes field (WEB-5). Driver app order detail; whether notes show is not stated [RM DRV-4]. Recipient: none.
- **(6) Permissions, roles, audit.** Notes ride on the write's permission (`delivery.orders.create`, `delivery.orders.dispatch` and so on); no field-level rule.
- **(7) Dependencies and integrations.** DEL-6 and DEL-7 driver events carry notes; `del_attempts.note` is personal data [DATA §10].
- **(8) Metrics and reporting.** None defined.
- **(9) Market and chosen shape.** Wasal has driver notes and stop notes [WS §2.3]; Logestechs drivers add comments [LT §1.2 A1]. Chosen (existing): one notes field plus reason-coded notes on events [DM §3.3]. **Proposed:** a separate delivery-instructions field shown to the driver, with a retention rule (FC DEL-19, wave 2).
- **(10) Roadmap mapping.** Partial. Notes and transition notes: covered in DEL-2 (wave 1). Delivery instructions: missing (proposed, wave 2; FRC rates it high). Owner: scope of instructions and who may add them (new); retention of free text under Q-37.

### 1.17 Order events timeline

- **(1) Definition and user goal.** Every change to an order (status, edit, note) as one ordered, append-only list showing who did what and when, for disputes and driver pay [DM §3.3].
- **(2) Workflow.** Each transition or note writes one event in the same transaction that folds the status [DM §3.3]. `listOrderEvents` pages by server time [OAS-SD]. Driver events carry client time, device id and an idempotency key, replayed under ADR-0008 [DM §3.3]. An edit writes a note event with the changed parts [PLAN §2.8]; in flight, the note's payload is not in the contract, so the timeline shows a note without text [FB §8.2 #15].
- **(3) Business rules and edge cases.** Append-only trigger; `(account_id, idempotency_key)` unique forever; a replay returns the original result (D-15) [DM §3.18]. Actor types: user, driver, system, api_key [OAS-C OrderEvent]. In flight: server time is `clock_timestamp()`, so an edit's note and the arrow it causes keep their order [FB §8.2 #15]. Driver events applied by client order, with D-16 and D-23 (Q-1) [DM D-16, D-23].
- **(4) Data.** `del_order_events`: id, type, from and to status, actor type and id, device id, client and server time, idempotency key, point, reason code, note, proof ids, collection ids [DM §3.3; OAS-C OrderEvent]. Point is personal data; kept for the life of the account [DATA §10].
- **(5) Surfaces.** Merchant web timeline with events, attempts and proofs (WEB-5) [RM WEB-5]. Driver sync screen shows rejected driver events (D-16, Q-25). Outbox: one event type per status, ten types in flight [FB §8.2 #16]; webhooks wave 4 [RM INT-10].
- **(6) Permissions, roles, audit.** `delivery.orders.read` with site scope; no update or delete (trigger). Transition audit `delivery.order.transitioned` with from, to and reason [PLAN §2.9].
- **(7) Dependencies and integrations.** Outbox kinds and queues (ADR-0024, ADR-0036); PLAT-8 event catalogue; DEL-7 driver events (D-23, Q-1).
- **(8) Metrics and reporting.** Intervals between events (accept latency, pickup lag, attempts): DEL-17 (wave 4) reads them from events [RM DEL-17].
- **(9) Market and chosen shape.** Logestechs keeps ordered status history [LT §3.4] but its webhooks carry no event id or sequence number [LT D4], so order depends on polling. Omniful offers an order-logs endpoint [OM O22 T]. Chosen (existing): an event log with ids, client and server times and idempotency keys (ADR-0008; DM §3.3), which the platform comparison rates stronger [PC §3].
- **(10) Roadmap mapping.** Covered: DEL-2 (wave 1, in flight); WEB-5 timeline; INT-10 delivery (wave 4). Owner: Q-1 (conflict rule) and Q-25 (keep rejected driver events) change what the timeline shows; the note payload field is missing from the contract (FB §8.2 #15).

## Unanswered

Owner questions no source settled. Items marked "new" are not in roadmap §4.

1. Exchange shape: one order with an amount to collect and an amount to pay, or two linked orders (Q-4; [LT D5]).
2. Cancel after pickup, and whether a refusal at the door is an attempt or goes straight to failed (Q-6).
3. Multi-parcel under one order before WMS packages exist, and whether multi-box own-fleet orders happen (new; [FOD §7 #2]).
4. Source of a parcel count on an order: a planning field entered at create, or the WMS packages (new).
5. Time windows: a customer choice at checkout, or an internal planning constraint (new; [FOD §7 #8]). Where stop sequence and ETA live: Q-18.
6. Service levels with cutoffs and SLA days per site, and whether price waits for Q-33 (new; [WS §6 P5]).
7. Ramadan delivery hours and Saudi delivery-time norms: no source read (new).
8. COD limits and fees, and who records a reversal when a COD order returns or is cancelled after collection (new detail of [FC §4 #10]).
9. Digital COD: the owner's gate under ADR-0017, and when it is taken.
10. Holds: the reason list, whether a hold blocks offers and allocation, and whether any rule may set one (new).
11. What sets `awaiting_review`, and whether approval is a customer step (new).
12. Intake defaults: the default `intake_rule` for a new account, and whether the 0.6 geocode threshold becomes an account setting (new; [PLAN §7 #2]).
13. Bilingual address and building or unit fields, and the Hudhud terms that decide Arabic and English lookups (new; Q-28).
14. Recipient data retention: life of the account, or redaction 24 months after close (Q-37). The PDPL role (controller or processor) and the 72-hour breach reading need counsel ([FPC §4; FC §4 #5]).
15. Delivery instructions: scope, who may add them, and their retention (new; [FC DEL-19]).
16. Dangerous goods and cold chain: in scope, which item classes and which temperature ranges (new; [FOD §7 #4]).
17. Bulk actions, and own-fleet labels for orders outside WMS: wave 1 or wave 2 (new; [FOD P3], [FC DEL-20]).
18. Excel input for the CSV import, and the intake rule each imported row follows (new).
19. Channel scope beyond Salla and Zid (Shopify, WooCommerce, Magento), and the Salla and Zid partner apps (Q-30).

## Feature index

| Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|
| 1.1 Order kinds | Partial | DEL-2; DEL-18 | 1; 4 | Q-4; Q-6 |
| 1.2 Items and multi-parcel | Partial | DEL-2; WMS-7 | 1; 3 | 3, 4 |
| 1.3 Recipient and address | Partial | DEL-2; INT-2; DEL-14 | 1; 2 | 13, 14 |
| 1.4 COD and payment method | Partial | DEL-2; DEL-7; DEL-11; DEL-12 | 1; 2 | 8, 9 |
| 1.5 Time windows and service levels | Partial | DEL-9; DEL-14; INT-6 | 2 | 5, 6, 7 |
| 1.6 Manual create and edit | Covered (in flight) | DEL-2 | 1 | none beyond Q-1 |
| 1.7 CSV import | Covered on paper; not started | DEL-3 | 1 | 18 |
| 1.8 API and channel intake | Partial | INT-9; INT-10; INT-11 | 4 | Q-13; Q-14; Q-30; Q-34; 19 |
| 1.9 Order numbers and labels | Partial | DEL-2; WMS-7; INT-8 | 1; 3 | 17 |
| 1.10 Holds and tags | Missing | none (proposed) | proposed | 10 |
| 1.11 Approval states | Partial | DEL-2 | 1 | 11 |
| 1.12 Cancellation rules | Covered (in flight) | DEL-2 | 1 | Q-6; 8 |
| 1.13 Intake rules and coverage | Covered (in flight) | DEL-1; DEL-2; INT-2 | 1 | 12 |
| 1.14 Dangerous goods and cold chain | Missing | none | none (scope first) | 16 |
| 1.15 Bulk actions | Missing | WEB-5 scope (proposed) | 1 or 2 (proposed) | 17 |
| 1.16 Notes and instructions | Partial | DEL-2; DEL-19 (proposed id) | 1; 2 | 14, 15 |
| 1.17 Order events timeline | Covered (in flight) | DEL-2; INT-10 | 1; 4 | Q-1; Q-25 |

## Source list

Repo, read 2026-11-02 on `main` at `1e0c184` (paths relative to the repo root):

- [DM] `docs/architecture/domain-model.md` (§1.1, §2.5, §3.1 to §3.18, §4.7, §4.12, §4.16, §6.3, §9).
- [INT] `docs/architecture/integrations.md` (§2.2, §2.8, §2.9, §3.1, §3.2, §5, §6.1, §6.2, §6.4, §6.6, §8.3, §8.6).
- [DATA] `docs/architecture/data.md` (§2.1 `del_orders`, `del_order_items`; §2.2 `del_order_imports`; §10).
- [OAS-SD] `docs/contracts/openapi/staff-delivery.yaml` (createOrder, listOrders, getOrder, updateOrder, listOrderEvents, transitionOrder, cancelOrder, rescheduleOrder, pinOrderAddress, checkInReturn, listOrderCollections, getOrderLabel, createOrderImport, submitOrderImport, streamOrderImport, UpdateOrderRequest, TransitionRequest, AddressPinRequest, CreateOrderImportRequest, ImportRowError).
- [OAS-C] `docs/contracts/openapi/components.yaml` (Order, OrderItem, OrderEvent, CreateOrderRequest, Address, Recipient, Money, OrderKind, OrderStatus, AccountSettings, UploadTicket, Job, Slot, NoteRequest, SignedUrl).
- [ERR] `docs/contracts/errors.md` (§1, §3, §5).
- [RM] `docs/roadmap.md` (rows DEL-2, DEL-3, DEL-4, DEL-6, DEL-7, DEL-9, DEL-11 to DEL-14, DEL-17, DEL-18, DRV-4, INT-1, INT-2, INT-5, INT-6, INT-8 to INT-11, WEB-3, WEB-5, WEB-11, WEB-15, WEB-17, WMS-7, WMS-8, PLAT-7, PLAT-10, PLAT-12; §4 Q-1, Q-3, Q-4, Q-6, Q-13, Q-14, Q-18, Q-25, Q-28, Q-30, Q-33, Q-34, Q-35, Q-37).
- [PLAN] `docs/orders/DEL-2/plan.md` on `main` (§1, §2.1 to §2.11, §3, §7; §8.2 is an empty placeholder on `main`).
- [ADR] `adr/0002`, `0005`, `0006`, `0007`, `0008`, `0013`, `0014`, `0015`, `0016`, `0017`, `0018`, `0023`, `0024`, `0025`, `0034`, `0036`, `0040` (titles and status, read 2026-11-02).

Branches, read 2026-11-02:

- [FB] `origin/feat/DEL-2-orders-intake` at `3f9d62b`, `docs/orders/DEL-2/plan.md` §8.0 to §8.3 (in flight, unmerged; cited as §8.1 and §8.2 items).
- [FC] `origin/docs/feature-coverage:docs/research/feature-coverage-2026-11.md` (§1 to §5).
- [FOD] `origin/docs/feature-coverage:docs/research/features-orders-dispatch-hubs-2026-11.md` (§2 to §7; source ids S1 to S33 in its §5).
- [FRC] `origin/docs/feature-coverage:docs/research/features-recipient-cash-returns-2026-11.md` (summary items 1 to 9; source ids S1 to S41).
- [FPC] `origin/docs/feature-coverage:docs/research/features-platform-integrations-compliance-2026-11.md` (PDPL and consultation dates, secondary sources).
- [PC] `origin/docs/platform-teardowns:docs/research/platform-comparison-2026-11.md` (§1 to §5).
- [HH] `origin/docs/platform-teardowns:docs/research/hudhud-geocoding-2026-11.md` (§1, §2; short-code format from the SPL page, grade S).
- [LT] `origin/docs/platform-teardowns:docs/research/teardown-logestechs-2026-11.md` (§1 to §7; ids L, D, S, A, Z per its §8).
- [OM] `origin/docs/platform-teardowns:docs/research/teardown-omniful-2026-11.md` (§2 to §8; ids O1 to O39).
- [SH] `origin/docs/platform-teardowns:docs/research/shiphero-teardown-2026-11.md` (§1 to §8; ids H, D, P per its §8).
- [TR] `origin/docs/platform-teardowns:docs/research/teardown-torod-2026-11.md` (§1 to §8; ids T1 to T51).
- [WS] `origin/docs/platform-teardowns:docs/research/teardown-wasal-2026-11.md` (§1 to §8; ids S1 to S20; grades B, F, H, L).
- [WEB1] WebSearch, 2026-11-02: Crowell, "Saudi Arabia Changes Weekend to Friday/Saturday from 29 June 2013", https://www.crowell.com/en/insights/client-alerts/saudi-arabia-changes-weekend-to-friday-saturday-from-29-june-2013 (the weekend change, effective 29 June 2013). The same search found no Ramadan working-hours source for delivery.
