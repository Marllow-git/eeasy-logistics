# Feature book 10: WMS outbound

Date: 2026-11-02. Status: research input for the lead; no decision taken; the roadmap does not change. Scope: fulfilment orders from source to parcel handoff, pick and pack, fulfilment methods, and B2B units, for merchants with their own stock and drivers in KSA and the GCC.

Repo facts were read at `origin/main` 6ca087e on 2026-11-02. Remote research notes were read with `git show` from `origin/docs/feature-coverage` and `origin/docs/platform-teardowns` on 2026-11-02. Web sources were read the same day. Source tags are defined in the list at the end.

## Summary for the lead

1. The repo fixes the outbound spine: fulfilment order (DM §4.12), pick task (DM §4.13), package (DM §4.14), a fulfilment method chosen at pack (ADR-0014) and handover to a driver or carrier (W-14). The 23 fulfilment, picking and packing operations in `staff-wms.yaml` are all `x-wave: 3`. Roadmap rows: WMS-6, WMS-7, INT-8, WEB-15.
2. Four points where the repo's own tables and state machines differ from what a reader of the roadmap rows would expect. Tote per order: a pick task has one `target_tote_id` (DA §2.3). Partial shipment: no state exists; a short pick holds the whole order (DM §4.12). COD: stored on the fulfilment order, not the package, so a split order has no COD rule (DA §2.3, §2.4; INT §2.7). Own-fleet label: DM §1.1 says the packer needs the order number and a label at the bench, but no table or contract defines the label.
3. Defect to confirm before WMS-3 and WMS-6 build: StockSummary `on_hand` sums every non-system location (DA §3.3), so units in totes, docks and transit count as on hand. Pick releases the reservation (W-9) while the units stay on hand, so `available` rises by the picked quantity until shipment. DM §4.10 defines available over pickable locations. The two must agree.
4. Allocation is per site (DM §4.10), but the guard against over-reservation reads an account-wide summary keyed by product (DA §3.3, W-8), and reservations carry no site (DA §2.3). A multi-site account cannot be checked with the tables as written.
5. Pick lines carry no fulfilment-order-line id (DA §2.3), while reservations are keyed by that line (W-8). A batch pick cannot release the right order's reservation as written. `line_id` in `PickRequest` and `ShortPickRequest` is not defined as either id (OAPI).
6. A short line's reservation has no end: `release_reason` allows only `picked` or `cancelled` (DA §2.3). `allocateFulfilmentOrder` says "→ on_hold when short" and also lists `409 insufficient_stock` (OAPI). Both cannot hold.
7. Channel orders have no site. `core_channel_connections` has no site column (DA §2.1) and the channel payload carries none (DM §1.1 and §6.3; INT §8.3). INT-11 depends on DEL-2 only (RM), not on WMS-6, though the channel consumer lands in WMS-6.
8. Absent from every order, contract and table: FEFO, a box catalogue, packing slips, per-unit scan verification, a cutoff object or calendar, outbound KPI definitions, WMS audit actions, case and pallet units. Market notes put several in wave 3 or 4 extensions (CW P2, P3; FC §3 WMS-10, WMS-11). None is ordered.
9. The bench is web only (WEB-15; WEB §8 note). Five of nine teardown platforms run floor work on handhelds (PC §2, §5 Q1). No document rules the device; it is an owner decision. The proposals reuse ids: WMS-9 means variants (FC), transfers (OM), routing (AN) and a handheld (FU); WMS-10 means pick strategies, a handheld and transfers. The lead assigns each id once.
10. KSA and GCC: no cutoff, weekend or Ramadan rule exists in the repo. Secondary sources: the weekend is Friday and Saturday since a 2013 royal order (search summary, [S]); private-sector Ramadan hours were 6 a day for Ramadan 2022 under Article 98 (MHRSD, as reported by Ajel; a 2016 source says 7, unverified). Arabic packing slips have no spec. Whether a slip may stand for an invoice under ZATCA is unanswered; ZATCA's own guidance was not read.

## Conventions

- **Chosen (repo)** means an ADR, contract, data table or roadmap row fixes the point. Where nothing fixes it, the aspect says "none chosen".
- **Market** means what a teardown or census note reports, with its own grade: [F] fetched, [S] search summary or unopened page. Vendor claims are marked "claimed".
- **(inferred)** marks my reading, not a source statement.
- Teardown references: `SH §5 row 6` means row 6 of that note's mapping table (§5); `SH H1` is the ShipHero help article in its source registry; `AN §5.15` and `OM §6.5` follow the same pattern.
- **Status**: Covered (a roadmap row names it and a table or contract supports it), Partial (a row names part of it), Missing (no row, no table).
- Aspect 10 names the open owner question. Owner-question ids: `Q-n` is the roadmap register (RM §4); `Q-U n` is the census list (CW); `OQ` is a question raised by this chapter.

## Outbound state machines in the repo

| Machine | Transitions (operation) | Terminal or note |
|---|---|---|
| FulfilmentOrder (DM §4.12) | received→allocated (`allocateFulfilmentOrder`); received/allocated/on_hold→cancelled (`cancelFulfilmentOrder`); received→on_hold; on_hold→allocated (stock arrives, no operation named); allocated→picking (`startPickTask`); picking→on_hold (`reportShortPick`); picking→picked (`completePickTask`); picked→packed (all lines in packages); packed→handed_over (every package); handed_over→completed or returned | completed, returned, cancelled |
| PickTask (DM §4.13) | open→in_progress (`startPickTask`); in_progress→in_progress per `recordPick`; in_progress→done (`completePickTask`); in_progress→short (`reportShortPick`); open→cancelled | done and short are terminal; no resume after short |
| Package (DM §4.14) | open→packed (`packPackage`); packed→ready (own fleet, same transaction as the order, W-11); packed→awaiting_label (carrier, W-12); awaiting_label→ready (AWB and label stored); awaiting_label→packed (dead job, method cleared); ready→packed (method cleared before pickup, W-13); ready→handed_over (driver or carrier pickup); handed_over→delivered or returned; open/packed→cancelled | delivered, returned, cancelled |

## 1. Fulfilment orders and sources

1. **Definition and user goal.** One record per order to ship from one site to one recipient, with lines, COD amount and an address snapshot. Staff see what to pick and what is promised [DM §4.6].
2. **Workflow.** `createFulfilmentOrder` (manual, `wms.fulfilment.manage`, `Idempotency-Key`) returns 201 in `received` [OAPI]. Channel orders arrive as `core.channel_order.received`; the account's flag chooses WMS or a Delivery order [DM §1.1]. Next steps are the allocation and cancel operations (feature 2). Actors: warehouse staff; the channel adapter (system). Exceptions: `422 site_kind_mismatch`, `422 idempotency_key_reused` [OAPI].
3. **Business rules and edge cases.** The site must be kind `warehouse` or `both` (K-4, W-1). The contract's `source` enum is manual, channel, api [DA §2.3]. COD on the Delivery side is non-zero only for `delivery` and `exchange` (D2 §2.3); no WMS rule is written. Channel orders for Salla and Zid arrive in wave 4 (RM INT-11). KSA: COD is common; the Salla rule cited in the census is SAR 20 minimum and SAR 1,000 maximum (FC §4 item 10). Uniqueness: integrations say WMS and Delivery treat `(connection, channel order ref)` as unique [INT §3.3 re-map note]; `wms_fulfilment_orders` indexes `(account_id, source_ref)` without a unique constraint [DA §2.3].
4. **Data.** `wms_fulfilment_orders`: `number` (per-account sequence, `F-` plus six digits), `site_id`, `source`, `source_ref`, recipient and address snapshot including the National Address short code, `cod_amount bigint`, `currency`, `status`, `version`; unique `(account_id, number)` [DA §2.3, §7]. Lines: `product_id`, `quantity`, `picked`, `packed`, CHECK `0 <= packed <= picked <= quantity`. Retention: recipient data for the life of the account (DA §10, open question 1). Erasure redacts the mutable recipient columns of a recipient's orders; the text does not name the WMS table (DA §10).
5. **Surfaces.** Web `/wms/fulfilment` and detail [WEB §8, wave 3 rows]. API: `listFulfilmentOrders`, `createFulfilmentOrder`, `getFulfilmentOrder` [OAPI]. Webhook `wms.fulfilment_order.created` [WH §5]. Documents: none.
6. **Permissions, roles, audit.** Read `wms.fulfilment.read` (warehouse staff, viewer); manage `wms.fulfilment.manage` (owner, admin only; warehouse staff lacks it) [CON roles]. An API key may hold `wms.fulfilment.manage` after the WMS pilot [CON API keys]. Audit: no WMS audit action is catalogued in DM §6.3 or DA §2.1; the events are the trail.
7. **Dependencies and integrations.** Channel connections and inbound webhooks (kernel, DA §2.1; INT-11). Site kinds (ADR-0018). Channel-to-WMS routing by account flag (ADR-0006 rollout). Outbox for `wms.fulfilment_order.*` (ADR-0024).
8. **Metrics and reporting.** None defined. Derivable: orders by status and source (list filters); `rpt_order_fulfilment` joins orders to packages for pilot dashboards [DA §9].
9. **Market and chosen shape.** Market: Anchanto claims 80 to 200 connectors [AN §5 row 13]; Omniful lists channel connectors [OM §5 row 28]; Fulfillor checks SKU and stock at import [FU §5 row 15, adapt]. Chosen (repo): one record with a source enum, opaque `source_ref` and a snapshot (DM §4.6). Import checks are none chosen.
10. **Roadmap mapping.** Partial. Manual orders: WMS-6, wave 3. API source: INT-9, wave 4. Channel orders: INT-11, wave 4, which does not list WMS-6 as a dependency (RM). Owner questions: OQ-1 which site receives a channel order (no mapping exists; Q-31 pilot site count); Q-30 partner apps; Q-34 write-back.

## 2. Allocation rules per site and the default rule

1. **Definition and user goal.** Allocation reserves stock for each fulfilment line so one unit is not promised twice, across channels and staff.
2. **Workflow.** `allocateFulfilmentOrder` moves `received` or `on_hold` to `allocated`, or to `on_hold` when short [OAPI]. The trigger is not named: nothing says allocation runs on receipt or on order creation (inferred: a staff call). Actors: warehouse staff with `wms.fulfilment.manage`. Exceptions: `409 insufficient_stock`; the description and the 409 disagree (summary item 6).
3. **Business rules and edge cases.** Available quantity is `on_hand − reserved` over pickable locations of the site (DM §4.10). W-8: allocation reserves at most available; the guard reads `wms_stock_summaries` under `FOR UPDATE` (DA §3.3), which is keyed by product for the whole account (summary item 4). The default rule is the order's `site_id`, required at creation [OAPI]. There is no fallback site and no rule list. Channel orders have no site source (summary item 7). KSA and GCC: no rule in the sources; multi-branch Salla and Zid merchants show per-branch stock on their channels [CW S2, marked old].
4. **Data.** `wms_reservations`: `fulfilment_order_line_id`, `product_id`, `lot_id` (nullable), `quantity > 0`, `released_at`, `release_reason` ∈ {picked, cancelled}; a partial index on open reservations by `(account_id, product_id)`; CHECK released-at and reason agree (W-8) [DA §2.3]. No site or location column. `wms_stock_summaries`: `on_hand`, `reserved`, generated `available`, `as_of_ledger_seq`, `version`; unique `(account_id, product_id)` [DA §2.3]. Retention: not stated.
5. **Surfaces.** Reservations tab through `listReservations` [OAPI]; stock screen `/wms/stock` [WEB §8]. Channel publication reads the projected available quantity (DM §5.3, ADR-0013).
6. **Permissions, roles, audit.** Allocate: `wms.fulfilment.manage`. Read: `wms.fulfilment.read`; summaries: `wms.stock.read` [OAPI]. Separation of duties: none. Audit: reservations are rows, not audit entries.
7. **Dependencies and integrations.** StockSummary projector every 2 s, single leader lock (DA §3.3); nightly recompute and assertion (DA §3.4); ADR-0011; ADR-0018 site kinds.
8. **Metrics and reporting.** Not defined. Candidates: allocation fill rate (allocated lines ÷ received lines); open reservations on closed or on-hold orders, which would show the short-line gap (feature 3).
9. **Market and chosen shape.** ShipHero: ordered first-match allocation rules, a DEFAULT RULE that cannot be edited, per-order or per-SKU scope, one rule per order [SH H11; SH §1.3]. Anchanto: four ordered rules with a primary-site fallback and a postcode map [AN A17]. Omniful: routing by stock, hub capacity and shipping cost [OM O7]. Fulfillor: rules by warehouse, channel, order type, method and priority [FU F16]. Teardown verdicts: adapt (SH §5 row 1; OM §5 row 8; FU §5 row 2) and yes in shape (AN §5 row 3), each after the multi-site ruling. Chosen (repo): per-site allocation over pickable locations; no rule list (DM §4.10). A cross-site rule needs a new ADR, since ADR-0018 defines sites, not routing [AN §6 P2].
10. **Roadmap mapping.** Partial: WMS-6 covers one site. Cross-site rules: none in RM; proposed WMS-9 (FC §3 uses WMS-9 for variants, see the summary). Owner questions: Q-31 and Q-U9 (site count, timing); OQ-2 which site a channel order uses when the account has several.

## 3. Reservations

1. **Definition and user goal.** A reservation claims stock for one fulfilment line, so available quantity falls before the pick and the channel sees less stock.
2. **Workflow.** Created by allocation; released once by `picked` (pick, same transaction as the movement, W-9) or `cancelled` (order cancel, W-8). Short lines have no release reason (feature 8). States: open → released.
3. **Business rules and edge cases.** W-8: exact-once release; reservation keyed by line, product and lot; lot is nullable, so an unlotted product reserves without a lot. A cancelled order releases every open reservation once (OAPI cancel). KSA and GCC: none.
4. **Data.** As feature 2 (DA §2.3). Defect: `release_reason` has no value for a short pick, so a line on hold keeps an open reservation or the schema must change (summary item 6). Retention: none stated.
5. **Surfaces.** `GET /fulfilment-orders/{id}/reservations` [OAPI, wave 3]; fulfilment detail [WEB §8]. No webhook.
6. **Permissions, roles, audit.** Written through allocate, pick and cancel (`wms.fulfilment.manage`, `wms.picking.write`); read `wms.fulfilment.read`. No audit entry is catalogued.
7. **Dependencies and integrations.** StockSummary `reserved` (DA §3.3); channel publication (INT-12, ADR-0013).
8. **Metrics and reporting.** Summary `reserved` per product (projection). Open reservations older than a set age: not defined; would expose leaks.
9. **Market and chosen shape.** ShipHero moves stock to a tote at pick, not at shipment [SH H2; SH §4.4]. Anchanto's routing sums stock over the order's SKUs; the teardown calls our line-level reservation stronger and stated [AN §5 row 6]. Chosen (repo): W-8 as written.
10. **Roadmap mapping.** Covered by WMS-6 with the defects above. OQ-3: should a short line keep its reservation while on hold, or release it and re-allocate when stock arrives (DM §4.12 says on_hold→allocated)?

## 4. Holds and release

1. **Definition and user goal.** A hold stops an order from moving until a reason is resolved, so a wrong or short shipment is not sent.
2. **Workflow.** Entry: `received→on_hold` on shortage and `picking→on_hold` on a short pick [DM §4.12; `reportShortPick`]. Release: `on_hold→allocated` "when stock arrives" (DM §4.12). No release operation exists in `staff-wms.yaml`. Cancel is allowed from on_hold. Actors: system and picker (entry); not named (release). Webhook `wms.fulfilment_order.on_hold` carries `short_lines` [WH §5.1].
3. **Business rules and edge cases.** W-9: a short pick puts the order on hold. No reason code, no hold flag, no hold on Delivery orders (DM §3.13). The Delivery side has `pending_reason` (`outside_coverage`, `awaiting_review`) [DA §2.1], not shared with WMS. KSA and GCC: none.
4. **Data.** Status only: `wms_fulfilment_orders.status` [DA §2.3]. No reason, actor or release time column. Retention: none stated.
5. **Surfaces.** Status filter on the fulfilment list [OAPI `StatusQuery`]; webhook; staff alert on `wms.fulfilment_order.on_hold` [DM §6.3].
6. **Permissions, roles, audit.** Release has no named permission (inferred: `wms.fulfilment.manage`). No audit entry.
7. **Dependencies and integrations.** Stock arrival (WMS-4 receipts); outbox alert (PLAT-8).
8. **Metrics and reporting.** Count and age of on-hold orders: not defined.
9. **Market and chosen shape.** ShipHero holds: address, fraud, operator, payment, client and hold-until-date, set and cleared by rules, never retroactive; a client hold is set only by the owner [SH H14; SH §1.3]. Omniful has no hold model; an approval step is implied [OM §4.5]. Teardown verdict: yes, "a hold is a flag with a reason and an audit row" (SH §5.3). Platform comparison lists holds as a convergent pattern [PC §2]. Chosen (repo): the `on_hold` status only.
10. **Roadmap mapping.** Partial: WMS-6 (shortage only). Order-level holds and reasons: none in RM; proposals WMS-4a (SH §6) and DEL-31 (PC §4). OQ-4: does a hold block allocation, picking or both? SH H14 is silent. OQ-5: which role may release a hold?

## 5. Partial fulfilment and backorders

1. **Definition and user goal.** Ship the lines in stock now and keep the rest to follow (partial), or keep the rest open as a backorder line.
2. **Workflow.** None. A short line holds the whole fulfilment order [DM §4.12]. Packages may split lines, but `picked→packed` needs all lines in packages and `packed→handed_over` needs every package (DM §4.12). A subset cannot ship.
3. **Business rules and edge cases.** W-9 only. KSA and GCC: Zid splits an order across locations when one is short [CW S1, F]; the census rates stock-outs on multi-line orders as medium relevance (inferred).
4. **Data.** Line `picked` and `packed` counts exist [DA §2.3]; no shipped count and no backorder line. The block is in the state machine, not the schema.
5. **Surfaces.** None.
6. **Permissions, roles, audit.** None.
7. **Dependencies and integrations.** A partial shipment would need a Delivery rule for part orders, and COD on the remainder (feature 16). Partial delivery is proposed as DEL-30 and needs an ADR [FC §3].
8. **Metrics and reporting.** Lines shipped versus ordered: not defined.
9. **Market and chosen shape.** ShipHero: Allow Partial ships allocated lines; backorders are separate lines [SH H13; SH §4.3]; teardown verdict yes (SH §5.2). Omniful: in-stock lines first, rest unstated [OM O10]; amend WMS-6, new ADR if the state machine changes [OM §6.1]. Chosen (repo): none; short means on_hold (W-9).
10. **Roadmap mapping.** Missing. Proposals: WMS-6a (SH §6.1), WMS-6 amendment (OM §6.1). OQ-6: default on or off, and may one order ship in two packages (PC §5 Q6)? OQ-7: which party carries COD on the remainder?

## 6. Waves and batches

1. **Definition and user goal.** A wave or batch groups several fulfilment orders into one pick run, so one walk serves many orders. A wave can be released together at a timed cut-off for a courier.
2. **Workflow.** `createPickTask` takes `fulfilment_order_ids` (minItems 1), an optional picker and an optional target tote [OAPI]. Membership is kept in `wms_pick_task_orders` [DA §2.3]. No wave object, no release timer, no cut-off. Actors: warehouse staff with `wms.picking.write`.
3. **Business rules and edge cases.** A pick task may cover several orders (DM §4.6, "or a wave of them"). No grouping rule, no minimum, no release rule. KSA and GCC: courier pickup cut-offs drive waves (CW census, inferred); no cut-off exists in the repo (feature 17). Ramadan hours (feature 17) shorten the shift that a wave must fit (inferred).
4. **Data.** `wms_pick_tasks` (`picker_id`, one `target_tote_id`, `status`, `version`); `wms_pick_task_orders` (unique per task and order); `wms_pick_task_lines` without an order-line link (summary item 5).
5. **Surfaces.** `/wms/pick` list and creation [WEB §8, wave 3 rows].
6. **Permissions, roles, audit.** `wms.picking.write`. No audit entry.
7. **Dependencies and integrations.** WMS-3 stock; totes (WMS-1).
8. **Metrics and reporting.** Orders and lines per pick task: not defined.
9. **Market and chosen shape.** ShipHero: a wave is generated every 15 minutes when enough orders share SKUs; one SKU per tote; needs location-aware picking [SH H5; SH §1.4]. Anchanto: wave by pool [AN §3.3]. Fulfillor: wave picking since December 2025 [FU F6]. Teardown verdicts: adapt after pilot volume data (SH §5.5); adapt (OM §5.5). Chosen (repo): one task may hold several orders; no wave.
10. **Roadmap mapping.** Partial (WMS-6). Proposal WMS-6a (CW P2, FC §3 WMS-10). OQ-8: is release timed, and at what cut-off? Q-31 pilot volume decides the case for it.

## 7. Pick strategies: single, batch, zone, cluster and tote per order

1. **Definition and user goal.** How a picker walks the floor and places units: one order per walk (single), several orders per walk (batch), one zone per picker (zone), several orders sorted at a station (cluster), or one tote per order.
2. **Workflow.** Single: one order per pick task (covered). Batch: several order ids per task with one target tote; no sort step is written. Zone: none. Cluster: none. Tote per order: not in the schema, which holds one `target_tote_id` per task. ShipHero's multi-item batch asks for a tote count and routes each order to its own tote [SH H1].
3. **Business rules and edge cases.** No pick-path or zone rule. Location `path` and coordinates exist for sequencing and are unused [DA §2.3]. Totes are movable locations and a tote never holds a tote (W-2). KSA and GCC: none. Cluster needs a sort station (census: low relevance).
4. **Data.** `wms_pick_tasks.target_tote_id` (one per task); `wms_pick_task_orders`; `wms_pick_task_lines.location_id`; location types `zone`, `tote` and `dock` (DM §4.1; DA §2.3).
5. **Surfaces.** Pick task screen [WEB §8, wave 3 rows]. Handheld: none ruled (summary item 9).
6. **Permissions, roles, audit.** `wms.picking.write`. No audit entry.
7. **Dependencies and integrations.** Tote and location tree (ADR-0012, DM §4.1); stock (WMS-3).
8. **Metrics and reporting.** Picks per hour per picker: derivable from pick movements with `recorded_by` and `ref_type` (DA §2.3, DM §4.4); not defined.
9. **Market and chosen shape.** ShipHero: tote per order (MIB) and single-item batch with a shared tote [SH H1]; location-aware routes [SH H6]. Anchanto: pool, partial, bulk, location, batch and wave; zone, cluster and discrete not named [AN §3.3]. Omniful: single, multi-order, zone and route; wave and cluster only in search summaries [OM §2.2]. Teardown verdicts: tote per order yes (SH §5 row 6); single-item batch no for wave 3 (SH §5 row 7); location routes adapt later (SH §5 row 9). Chosen (repo): single order per pick task, one tote per task.
10. **Roadmap mapping.** Single: Covered (WMS-6). Batch: Partial. Tote per order: Partial and in conflict with the schema. Zone and cluster: Missing (proposed in CW P2 and post-4 in CW). OQ-9: which strategy the pilot needs, and whether the packer requires one tote per order (SH proposal WMS-6b).

## 8. Pick tasks and short picks

1. **Definition and user goal.** A pick task is a picker's job: the lines to walk and the tote to fill. A short pick is a line the picker cannot fill in full.
2. **Workflow.** `startPickTask` (open→in_progress; allocated→picking) → `recordPick` per line (bin to tote, reservation released, W-9) → either `reportShortPick` (in_progress→short; order→on_hold) or `completePickTask` (in_progress→done; picking→picked) [OAPI]. Errors: `409 invalid_transition`, `409 insufficient_stock`, `422 tracking_mode_mismatch`. Actors: picker. A short task ends; what reopens the work after restock is not written (DM §4.13 shows `short` terminal).
3. **Business rules and edge cases.** W-9; a pick cannot exceed the line quantity (CHECK `picked BETWEEN 0 AND quantity`, DA §2.3). `ShortPickRequest` carries `picked` and a note. Two undefined points: the `line_id` (summary item 5) and the reservation of the short remainder (feature 3). KSA and GCC: none.
4. **Data.** `wms_pick_tasks`, `wms_pick_task_lines` (`location_id`, `product_id`, `lot_id`, `serial_id`, `quantity`, `picked`), `wms_fulfilment_order_lines.picked` [DA §2.3].
5. **Surfaces.** `/wms/pick/[pickTaskId]` [WEB §8]. Webhook `wms.fulfilment_order.on_hold`. Per-pick `wms.movement.recorded` (internal, DM §6.3).
6. **Permissions, roles, audit.** `wms.picking.write`, held by warehouse staff. Warehouse staff also holds `wms.packing.write` [CON roles], so one person can pick and pack the same order; no separation is written (inferred gap; W-16 covers counts only).
7. **Dependencies and integrations.** Row locks on StockLevel (W-6); ledger (ADR-0011); outbox for on_hold (PLAT-8).
8. **Metrics and reporting.** Pick rate and short-pick rate are named in the brief but not defined. Inputs exist: short tasks, on_hold events, pick movements. No pick-rate table.
9. **Market and chosen shape.** ShipHero: Report Issue marks the location as a hospital and removes it from the route; the order leaves the batch unless a setting keeps it [SH H1]; teardown verdict yes: reason codes on on_hold and a manager queue (SH §5.11, WMS-6c). Anchanto: partial pick and paperless pools [AN §3.3]. Chosen (repo): short means a terminal task and on_hold, with no reason code.
10. **Roadmap mapping.** Covered (WMS-6), with the gaps above. OQ-10: who clears a short-picked order, and does a short task reopen when stock arrives? OQ-11: is `line_id` a pick-task line or a fulfilment line?

## 9. Lot and serial capture at pick

1. **Definition and user goal.** The picker confirms the lot or serial that leaves the bin, so the movement records which unit left.
2. **Workflow.** `recordPick` takes a StockRef: product, quantity, and lot (id or code with expiry) or serial (id or number, quantity 1) [OAPI]. A mismatch with the product's tracking mode is refused (`422 tracking_mode_mismatch`).
3. **Business rules and edge cases.** W-4: a movement carries a lot iff the mode is lot, a serial iff serial; a serial is on hand in one place (partial unique index, DA §2.3). StockRef accepts `lot_code` and `expiry_date`; the pick rules do not say whether an unknown lot is refused at pick (OQ-12). KSA and GCC: expiry matters for food, cosmetics and supplements (inferred); SFDA drug GS1 DataMatrix is a secondary source [CW S26] and open as Q-U5.
4. **Data.** `wms_pick_task_lines.lot_id`, `serial_id`; `wms_reservations.lot_id`; `wms_lots` unique `(product, lot_code)` with `expiry_date`; `wms_serials` unique per product [DA §2.3].
5. **Surfaces.** WEB-15 pick screen; the scanner acts as a keyboard (WEB §8 note).
6. **Permissions, roles, audit.** `wms.picking.write`.
7. **Dependencies and integrations.** Catalog (WMS-2); receipt capture (WMS-4).
8. **Metrics and reporting.** Capture mismatches: not defined.
9. **Market and chosen shape.** Fulfillor records the lot picked at pick and adds lot picking on the handheld (July 2026) [FU F6, F11]; teardown verdict yes, adapt (FU §5 row 7). ShipHero and Anchanto track lot and expiry [SH D17; AN §5.15]. Chosen (repo): W-4 and `recordPick`.
10. **Roadmap mapping.** Covered (WMS-2, WMS-6). OQ-12 (above); Q-U5 on GS1 identifiers.

## 10. FEFO and expiry

1. **Definition and user goal.** Allocate and pick the lot that expires first (FEFO), or first received (FIFO); keep expired stock out of available; warn before expiry. Goal: no expiry losses in a hot climate (inferred).
2. **Workflow.** None. Allocation chooses no lot (reservation lot is nullable, DA §2.3).
3. **Business rules and edge cases.** None written. An expiry alert does not exist. KSA and GCC: pharma and supplements carry the SFDA rule as a secondary source [CW S26]; Q-U4 asks whether the pilot sells expiring goods.
4. **Data.** `wms_lots.expiry_date` with index `(account_id, expiry_date)` [DA §2.3]; no rule reads it. StockSummary has no lot grain, so lot-level available cannot be read from it (DA §3.3).
5. **Surfaces.** `listLots` [OAPI]. No alert.
6. **Permissions, roles, audit.** None written.
7. **Dependencies and integrations.** Allocation (feature 2) and the summary projector (DA §3.3).
8. **Metrics and reporting.** Expired units written off; days to expiry at pick. Not defined.
9. **Market and chosen shape.** Odoo offers FEFO, FIFO, LIFO and nearest zone [CW S16]; ShipHero orders lots by priority and excludes expired stock from available [SH D17; SH §5.24]; Anchanto offers FEFO and FIFO as a pick strategy setting [AN §5.15]. Teardown verdicts: adapt, exclude expired now, FEFO by ruling (SH §5.24); yes, shape (AN §5.15). Chosen (repo): none; expiry stored only.
10. **Roadmap mapping.** Missing: WMS-6 names no rule. Proposals: WMS-6a (CW P2), WMS-2a (SH §6.7), A1 (FU §6). OQ-13: the default rule (FEFO or FIFO), and whether it applies from the first release (Q-U4).

## 11. Packing: the bench and the box catalogue

1. **Definition and user goal.** The packer puts picked units into a package, measures it and records the box, so the carrier price and label use real size and weight.
2. **Workflow.** `openPackage` (open) → `packPackage` with contents from totes, consumables, weight and three dimensions (open→packed; tote→dock and consumption movements, W-14) [OAPI]. `cancelPackage` from open or packed. Then the method (feature 14).
3. **Business rules and edge cases.** W-10: no method until packed with weight and all dimensions above zero. CHECK `packed <= picked`. No box entity; no box dimensions; no suggestion. Consumables (tape, boxes) are products with `is_consumable` and post consumption movements to ADJUSTMENT (DM §4.8). KSA and GCC: carrier size classes (inferred from census S18, S20, both secondary).
4. **Data.** `wms_packages`: `weight_g`, `length_mm`, `width_mm`, `height_mm` with CHECK; `wms_package_contents` [DA §2.3]. `wms_products` carries `weight_g` and dimensions [DA §2.3].
5. **Surfaces.** `/wms/pack/[packageId]` [WEB §8, wave 3 rows]; `packPackage`.
6. **Permissions, roles, audit.** `wms.packing.write`; the consumption movement carries `recorded_by`.
7. **Dependencies and integrations.** Product dimensions (WMS-2); consumable products (DM §4.8).
8. **Metrics and reporting.** Box utilisation and box cost per package: not defined.
9. **Market and chosen shape.** ShipHero: the packer chooses a box, scans a box barcode, or automation pre-assigns it; weight from item weights or a scale; a history check blocks the label on a weight mismatch [SH H8, H9; SH §1.5]. Fulfillor: cartonization is a glossary term [FU F19]. Anchanto: custom packing lists and materials [AN §5.19]. Teardown verdict: box catalogue adapt, "box is chosen, not computed" (SH §5.13); WMS-7a (SH §6.5). Chosen (repo): measured dimensions only (W-10). Inference: a box can be a consumable product with dimensions, which needs no new aggregate.
10. **Roadmap mapping.** Partial: WMS-7 measures; box catalogue and suggestion Missing (CW P3, FC §3 WMS-11). OQ-14: is the catalogue per site or per account, and does the packer pick a box or does the system suggest one?

## 12. Item verification at pack

1. **Definition and user goal.** Before a package closes, each unit is scanned against the order, so a wrong item or count is caught before the parcel leaves.
2. **Workflow.** The bench builds `contents` (StockRef, `from_tote_id`, `fulfilment_order_line_id`) and posts them with `packPackage` [OAPI]. The contract records the declared contents. No scan event and no verification state exist.
3. **Business rules and edge cases.** No scan rule is written. ShipHero's Tote QA scans each item; with the setting off, picked items move to packed automatically [SH H8; SH §1.4]; its over-pack warning fires on scan [SH H8]. KSA and GCC: a wrong item is a return cost (inferred).
4. **Data.** Quantities only in `wms_package_contents`; no scan record. Barcodes exist per product, unique per account (`wms_product_barcodes`, DA §2.3). GS1 not modelled (Q-U5).
5. **Surfaces.** WEB-15 scanner-first screens (keyboard-wedge input; WEB §8 note). No audio cue specified (Fulfillor offers one, FU F6).
6. **Permissions, roles, audit.** `wms.packing.write`.
7. **Dependencies and integrations.** Barcodes (WMS-2); bench screens (WEB-15).
8. **Metrics and reporting.** Pack accuracy: named in the brief, not defined. Measurable only if scans and corrections are recorded, which the contract does not do.
9. **Market and chosen shape.** ShipHero: per-item scan verification at pack [SH H8; SH §5.12, verdict yes]. Fulfillor: audio on a wrong scan [FU F6]. Chosen (repo): none; the declared contents are the record.
10. **Roadmap mapping.** Partial: WEB-15 and WMS-7 cover the input device and counts; per-unit verification Missing (CW P3, FC §3 WMS-11). OQ-15: is per-unit scanning a required step for every order, or an account setting as ShipHero does?

## 13. Packing slips and labels

1. **Definition and user goal.** A packing slip lists what is in the parcel; a label is the sticker a carrier or the own fleet reads. The packer prints both and sticks the label.
2. **Workflow.** Carrier: the label is stored at `shipment created`; `getPackageLabel` returns a signed URL [OAPI; INT §7.1 step 4]. Own fleet: label content is not specified in any table or contract. Packing slip: no contract, table or screen.
3. **Business rules and edge cases.** Labels are PDFs at 10 × 15 cm and A6 at least (INT §7.7). Signed URL 60 minutes for print (INT §2.6). Labels are kept one year, then deleted by `storage_lifecycle` (INT §7.4). ADR-0016: every string in Arabic and English; Arabic label layout and RTL print are not specified. KSA: the National Address short code is on the snapshot and could print (DA §2.3); not specified. Invoices: ZATCA Phase 2 distinguishes standard invoices that are cleared before the buyer receives them from simplified invoices reported within 24 hours (secondary, [S], ZATCA guidance not read); whether a packing slip or delivery note may stand for an invoice is unanswered (Q-U7).
4. **Data.** `wms_packages`: `label_storage_key`, `awb`, `carrier_code`, `eeasy_shipment_id` [DA §2.3]; object `labels/{package_id}.pdf` [INT §2.6]. No slip key.
5. **Surfaces.** Bench print button; webhook `wms.package.shipment_created` with a label link [WH §5]; no slip document.
6. **Permissions, roles, audit.** `wms.fulfilment.read` for the label read [OAPI]. No audit.
7. **Dependencies and integrations.** Eeasy shipping label API (#885, Q-29); object storage (INT §2.6); ZATCA research (OPS-8 proposal, FC §3 and PC §4).
8. **Metrics and reporting.** Labels failed and dead (visible on the bench, INT §7.2); reprints: not defined.
9. **Market and chosen shape.** Anchanto: labels, packing lists and delivery slips generated automatically [AN §3.3; AN §5.20]. Extensiv packing slips [CW S19]. Torod auto-prints a label per rule [TO §5 row 3]. ShipHero: station printers Zebra, Rollo, Dymo and Bixolon [SH H22]. Chosen (repo): carrier label stored at creation and printed from a signed URL; no slip.
10. **Roadmap mapping.** Carrier labels: Covered (INT-8, WMS-7, wave 3, behind the allowlist until Q-29). Own-fleet label: Partial (WMS-7 lists "labels"; DEL-20, wave 2 proposal, adds printable own-fleet order labels). Packing slip: Missing (CW Q-U7). OQ-16: the own-fleet label content and wave; OQ-17: is a packing slip in scope, in which languages, and does the Salla or Zid invoice serve instead (Q-U7; OPS-8)?

## 14. Fulfilment options: the own-fleet card and carrier cards

1. **Definition and user goal.** At the bench the packer picks how a measured package leaves: the merchant's own fleet (a Delivery order in this product) or a carrier (an Eeasy shipping shipment). One list, two peer kinds (ADR-0014).
2. **Workflow.** `getFulfilmentOptions` returns `own_fleet {available, reason}` and the `carriers` list [OAPI]. `chooseFulfilmentMethod(method, carrier_code?, slot_id?)`: own fleet calls `OwnFleetOrderPort.createFromPackage` in the same transaction and moves packed→ready (W-11); carrier writes a `carrier_call` outbox row and moves packed→awaiting_label (W-12) [DM §1.1, §4.14; INT §7.1]. A dead carrier job moves the package back to packed with the method cleared and a reason (INT §7.2). `clearFulfilmentMethod` moves ready→packed before pickup (W-13). Timeouts: quote 4 s, create 20 s, cancel 10 s (INT §2.7).
3. **Business rules and edge cases.** A method needs a measured package (W-10). The own-fleet card appears only when `CoverageQuery` covers the point from this site (ADR-0015; DM §1.1; D1 §2.5); refusal is `422 outside_coverage`. One active method per package; a change after `handed_over` is `409 method_change_forbidden` (W-13). Carrier rejections return `503 carrier_unavailable` on choose. Prices shown are Eeasy's; this product computes none (W-12, ADR-0001). Inference: `CoverageQuery` takes a point (D1 §2.5), so an address with no geocoded point cannot be checked. `slot_id` is accepted by the contract, but DEL-2 refuses `slot_id` until the slots order ships (D2 §2.3 and §2a). KSA and GCC: the carrier set is whatever Eeasy shipping exposes (#885, Q-29, go or no-go on 2027-01-15).
4. **Data.** `wms_packages`: `fulfilment_method` CHECK (own_fleet, carrier), `delivery_order_id` (opaque, unique when set), `carrier_code`, `awb`, `label_storage_key`, `eeasy_shipment_id`, `status` [DA §2.3]. Missing column: INT §7.1 and §7.2 use `method_generation` in the idempotency key `{package_id}:{method_generation}` (INT §2.7), but no table names it. Retention: not stated.
5. **Surfaces.** Method card on `/wms/pack/[packageId]` [WEB §8]; `getFulfilmentOptions`, `chooseFulfilmentMethod`, `clearFulfilmentMethod` [OAPI]. Webhooks `wms.package.shipment_created` and `wms.package.handed_over` [WH §5].
6. **Permissions, roles, audit.** Choose and clear: `wms.packing.write`. No approval step. Carrier cost is incurred at Eeasy and not approved here. Audit: none catalogued.
7. **Dependencies and integrations.** DEL-2 intake with `source wms_package` (D2 §2.10); CoverageQuery (DEL-1); Eeasy shipping (INT-8, #885); outbox (ADR-0024); the allowlist for carrier cards (RM INT-8).
8. **Metrics and reporting.** Share of packages by method; own-fleet refusals by reason; carrier dead jobs. Not defined; the reasons are typed in the contract.
9. **Market and chosen shape.** Torod compares carriers per order and the merchant picks one [TO §2 product map]. Omniful routes carriers by rules over a quote step [OM §2.4]. ShipHero's RateShop+ prices carriers, which ADR-0001 excludes [SH §1.5]. Teardown verdicts: carrier choice by rules over the existing `quote` port, adapt (OM §5.25). Chosen (repo): one list, the packer chooses, the own-fleet card is a peer of carrier cards (ADR-0014); no rule.
10. **Roadmap mapping.** Own-fleet card: Covered (WMS-7, wave 3, in the wave 3 exit criterion RM §2). Carrier cards: Covered by INT-8 (wave 3, behind the allowlist until Q-29). Missing column `method_generation`. OQ-18: is a slot chosen at pack in wave 3 (the contract allows it, DEL-2 refuses it)? OQ-19: does the owner want rule-based carrier choice (feature 15)?

## 15. Pack-time carrier and label rules

1. **Definition and user goal.** Rules that choose the method and print the label from package facts (zone, weight band, COD flag, shipment type), so the packer does not choose each time.
2. **Workflow.** None. The packer chooses the method by hand (feature 14). No rule is evaluated and no rule record exists.
3. **Business rules and edge cases.** None written. ADR-0014: the merchant picks from one list. INT §7.5 says carrier selection rules stay in Eeasy shipping. The teardown proposals choose between the own fleet and an INT-8 option in this product, which sits on that boundary (inferred; ruling needed). ADR-0006: risky features start behind an allowlist.
4. **Data.** None.
5. **Surfaces.** None; a rule list would be a new settings surface.
6. **Permissions, roles, audit.** None defined.
7. **Dependencies and integrations.** INT-8, Q-29, ADR-0006; COD per package (feature 16).
8. **Metrics and reporting.** Rule hit rate, override rate: not defined.
9. **Market and chosen shape.** Torod: ordered first-match rules on conditions with actions "choose a company" and "auto-print waybill"; no dry run [TO §2 automation; TO T23]; the teardown proposes a bounded list with a default rule, a dry run and the allowlist (TO A3). ShipHero: 58 triggers and 64 actions, applied top-down and not retroactively [SH H12, H13]; teardown verdict no for a general engine, adapt a bounded set (SH §5.4). Platform comparison names ordered first-match lists as a convergent pattern [PC §2]. Chosen (repo): none; manual choice (ADR-0014).
10. **Roadmap mapping.** Missing. Proposals: INT-16 (PC §4), TO A3, OM §6.5 (INT-8 amendment). OQ-19 above; OQ-20: does rule-based choice fall inside "carrier selection rules stay in Eeasy shipping" (INT §7.5)?

## 16. Packages and multi-parcel

1. **Definition and user goal.** One fulfilment order ships as several parcels, each with its own weight, dimensions, method, label and, for the own fleet, its own Delivery order.
2. **Workflow.** `openPackage` any number of times per fulfilment order; each package is packed, takes a method and is handed over. The order is `completed` when every package is delivered [DM §4.12]. `wms.fulfilment_order.completed` lists packages with method, delivery order number and AWB [WH §5.1]. Cancel: open or packed only.
3. **Business rules and edge cases.** A package has one active method (W-13). Each own-fleet package creates a Delivery order (DM §1.1), so a three-parcel order makes three Delivery orders for one recipient (inferred). The COD amount sits on the fulfilment order (DA §2.3), and nothing says which parcel carries it (see Summary item 2). Torod lets the merchant edit the box count after creation [TO T26]. KSA and GCC: a COD split across parcels is unspecified.
4. **Data.** `wms_packages` (`fulfilment_order_id`, `delivery_order_id` unique when set); `wms_package_contents` [DA §2.3]. No parcel number, no parcel count on the order.
5. **Surfaces.** Package list (`listPackages` filters by order and method) [OAPI]; bench; webhook `wms.fulfilment_order.completed`.
6. **Permissions, roles, audit.** `wms.packing.write`; no audit.
7. **Dependencies and integrations.** DEL-2 (one order per own-fleet package, D2 §2.10); INT-8 (one shipment per carrier package, INT §7.1).
8. **Metrics and reporting.** Parcels per order; packages per order: not defined.
9. **Market and chosen shape.** ShipHero: "Add Another Package" splits oversized orders; containers and labels added in 2026 [SH H8; SH §1.5]; teardown verdict already (SH §5.42). Anchanto: multi-parcel and split across warehouses [AN §5.5]. Omniful consolidates several orders into one shipment [OM §2.2], the opposite direction. Chosen (repo): packages per fulfilment order (DM §4.7).
10. **Roadmap mapping.** Covered (WMS-7). Missing: COD per parcel, parcel count, and consolidation of several orders into one shipment (not proposed). OQ-21: does COD go on one parcel, all parcels, or the last one, and does a Delivery order per parcel carry the COD?

## 17. Handoff to the driver, the dispatch scan and cutoffs

1. **Definition and user goal.** The moment a package leaves the warehouse: when the driver scans it up (own fleet), or when the carrier collects it. The record gives custody and moves the stock out of the warehouse books in steps.
2. **Workflow.** Own fleet: the package waits at `dock` (DM §4.1); the driver's pickup scan moves the Delivery order to `picked_up` (DM §3.13, DRV-4); Delivery emits `delivery.order.picked_up`; WMS moves the package to handed_over and stock dock→transit (W-14; DM §5.1). Carrier: staff call `handOverPackage` at the carrier pickup (ready→handed_over) [OAPI]; the carrier's first scan arrives as `core.carrier_update.received` and moves stock to transit (INT §7.3). Delivered: `delivery.order.delivered` moves transit→CUSTOMER and completes the order (W-14). Actors: driver; staff; system.
3. **Business rules and edge cases.** W-14 steps are idempotent per package through consumer receipts (DM §4.16). Q-2 default: stock leaves the books at delivery, not at pickup (RM §4). No cutoff, service-day or pickup-window object exists in the repo; carrier pickup scheduling stays with Eeasy shipping (INT §7.5). KSA and GCC: the weekend is Friday and Saturday and the working week Sunday to Thursday since a royal order of 2013 (search summary, [S]); a Thursday cutoff therefore reaches a non-working Friday (inferred). Business dates are Asia/Riyadh (DA §9, nightly job at 02:00). Ramadan: MHRSD announced six hours a day for private-sector work in Ramadan 2022 under Article 98, as reported by Ajel [F, secondary]; a 2016 source in search results says seven, and the figure must be checked each year. Shorter warehouse shifts have no model in the repo. No holiday calendar exists.
4. **Data.** Package `status`; stock moves are movements with reasons `handover` and `delivery` (DM §4.4). The package has `version` and no state-time column [DA §2.3]. No cutoff table, no manifest table.
5. **Surfaces.** Bench carrier hand-over; driver app pickup by scan (DRV-4, RM); webhooks `wms.package.handed_over`, `wms.fulfilment_order.completed` [WH §5]. No staff dispatch screen or manifest.
6. **Permissions, roles, audit.** Carrier hand-over: `wms.packing.write`. Driver actions: `delivery.driver.work` [CON roles]. No audit row for the staff hand-over.
7. **Dependencies and integrations.** DEL-6 dispatch; DRV-4 pickup scan; Eeasy shipping tracking (INT-8, §7.3); Q-2.
8. **Metrics and reporting.** Cutoff compliance (named in the brief): not definable, because no cutoff is stored. Time from ready to handed_over: derivable only from event timestamps, which the events carry (DM §6.1 envelope).
9. **Market and chosen shape.** Shipsy has dispatch staging and handover [CW S8]; Anchanto has a dispatch module with detail not published [AN §3.3]; Omniful lists dispatch controls for peak volume as a claim [OM §2.2]. Teardown verdict for Anchanto row 25: no change, decided (AN §5.25). Platform comparison names exception and missed-SLA rules as a pattern [PC §2]. Chosen (repo): pickup scan by the driver and a carrier hand-over by staff.
10. **Roadmap mapping.** Own-fleet handoff: Covered (WMS-7, DRV-4). Carrier hand-over: Covered (INT-8). Cutoffs: Missing. Staff dispatch scan and manifest: Missing (CW Q-U13). OQ-22: the cutoff per site and per carrier, and the weekend and Ramadan service days. OQ-23: is a staff dispatch scan required before the driver scans?

## 18. B2B and wholesale fulfilment with case and pallet units

1. **Definition and user goal.** Orders from business buyers, with a purchase-order reference, case or pallet lines, and invoices (sometimes EDI), shipped from the same stock.
2. **Workflow.** None. Fulfilment order `source` is channel, manual or api only (DA §2.3); no PO-reference field; no case or pallet pick.
3. **Business rules and edge cases.** None written. KSA: a B2B invoice is cleared by ZATCA before it reaches the buyer (secondary search, [S], ZATCA guidance not read; Q-U7). ADR-0002 and ADR-0005 scope the product to merchants' own stock and fleets; a 3PL client model is outside (DM §1.1 scope; FC §2 item 5).
4. **Data.** `wms_products.unit` is a single text unit; no unit-of-measure conversion table and no case or pallet entity (DA §2.3; CW Module 1).
5. **Surfaces.** None.
6. **Permissions, roles, audit.** None.
7. **Dependencies and integrations.** Unit-of-measure work on WMS-2; ZATCA research (OPS-8 proposal); Q-U2 (customer type: 3PL or merchant).
8. **Metrics and reporting.** None.
9. **Market and chosen shape.** Extensiv has a B2B order type with 3PL billing [CW S19]; Omniful breaks pallets into cases or units [OM §2.2]; ShipHero has wholesale EDI [SH §1.7]; Anchanto has transfer orders between stores as B2B [AN §5.24]. Chosen (repo): none; the scope question is open.
10. **Roadmap mapping.** Missing (post-4 or not scheduled; FC §3 WMS-16 for a 3PL or wholesale client). OQ-24: is a wholesale buyer in scope for the pilot; does the account hold other businesses' stock (Q-U2)?

## 19. Outbound KPIs

1. **Definition and user goal.** Floor measures for the owner and the warehouse lead: pick rate, short-pick rate, pack accuracy, cutoff compliance, allocation fill, and the age of on-hold orders.
2. **Workflow.** Reporting only; no operator action.
3. **Business rules and edge cases.** No KPI definition exists in the repo. Closed days roll up nightly into `rpt_daily_kpis` at 02:00 Asia/Riyadh; today's figures come from live views (DA §9). Friday and Saturday weekends (feature 17) and the Ramadan hours change the denominators (inferred). Per-person measures expose staff data; the PDPL position is open (FC §2 item 4).
4. **Data.** `rpt_daily_kpis` has no outbound columns defined (DA §9). Inputs: pick movements with `ref_type` and `recorded_by` (DA §2.3); short tasks and on_hold events; package events. Missing inputs: a cutoff, a pack-correction record and a scan record.
5. **Surfaces.** Pilot dashboards on `rpt_order_fulfilment` (DA §9). No outbound KPI screen in WEB §8.
6. **Permissions, roles, audit.** Not defined. The reporting module imports no context schema and writes nothing (DA §9).
7. **Dependencies and integrations.** Ledger (ADR-0011); events (DM §6.3); RPT-1 exports (FC §3, wave 2 proposal); DEL-17 scorecards (wave 4).
8. **Metrics and reporting.** This aspect. Pick rate: units per labour hour (needs a labour input the repo lacks). Short-pick rate: short lines ÷ lines picked. Pack accuracy: packages without a correction ÷ packages. Cutoff compliance: packages handed over before the cutoff ÷ packages ready by it. None is defined as a table.
9. **Market and chosen shape.** ShipHero has a picker score and a live pickers board [SH §1.9; SH §5.31, adapt as a read-only report over the ledger]. Anchanto has KPI panels with week-on-week change and missed-SLA counts [AN §5.29, yes, shape]. Fulfillor has dashboards across orders and inventory [FU §5.29]. Chosen (repo): read-only views over the ledger and events, no new ledger (ADR-0011; Q-32).
10. **Roadmap mapping.** Missing for the outbound floor. DEL-17 covers delivery SLA (wave 4). OQ-25: which four or six metrics, with what targets, does the pilot report? OQ-26: may managers see per-picker measures?

## Feature index

| Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|
| 1 Fulfilment orders and sources | Partial | WMS-6; INT-11; INT-9 | 3 (manual), 4 (channel, API) | OQ-1 channel-order site; Q-30, Q-34 |
| 2 Allocation rules per site and default | Partial | WMS-6; WMS-9 proposal | 3 | Q-31, Q-U9; OQ-2 multi-site default |
| 3 Reservations | Covered, defects | WMS-6 | 3 | OQ-3 short-line reservation |
| 4 Holds and release | Partial | WMS-6; DEL-31 and WMS-4a proposals | 3 | OQ-4 hold scope; OQ-5 release role |
| 5 Partial fulfilment and backorders | Missing | WMS-6a proposal | proposal | OQ-6 default; OQ-7 COD on remainder |
| 6 Waves and batches | Partial | WMS-6; WMS-6a proposal | 3 | OQ-8 timed release; Q-31 volume |
| 7 Pick strategies | Partial (single covered) | WMS-6; WMS-6b proposal | 3 (single, batch, tote), proposal (zone, cluster) | OQ-9 pilot strategy and tote per order |
| 8 Pick tasks and short picks | Covered, gaps | WMS-6 | 3 | OQ-10 short clearance; OQ-11 `line_id` |
| 9 Lot and serial capture at pick | Covered | WMS-2, WMS-6 | 3 | OQ-12 unknown lot at pick; Q-U5 GS1 |
| 10 FEFO and expiry | Missing | WMS-6 (none); WMS-6a and WMS-2a proposals | proposal | OQ-13 default rule; Q-U4 |
| 11 Packing bench and box catalogue | Partial | WMS-7; WMS-11 proposal | 3 (measure), proposal (box) | OQ-14 catalogue scope and suggestion |
| 12 Item verification at pack | Partial | WEB-15; WMS-11 proposal | 3 | OQ-15 per-unit scan required |
| 13 Packing slips and labels | Partial | INT-8; WMS-7; DEL-20 proposal | 3 (carrier label), 2 (own-fleet label, proposal) | OQ-16 own-fleet label; OQ-17, Q-U7 slip and invoice |
| 14 Fulfilment options: own fleet and carriers | Covered (carriers behind allowlist) | WMS-7; INT-8 | 3 | Q-29; OQ-18 slot at pack |
| 15 Pack-time carrier and label rules | Missing | INT-16 proposal | proposal | OQ-19 rule-based choice; OQ-20 boundary with INT §7.5 |
| 16 Packages and multi-parcel | Covered, COD gap | WMS-7 | 3 | OQ-21 COD per parcel |
| 17 Handoff, dispatch scan and cutoffs | Partial | WMS-7; DRV-4; INT-8 | 3 | OQ-22 cutoffs and service days; OQ-23 staff scan |
| 18 B2B and wholesale | Missing | WMS-16 proposal | post-4, unscheduled | Q-U2; OQ-24 pilot scope |
| 19 Outbound KPIs | Missing | none (DEL-17 for delivery) | 4 (delivery), none (floor) | OQ-25 metrics and targets; OQ-26 per-picker view |

## Sources

Repo (`origin/main` 6ca087e, read 2026-11-02; paths relative to the repo root):
- DM: `docs/architecture/domain-model.md` §1.1, §2.3, §3.1, §3.13, §4.1 to §4.16, §5 (flow 5.1), §6.3, §9.
- DA: `docs/architecture/data.md` §2.1 (`core_channel_connections`, `core_outbox`), §2.3 (WMS tables), §3.3 (StockSummary projector), §3.4, §7, §9, §10. The brief cites §2.1 for outbound rows; the WMS rows are §2.3.
- INT: `docs/architecture/integrations.md` §2.6 (`ObjectStorage`), §2.7 (`CarrierShipments`), §3.3 (channel re-map note), §4 (outbox kinds), §7.1 to §7.7 (carrier handoff, labels, #885), §8.3 (channel orders).
- WEB: `docs/architecture/web.md` §8 (WMS screens, rows 3 and 4) and the WMS stream note.
- OAPI: `docs/contracts/openapi/staff-wms.yaml` fulfilment, picking, packing paths and `PackRequest`, `PickRequest`, `ShortPickRequest`, `ChooseMethodRequest`, `FulfilmentOptions`.
- CON: `docs/contracts/README.md` (permission strings, role bundles, API key scope). WH: `docs/contracts/webhooks.md` §4, §5, §5.1.
- RM: `docs/roadmap.md` §1.4 (WMS-6, WMS-7, INT-8, WEB-15), §1.5 (INT-9, INT-11), §2 (wave 3 exit), §4 (Q-2, Q-29, Q-30, Q-31, Q-32, Q-34, Q-36).
- D1: `docs/orders/DEL-1/plan.md` §2.5. D2: `docs/orders/DEL-2/plan.md` §2.3, §2.10, note on `slot_id`.
- ADR: `adr/0001`, `0005`, `0006`, `0011`, `0012`, `0014`, `0015`, `0016`, `0018`, `0024` (accepted, files in `adr/`).

Remote research (read 2026-11-02 with `git show`):
- CW: `origin/docs/feature-coverage:docs/research/features-wms-2026-11.md`, module 3 rows and the Sources list (S1, S2, S8, S16, S19, S26); Q-U1 to Q-U14.
- FC: `origin/docs/feature-coverage:docs/research/feature-coverage-2026-11.md` §2 to §4 (WMS-9 to WMS-17 proposals, owner questions).
- SH: `origin/docs/platform-teardowns:docs/research/shiphero-teardown-2026-11.md` §1.3 to §1.5, §4.3 to §4.5, §5 (rows and verdicts), §6 (WMS-6a to WMS-7a), and its Source registry (H1 to H22, D2, D12, D17).
- OM: `teardown-omniful-2026-11.md` §2.2 to §2.4, §4.4 to §4.6, §5 rows, §6; source O4, O5, O7, O9, O10, O24, O27 (`https://omniful.ai/knowledge-base/order-management/feature-partial-order-fulfilment` for O10).
- AN: `teardown-anchanto-2026-11.md` §3.3, §5 rows, §6 (P1 to P8), source A2, A4, A17 (`https://anchanto.com/presenting-the-multi-warehousing-feature-for-anchanto-oms/`), S2, S4.
- TO: `teardown-torod-2026-11.md` §2, §5 rows, §6 (A1 to A6), source T23 (`https://help.torod.co/ar/support/solutions/articles/10000017416`), T26 (`…/10000017395`), T28 (`https://docs.torod.co/`).
- FU: `teardown-fulfillor-2026-11.md` §2, §5 rows, §6 (A1 to A8), sources F6 (`https://fulfillor.com/help/changelog`), F11 (`https://fulfillor.com/warehouse-lot-tracking`), F16 (`https://fulfillor.com/warehouse-management-software`), F19 (`https://fulfillor.com/glossary`).
- PC: `origin/docs/platform-teardowns:docs/research/platform-comparison-2026-11.md` §2, §4, §5.

Web (read 2026-11-02, [S] search summary unless stated):
- MHRSD Ramadan hours, 2022, as reported: `https://english.ajel.sa/news/saudi-arabia/mhrsd-announces-ramadan-working-hours-for-private-sector` [F, fetched]; a conflicting 2016 figure appeared in search results [S].
- Saudi weekend change, 2013: `https://www.crowell.com/en/insights/client-alerts/saudi-arabia-changes-weekend-to-friday-saturday-from-29-june-2013` [S].
- ZATCA Phase 2 models (standard and simplified invoices): search summary only, `https://cleartax.com/ksa/ksa-einvoicing` [S]; ZATCA's own guidance was not read.
- Help-centre articles cited above: ShipHero `https://software-help.shiphero.com/hc/en-us/articles/<id>` for H1 (4419336440333), H5 (46726660678285), H8 (4419345190925), H9 (11801446343309), H11 (4419362009613), H12 (48079897846413), H13 (49618365551373), H14 (46376927001613); Torod T23 and T26 as above.

Unanswered (the parts no source settled):
- Whether the outbound `available` guard counts tote, dock and transit stock: the docs say both (DA §3.3, DM §4.10).
- Which id a pick or short-pick `line_id` refers to (OAPI).
- Whether a short line keeps its reservation, and who may release an on-hold order.
- Which package carries COD, and whether each own-fleet parcel gets the COD on its Delivery order.
- Own-fleet label content and wave (DM §1.1 says the packer needs it; RM lists labels in WMS-7; DEL-20 proposes it in wave 2).
- Whether a channel order has a site, and how the connection maps to it.
- Cutoff times per site and carrier; the weekend and Ramadan working days and hours for the pilot merchant.
- Ramadan 2027 hours (the 2022 announcement is the latest read; a 2016 source conflicts).
- Whether a packing slip or delivery note may stand for an invoice under ZATCA; the Arabic slip layout.
- Whether pick, pack and hand-over must be done by different people (no separation in the contracts).
- Whether a carrier hand-over counts when staff call `handOverPackage` or when the carrier's first scan arrives (INT §7.3); both move the package to handed_over, and the docs do not say which one is the record.
- Whether ShipHero's holds block allocation or picking (SH unanswered), and whether a short pick reopens after restock (no source).
