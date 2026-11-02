# Feature book 08: WMS setup and inventory

Date: 2026-11-02. Status: research input for the lead; no decision taken; the roadmap does not change. Scope: locations and totes, catalogue, identifiers, units, lots, serials, expiry, kits, multi-site scope, the stock ledger and projections, adjustments, counts, low-stock alerts, valuation, labels and channel stock visibility, for merchants with their own stock in KSA and the GCC.

Repo facts were read at `origin/main` 6ca087e on 2026-11-02. Research notes were read with `git show` on 2026-11-02 from `origin/docs/feature-coverage` (7396dcc) and `origin/docs/platform-teardowns` (d75ed6f). External checks were made on 2026-11-02. Source tags are listed at the end.

## Summary for the lead

1. The ledger spine (locations, lots, serials, append-only movements, projections, nightly assertions) is specified in ADR-0011, ADR-0012 and domain §4, and is the strongest part. None of WMS-1 to WMS-5 is merged (roadmap §0 lists no WMS row).
2. Missing from every order: a FEFO or expiry rule, expired-stock exclusion, variants, units of measure, kits, valuation, low-stock alerts, count schedules, location labels and per-site channel allocation.
3. Proposed shapes that differ from roadmap rows: FEFO and expiry exclusion in WMS-6 (wave 3); variants before WEB-13 (wave 3); low-stock alerts (wave 3, no row today); count schedules and a two-consecutive-agree recount in WMS-5 (wave 3); inter-site transfers and location labels as WMS-1/WMS-3 extensions (wave 3 if the pilot is multi-site); a buffer at publish in INT-12 (wave 4).
4. Handheld: WEB-15 is web-only by ruling; four research notes propose a warehouse handheld app under four different ids (WMS-18, WMS-9, WMS-10, WH-1). This is an owner decision, not a roadmap fact.
5. Contract gap: `StockSummary` is keyed by (account, product) (DATA 2.3), so a multi-site merchant cannot see or publish available quantity per site. Per-site allocation is proposed by two notes and no order owns it.
6. Contract gap: `moveTote` requires `wms.locations.manage`, which warehouse staff do not hold (OAPI moveTote, ROLES). Floor staff cannot move a tote as written.
7. Definition conflict: available quantity is "over pickable locations of the site" (DM 4.10) but StockSummary on_hand sums all non-system locations account-wide (DATA 3.3). Pick one before WMS-3 is built.
8. Valuation has no aggregate and movements carry no cost. Adding cost to the append-only table is a ledger migration, a one-way door. The adjustment threshold cannot be value-based until the owner rules.
9. Order ids collide across notes: WMS-9 means variants (FCOV), transfers (OM), handheld app (FF) and site routing (AN). WMS-10 means pick strategies, FEFO and a scanner app in different notes. ADR-0031 (ledger writer, required by WMS-3) is still proposed.
10. Twenty-five owner questions (OQ8-1 to OQ8-25) follow the index. Q-2 and Q-17 are existing roadmap register items; the others are new.

## Conventions

- **Chosen (repo)** means what an accepted ADR, the domain model, data, the contract or a roadmap row fixes today. Where the repo fixes nothing, the aspect says "none chosen".
- **Proposed** means a research note's or teardown's recommendation. Nothing here is decided. Teardown verdicts (yes, adapt, no) are quoted, not adopted.
- Each feature carries the ten aspects as numbered items 1 to 10 in the fixed order. The 650-line cap rules out a heading per aspect, so the aspects are bold items, as in chapter 04.
- Roadmap rows use "W-n" for foundation-plan work items (roadmap §1.4). Domain invariants W-1 to W-18 are cited as "W-n" with the section. The two are different.
- Source tags are in brackets; the registry at the end gives paths, URLs and read dates.

## 1. Location tree, zones and pick faces

1. **Definition.** A per-site tree of storage positions (site root, zone, aisle, rack, shelf, bin, plus dock, transit, returns, quarantine, system) where stock sits and pick tasks address. User goal: staff find, count and pick stock by position [DM 4.1; ADR-0012].
2. **Workflow.** `createLocation` (201; `location_tree_invalid`, `site_kind_mismatch`); `updateLocation` changes code, pickable, active. No delete operation; deactivation is `active=false`. Happy path: warehouse site, then zones, racks, bins. No rule stops deactivating a location that still holds stock (K-5 covers sites only) [OAPI; DM K-5].
3. **Rules and edge cases.** W-1 (same-site parent, no cycles, warehouse or both sites only, K-4). Pick faces have no separate type; `pickable` is the only flag. ShipHero also has `sellable`, `staging` and `is_hospital` [DM 4.1; SH 1.1]. No KSA or GCC source states a location-code rule.
4. **Data.** `wms_locations`: site_id, parent_id, type CHECK (12 values), code, generated display `path`, coordinates jsonb, pickable, active. Unique (account, site, code) NULLS NOT DISTINCT; CHECK system if and only if no site. Mutable, not append-only; `path` is rewritten on move [DATA 2.3].
5. **Surfaces.** Web `/wms/locations` (WEB-13). Five operations in OAPI. No handheld; WEB-15 is web scanner-first [WEB; RM WEB-15].
6. **Permissions.** Read `wms.locations.read` (owner, admin, warehouse_staff, viewer). Manage `wms.locations.manage` (owner, admin). Site restriction by membership `site_ids` [ROLES; IDT 2]. K-7 requires an audit row in the same transaction for admin actions; the contract names none for location edits [DM 2.5].
7. **Dependencies.** Sites (PLAT-12 merged, roadmap §0; ADR-0018). Labels (item 19). Hub ADR if hubs are ruled in [PCMP 5].
8. **Metrics.** None defined. Candidates from the schema (not defined in docs): locations with no stock; inactive locations holding stock.
9. **Market and our shape.** Zid multi-warehouse [FWMS S1]; Shipsy fixed-bin and velocity slotting [FWMS S8]; ShipHero dynamic slotting deprecated 2026-10-13 and bulk location creation of up to 1,300 names per call [SH 1.1, D8, D12]; Omniful hubs [OM 2.2]. Chosen (repo): own tree, ADR-0012 and ADR-0018. Proposed: none for slotting (ShipHero row 41, "no"). Bulk create is a cheap borrow with no order yet.
10. **Roadmap.** Covered: WMS-1 (wave 3; depends PLAT-13), WEB-13. Partial: zones are a type with no rules; pick faces not modelled; pick-face replenishment missing (proposed wave 4, FWMS P8). Owner: OQ8-7.

## 2. Totes and LPNs

1. **Definition.** A tote is a movable location that holds picked lines for one order or run. An LPN (license plate) is a carrier ID for received goods on put-away. User goal: pickers move several orders' lines without mixing them [DM 4.1; SH H2, H19].
2. **Workflow.** Tote created as location type `tote`. `moveTote` writes one transfer movement batch for the contents. Pick task names `target_tote_id`; each pick moves stock from bin to tote (W-9); pack moves tote contents to `dock` (W-14). A tote never contains a tote (W-2). No LPN entity exists in domain or data [OAPI moveTote; DM 4.1, 4.16; DATA 2.3].
3. **Rules and edge cases.** W-2: parent changes only through a transfer batch. KSA and GCC: none sourced. ShipHero uses one tote per order in multi-item batch picks, with a default tote count and pre-sorted totes for packers [SH H1]. Need for totes is multi-order runs, not single parcels (inferred) [FWMS module 1].
4. **Data.** A tote is a `wms_locations` row with type `tote`. Pick task has `target_tote_id`. Movements carry from and to locations. No tote barcode field and no LPN table [DATA 2.3]. Movements are append-only; tote rows are mutable.
5. **Surfaces.** Web `/wms/locations` (move) and `/wms/pick` (target tote) [WEB]. Handheld: none chosen.
6. **Permissions.** `moveTote` requires `wms.locations.manage` (owner, admin). Warehouse staff hold only `locations.read`, so the contract as written blocks floor staff from moving a tote (conflict with W-14, which moves totes to dock at pack) [OAPI moveTote; ROLES]. Pick into a tote needs `wms.picking.write` (warehouse_staff) [ROLES].
7. **Dependencies.** Pick tasks (WMS-6), packing (WMS-7), labels (item 19).
8. **Metrics.** None defined. Candidates: tote age at dock; totes not cleared after a run.
9. **Market and our shape.** ShipHero: totes created per warehouse and never shared, with View, Create, Edit, Delete permissions; stock leaves the bin when picked into a tote [SH H2, D12]. Shipsy handling-unit management [FWMS S8]. Chosen (repo): movable tote, ADR-0012 and W-2. LPN: none chosen. Proposed: tote per order as the default picking unit (SH teardown row 6, "yes").
10. **Roadmap.** Covered: totes in WMS-1; target tote in WMS-6; W-2, W-9. Missing: LPN for receiving put-away (no row). Permission gap in moveTote is not in any roadmap row. Owner: OQ8-17, OQ8-22.

## 3. Product catalogue, variants and options

1. **Definition.** A product master per account: SKU, barcodes, bilingual name, tracking mode (none, lot, serial), unit, weight and dimensions, consumable flag, active. Variants (size, colour) with stock and alerts per option are not modelled [DM 4.2; DATA 2.3].
2. **Workflow.** `createProduct`; `updateProduct` (tracking mode locked after the first movement, 409 `tracking_mode_locked`, W-3); `listProducts` filters by barcode, SKU, active; `listLots` and `listSerials` per product [OAPI]. Exceptions: `validation_failed`; duplicate SKU refused by unique key.
3. **Rules and edge cases.** W-3. AGENTS.md and ADR-0016 require Arabic and English for every string, but DATA 2.3 does not say whether `name_ar` and `name_en` are required. Salla sells options by default and sets per-option quantities and minimums [FWMS S2 (marked old, Special plan only), S3]. No market source addresses Arabic name search or transliteration.
4. **Data.** `wms_products`: sku, name_ar, name_en, tracking_mode CHECK, unit, weight_g, length_mm, width_mm, height_mm, is_consumable, active; unique (account, sku). `wms_product_barcodes`: unique (account, barcode). No parent or option table [DATA 2.3]. Mutable.
5. **Surfaces.** Web `/wms/products` and detail (WEB-13). Channel product mapping built at connect by SKU and editable [INT 8.4].
6. **Permissions.** Read `wms.products.read` (owner, admin, warehouse_staff, viewer). Manage `wms.products.manage` (owner, admin) [ROLES].
7. **Dependencies.** Channel SKU mapping (INT-11, INT-12); barcodes (item 4); lots and serials (items 6, 7); units (item 5).
8. **Metrics.** None defined. Candidates: SKUs with no barcode; SKUs not mapped to a channel.
9. **Market and our shape.** Salla per-option quantities and minimums [FWMS S2, S3]; Zid per-warehouse quantities [FWMS S1]; Shopify bundles with component SKUs [FF F6, Jul 2026]; ShipHero product flags such as `must_ship_alone` and `auto_pack` [SH 1.1, D2]. Chosen (repo): product without variants, DM 4.2. Proposed: options as child SKUs with stock and alerts per option, before WEB-13 (FCOV section 3 "WMS-9"; FWMS P1 "WMS-2a"). Needs OQ8-1.
10. **Roadmap.** Covered: WMS-2 (product, tracking mode, lots, serials). Missing: variants, no row. Owner: OQ8-1.

## 4. Barcodes and GS1 identifiers

1. **Definition.** Barcode strings that a scanner resolves to a product, location or lot. GS1 identifiers add GTIN validation and GS1-128 encoding of lot and expiry on labels [DATA 2.3; FWMS S16].
2. **Workflow.** Barcodes attached to a product. `listProducts?barcode=` resolves a scan. Scanning at receipt and pick is web (WEB-15). No GS1 parse or validation step exists in any contract [OAPI listProducts; RM WEB-15].
3. **Rules and edge cases.** Barcode unique per account [DATA 2.3]. KSA: the SASO on-product rule from 1 Oct 2026 requires the Saudi supplier's name and CR number on the product for ten named technical regulations (LPG tankers, watercraft, child restraint systems and strollers, solar PV, electrical lifts and others). It requires no barcode and does not reach food or general retail [W1, read 2026-11-02; the SABER circular was not read]. SFDA drugs (search summary only, not checked against the guideline): a GS1 DataMatrix on each pack encoding GTIN, serial, expiry and batch (AI 01, 21, 17, 10), with transactions reported to a national track-and-trace system [W3]. Food: expiry is governed by SFDA.FD 150-1 "Mandatory expiration dates" [W2; text not read].
4. **Data.** `wms_product_barcodes(product_id, barcode)`. No symbology, GTIN length, check digit or GS1 company prefix column. Lots carry `lot_code` and `expiry_date` as separate columns, not a GS1-128 string [DATA 2.3]. Mutable.
5. **Surfaces.** Product screen (web). No label output (item 19).
6. **Permissions.** `wms.products.manage` to edit barcodes; read to scan [ROLES].
7. **Dependencies.** Label printing (item 19); channel SKU mapping (INT 8.4); pharma track-and-trace reporting if pharma is in scope (external, not in roadmap).
8. **Metrics.** None defined. Candidate: scans that resolve to no product.
9. **Market and our shape.** Odoo ships EAN13 and EAN14, with GS1-128 for lot or expiry [FWMS S16]. ShipHero builds GS1 labels from the retailer's GS1 company prefix for EDI orders [SH 1.7; search only]. Anchanto claims batch and expiry control "for GCC compliance" [AN 3.2, claim, unverified]. Chosen (repo): barcode string only; GS1 not decided. Proposed: none in a row; OQ8-2.
10. **Roadmap.** Partial: WMS-2 has a barcode field, no GS1 validation or GS1-128 output. Owner: OQ8-2, OQ8-3, OQ8-24.

## 5. Units of measure and conversions

1. **Definition.** Buy, store and sell one product in several units (each, case, pallet) with a conversion factor [FWMS module 1].
2. **Workflow.** None. A product has one `unit` text field; PO lines and movements count that unit [DATA 2.3].
3. **Rules and edge cases.** None in the repo. Wholesale case and pallet buying is a B2B shape; its demand for this market is unverified (inferred from FWMS module 3).
4. **Data.** `wms_products.unit` only. No conversion table, no case or pallet quantity.
5. **Surfaces.** None.
6. **Permissions.** None defined.
7. **Dependencies.** B2B order type (FCOV WMS-16); pallet receipts; case picks.
8. **Metrics.** None.
9. **Market and our shape.** Odoo unit conversion on receipt [FWMS S16]; Shipsy multi-UoM [FWMS S7, search only]; Omniful breaks pallets into cases or units and regroups them [OM 2.2]; Fulfillor pallet and carton module [FF 2]; ShipHero wholesale cases, pallets and packing-layout import [SH 1.7]. Chosen (repo): none. Proposed: post-wave-4 (FWMS P9, FCOV WMS-16).
10. **Roadmap.** Missing; no row; not in roadmap §6. Owner: OQ8-4.

## 6. Lots (batch)

1. **Definition.** A lot is a batch of one product with a lot code, expiry date and receipt date. Stock of a lot-tracked product is on hand per lot [DM 4.2; W-4].
2. **Workflow.** Lot is captured on a receipt line with lot code and expiry (StockRef). Put-away and pick carry `lot_id` (W-4). `listLots` filters by `expiring_before`. No explicit lot-create operation exists; lot creation at receipt is inferred. Count and adjustment lines of the wrong mode return `tracking_mode_mismatch` (422) [OAPI listLots, components StockRef; DM W-4].
3. **Rules and edge cases.** W-4: `lot_id` present if and only if the mode is lot. Lot unique per (account, product, lot code). Whether expiry can be edited after receipt is not stated, and an edit would not appear in the ledger (gap). Shelf life for food, cosmetics and supplements in this climate is a relevance claim, inferred, not sourced. SFDA drug batch is part of the DataMatrix [W3, secondary].
4. **Data.** `wms_lots`: product_id, lot_code, expiry_date, received_at; unique (account, product, lot_code); index (account, expiry_date). Movements and stock levels carry `lot_id`; movements are append-only [DATA 2.3, 3.1].
5. **Surfaces.** Product detail lots list and receipt screen (WEB-13, WEB-14). No handheld.
6. **Permissions.** Receive: `wms.receipts.write` (warehouse_staff, owner, admin). View: `wms.products.read` [ROLES].
7. **Dependencies.** Receiving (WMS-4); FEFO (item 8); returns carry lots (WMS-8).
8. **Metrics.** None defined. Candidate: lots expiring within N days.
9. **Market and our shape.** ShipHero: lot priority, picking-disabled period, verify lot at pack, exclude expired quantity from available [SH D17]. Fulfillor: lot record with distinct dates, lot recorded at pick (Jul 2026) [FF 2, F11, F6]. Anchanto batch control (claim) [AN 3.2]. Chosen (repo): DM 4.2 and W-4; own, close to market. Proposed: exclude expired lots from available now, FEFO only after a ruling (SH teardown row 24).
10. **Roadmap.** Covered: WMS-2, WMS-3, WMS-4 capture and movement lot. Partial: expiry is used by no rule (item 8). Owner: OQ8-5, OQ8-6.

## 7. Serials

1. **Definition.** One unit per serial number, unique per product, on hand in exactly one location [DM 4.2].
2. **Workflow.** Received with `serial_number` at quantity 1; picked by `serial_id`; `listSerials` shows each serial with its location [OAPI listSerials]. A duplicate serial is refused by the unique key [DATA 2.3].
3. **Rules and edge cases.** W-4: serial movement quantity 1; a serial is on hand in at most one place (partial unique index where on_hand > 0). KSA and GCC: none sourced. One search summary says SFDA drug serials are at most 20 digits (unverified) [W3].
4. **Data.** `wms_serials` unique (account, product, serial_number). Partial unique on stock levels (serial_id) where on_hand > 0 [DATA 2.3]. Nightly assertion 3 checks no serial in two places [DATA 3.4].
5. **Surfaces.** Web serial list; receipt and pick screens.
6. **Permissions.** As lots (item 6).
7. **Dependencies.** Serial verification on return (WMS-8; not specified in any row).
8. **Metrics.** Nightly assertion 3 result (drift count, target zero).
9. **Market and our shape.** Odoo lot and serial [FWMS S16]; Cin7 serials [FWMS S22, search]; Extensiv serial on item record [FWMS S19]; Fulfillor lot and serial tracking adapts to capture settings (Jan 2026) [FF 2]; Anchanto serialised inventory for electronics and pharma (claim) [AN 3.2]. Chosen (repo): DM 4.2 and W-4, matching market practice. Proposed: none.
10. **Roadmap.** Covered: WMS-2, WMS-3. Missing: serial verification at return (WMS-8). No owner question open.

## 8. Expiry and FEFO

1. **Definition.** Expiry is a lot attribute. FEFO picks the lot that expires first; FIFO picks the oldest received. Exclusion means expired stock is not counted as available [DM 4.2; FF glossary F19].
2. **Workflow.** `allocateFulfilmentOrder` takes no lot parameter and no pick-order setting; the lot is named when the pick is recorded. No FEFO operation exists. No expiry alert exists [OAPI allocateFulfilmentOrder, recordPick].
3. **Rules and edge cases.** No FEFO, FIFO or exclusion rule in DM 4.10, W-8 or W-9. The repo does not say whether expired stock may be sold. Food: SFDA.FD 150-1 sets mandatory expiration dates [W2, read 2026-11-02; text not read]. A GCC standard document lists date labels and says "sell by" applies to shelf life over three months; Saudi status unconfirmed [W4, search only]. Hot-climate expiry loss is inferred [FWMS module 1].
4. **Data.** `wms_lots.expiry_date` indexed; `wms_reservations.lot_id`. No strategy setting, alert threshold or shelf-life field [DATA 2.3].
5. **Surfaces.** `listLots` with `expiring_before` filter (web). No alert surface.
6. **Permissions.** None defined for a strategy or threshold setting.
7. **Dependencies.** Allocation (WMS-6). Channel publication: expired stock must leave the published quantity (inferred from INT 8.4). Alerts through the outbox (ADR-0024), messaging limited to templates before wave 3 (ADR-0037).
8. **Metrics.** None defined. Candidates: expired on-hand; expiring value (needs item 18); write-offs by reason.
9. **Market and our shape.** Odoo FEFO, FIFO, LIFO and nearest-zone [FWMS S16]. ShipHero FEFO by lot priority is cited in FWMS S23, but the ShipHero teardown says "FEFO is not described" [SH D17]; conflict, see the conflicts table. Fulfillor defines FEFO and FIFO but the product page does not say which applies; configurable expiry email alerts (Oct 2025) [FF 2, F6]. Anchanto lists FEFO and FIFO as Shopify-app strategies [AN 3.2]. Chosen (repo): none. Proposed, four different shapes: FWMS P2 (WMS-6a, FEFO in wave 3); SH proposal 7 (exclude expired now, FEFO by ruling); FF A1 (FEFO setting and expiry alert in WMS-6); AN P1 (account pick-strategy setting).
10. **Roadmap.** Partial: WMS-2 expiry field; WMS-6 has no rule. Missing: FEFO or FIFO rule, exclusion, expiry alert. Owner: OQ8-5, OQ8-6, OQ8-25.

## 9. Kits and bundles

1. **Definition.** A kit is a parent SKU built from component SKUs (a bill of materials). A bundle is sold as one SKU and expands to components at pick. Neither exists in the repo [SH 1.1; FF 2].
2. **Workflow.** None. The nearest mechanism is consumption at pack: `consumables` on `packPackage`, recorded as an ADJUSTMENT movement with reason `consumption` (DM 4.8). No build or disassemble operation [OAPI packPackage; DM 4.8].
3. **Rules and edge cases.** None in the repo. Most KSA merchants sell single SKUs (inferred, FWMS module 3). Bundles appear on Salla listings [AN row 23], a channel-side fact.
4. **Data.** No bill-of-materials table. `is_consumable` is the only related flag [DATA 2.3].
5. **Surfaces.** None.
6. **Permissions.** None defined.
7. **Dependencies.** Bundle SKU on the channel to components in the WMS: no mapping exists.
8. **Metrics.** None.
9. **Market and our shape.** ShipHero: a kit is one sellable item; a build splits components into order lines; assembly work orders (search only) [SH 1.1, H28]. Fulfillor: pre-assembled kits with component consumption recorded (Oct 2025) and kit billing [FF 2, F6]. Shipsy kitting and bundling [FWMS S8]. Omniful names kitting with no text [OM 2.2]. Anchanto's WMS page does not list kitting [AN row 23]. Chosen (repo): none. Proposed: not in wave 3 (SH row 25); post-4 and unscheduled (FWMS); Fulfillor's WMS-11 listed "so the lead can decline it on purpose" (FF A8).
10. **Roadmap.** Missing; no row. Owner: OQ8-16.

## 10. Multi-site scoping and transfers

1. **Definition.** One account holds several sites (branch, warehouse or both), each with its own locations and stock. Staff see only assigned sites. Stock moves between sites by transfer [DM 2.3, 4.1; ADR-0018].
2. **Workflow.** Sites are managed in PLAT-12 (merged, roadmap §0). Locations reference warehouse or both sites (K-4, W-1). Stock levels, adjustments and counts filter by `site_id` (`SiteIdQuery`). No cross-site transfer operation exists. The movement reason `transfer` exists (DM 4.4) but no transfer document, no transit rule across sites, and no cross-site movement rule. Transit is per site by default (Q-2) [OAPI; DM 4.4].
3. **Rules and edge cases.** K-4; K-5 (no site goes inactive with orders, cash or stock); W-1. No withdrawal priority or routing rule exists. KSA and GCC: Fulfillor's KSA page claims Riyadh, Jeddah and Dammam sites (vendor claim) [FF F2]. Salla shows per-branch availability [FWMS S2]. Zid has nearest-warehouse display and withdrawal priority with automatic order split [FWMS S1]. Hub network out of scope pending owner ruling [FCOV section 2].
4. **Data.** `core_sites`: kind, name ar and en, address, National Address short code, point, opening hours [DM 2.3]. WMS rows carry `site_id`. StockSummary grain is (account, product), so per-site available is not stored [DATA 2.3]. View `rpt_stock_position` is account-wide [DATA 9].
5. **Surfaces.** Site selector across `/wms/*` (inferred). Channel connections per account, not per site [INT 2.8]. No transfer screen.
6. **Permissions.** Site restriction is data: membership `site_ids`; warehouse staff are restricted to assigned sites [IDT 2]. Owner and admin see all sites [ROLES].
7. **Dependencies.** Channel connections (INT 2.8); ADR-0018. A hub ADR superseding the site kinds if hubs are ruled in [PCMP 5].
8. **Metrics.** None defined for multi-site. Candidates: per-site on hand; per-site count accuracy.
9. **Market and our shape.** Zid: channel per warehouse and withdrawal priority [FWMS S1]. Omniful: multi-hub and stock transfer orders [OM 2.2, O4]. Anchanto: four ordered routing rules with a primary-site fallback and automatic transfer for out-of-stock lines [AN 3.1, A17]. ShipHero: first-match allocation rules with a DEFAULT RULE, enabled by Support [SH 1.3, H11]. Fulfillor: transfer shipment (Jan 2026) and proximity routing [FF 2, F6]. Chosen (repo): the site concept only, ADR-0018; no routing. Proposed: transfer orders and routing as a wave-3 extension if the pilot is multi-site (FWMS P7, FCOV WMS-15). Anchanto (P2), Omniful (WMS-9) and Fulfillor (A6, WMS-10) name the same content with other ids. ShipHero's own proposal 1 says adapt ordered rules after the multi-site answer.
10. **Roadmap.** Covered: sites (ADR-0018, PLAT-12). Missing: transfer order, cross-site allocation, per-site summary, withdrawal priority. Proposed wave 3, conditional on pilot site count. Owner: OQ8-7, OQ8-8, Q-31.

## 11. Stock ledger and movements

1. **Definition.** Every change to on-hand stock is an append-only movement from one location to another. System locations SUPPLIER, CUSTOMER and ADJUSTMENT close the double entry [ADR-0011; DM 4.4].
2. **Workflow.** Written only by the ledger service inside business transactions: receipt (SUPPLIER to receiving), put-away, pick (bin to tote, W-9), pack (tote to dock, W-14), handover (dock to transit), delivery (transit to CUSTOMER), count post and adjustment approval (to ADJUSTMENT), return disposition (W-17), tote move (W-2). One `batch_id` per business operation. Read through `listMovements` (filters: product, location, batch, reason, ref) [DM 4.4, 4.16; OAPI listMovements].
3. **Rules and edge cases.** W-5: append-only; quantity greater than zero; from not equal to; at most one system side. W-4, W-14, W-15, W-16, W-17. No KSA or GCC rule.
4. **Data.** `wms_stock_movements`: batch_id, product_id, lot_id, serial_id, quantity, from and to location, reason CHECK (11 values), ref_type, ref_id, `ledger_seq` identity, `tx_id xid8` default `pg_current_xact_id()`, recorded_by. No cost column. Triggers reject UPDATE, DELETE and TRUNCATE with SQLSTATE EL001. Lawful removal: the per-account deletion tool only [DATA 3.1, 10]. Runtime roles hold SELECT and INSERT only under ADR-0031, which is proposed [ADR-0031]. No personal data in movement rows (design rule) [DATA 3.1]. Retention: account lifetime, then the deletion tool (Q-38 proposed 90 days after close).
5. **Surfaces.** Web `/wms/movements` (WEB-14). API `listMovements`. No export operation. Reporting view `rpt_stock_position` [DATA 9].
6. **Permissions.** `wms.movements.read` (owner, admin, warehouse_staff, viewer). No write permission exists, correctly [ROLES]. Movements carry `recorded_by`. Writes are confined to ledger services by an architecture test [ADR-0031].
7. **Dependencies.** Outbox event `wms.movement.recorded` (DM 5.3); projector (item 13); ADR-0031.
8. **Metrics.** Ledger assertion drift (platform metric) [DATA 3.4; PLAT 7]. Cursor lag alert above 60 s [DATA 3.3].
9. **Market and our shape.** ShipHero changes stock through `inventory_add`, `_remove` and `_replace` with a reason; no append-only claim [SH D12]. Zid adjustment log by channel [FWMS S1]. Logestechs SKU movement report [FWMS S5]. PCMP section 3: none of the nine platforms publishes a ledger or custody model; this is a stated design, not a shipped comparison. Chosen (repo): own, ADR-0011 with ADR-0031.
10. **Roadmap.** Covered: WMS-3 (wave 3, bound by ADR-0011 and ADR-0031, adversary yes). Dependency: ADR-0031 is still proposed and WMS-3 is bound by it. Transit path depends on Q-2.

## 12. Stock levels and summaries

1. **Definition.** StockLevel is on hand per location, product, lot and serial. StockSummary is per product on hand, reserved and available. Reservation is open quantity held for a fulfilment line [DM 4.5, 4.10].
2. **Workflow.** Allocation reserves up to available (W-8). Pick moves stock and releases the reservation in one transaction (W-9). Cancel releases. The projector recomputes summaries every 2 s and records `as_of_ledger_seq` (W-7). The stock screen never caches or updates optimistically [DM; WEB cache table; DATA 3.3].
3. **Rules and edge cases.** W-6: on hand never negative in a non-system location. W-7: summary trails by the cursor lag. W-8: reserve at most available; release exactly once. Definition conflict: DM 4.10 uses pickable locations of the site; DATA 3.3 sums all non-system locations account-wide (see the conflicts table).
4. **Data.** `wms_stock_levels`: unique NULLS NOT DISTINCT (account, location, product, lot, serial); CHECK on_hand at least 0; partial unique serial where on_hand > 0. `wms_stock_summaries`: unique (account, product); `available` generated as on_hand minus reserved; CHECK reserved at least 0; `as_of_ledger_seq`; `version`. `wms_reservations`: released_at, release_reason (picked, cancelled), CHECK that both are null or both set (W-8) [DATA 2.3]. Projections are mutable and rebuildable; reservations are not ledger rows [DM 4.5].
5. **Surfaces.** Web `/wms/stock` (`listStockLevels`, `listStockSummaries` with `below_available`). Reservations on a fulfilment order (`listReservations`). Channel publication reads available (item 20).
6. **Permissions.** `wms.stock.read` (owner, admin, warehouse_staff, viewer) [ROLES].
7. **Dependencies.** Allocation (WMS-6); channel publication (INT-12); reporting (DATA 9).
8. **Metrics.** Count of rows below a threshold (query exists, no alert). Summary lag (`as_of_ledger_seq` against the ledger head). Reservations open beyond N days (not defined).
9. **Market and our shape.** Zid per-location quantities [FWMS S1]. Salla product inventory report with available and sold (search only) [FWMS S29]. ShipHero excludes expired quantity from available when set, and holds [SH D17]. Omniful real-time inventory sync to avoid overselling [FWMS S11]. Anchanto allocates to channels in real time [AN 3.1, A5]. Chosen (repo): ADR-0011 projections; W-7 trailing summary; per-product, not per site or per channel.
10. **Roadmap.** Covered: WMS-3 (projections), WMS-6 (reservations). Missing: per-site available (item 10), expired exclusion (item 8). Owner: OQ8-9.

## 13. Projections and rebuild

1. **Definition.** StockLevel and StockSummary are caches of the ledger. Both can be dropped and rebuilt from ledger sequence zero [ADR-0011; DM 4.5; DATA 3.5].
2. **Workflow.** Projector runs every 2 s on the worker as a single leader (Redis lock `elx:lock:stock-projector`). It reads at most 5,000 movements below the oldest in-flight transaction, recomputes each (account, product) absolutely, bumps `version`, writes `wms.stock.available_changed` to the outbox, and advances the cursor in one transaction [DATA 3.3]. Rebuild per account: advisory lock; delete and reinsert StockLevel; recompute summaries; run assertions 1 to 3; commit only if clean; audit `projections.rebuilt` [DATA 3.5]. After any logical restore, reset the cursor and rebuild [DATA 3.3]. Long write transactions hold the cursor back; alert above 60 s.
3. **Rules and edge cases.** W-7. Rejected alternative: an advisory lock serialising all writes (couples throughput to one lock) [DATA 3.3]. No KSA or GCC rule.
4. **Data.** `wms_projection_cursors` (projector PK, tx_id, ledger_seq), exempt from tenancy [DATA 2.3, 2.4]. Projections have no retention; they are rebuildable.
5. **Surfaces.** None for merchants. Platform runbook "rebuild projections" [PLAT 9]; OPS-6 runbook (wave 3); diagnose console [WEB].
6. **Permissions.** Platform role `elx_platform` for cross-tenant jobs; no merchant permission [ADR-0031].
7. **Dependencies.** Outbox (ADR-0024); Redis lock; PLAT-5 schema harness (WMS-3 depends on it).
8. **Metrics.** Cursor lag (alert above 60 s). Rebuild duration (not defined). Assertion drift (item 14).
9. **Market and our shape.** No market source describes a projection design. ShipHero's API throttling is a different concern [SH 3.3]. Chosen (repo): own, ADR-0011 and DATA 3.3.
10. **Roadmap.** Covered: WMS-3 and OPS-6. Risk: a weekly staging refresh by logical dump resets the cursor, so the runbook must run after each refresh [DATA 3.3]. No owner question open.

## 14. Nightly assertions

1. **Definition.** A nightly recomputation from the ledger that flags any projection drift. Zero drift is the precondition for trusting counts [DATA 3.4; PLAT 7].
2. **Workflow.** A 03:00 Asia/Riyadh job on the worker, role `elx_platform`, runs four stock assertions: (1) StockLevel equals the ledger; (2) summary equals levels plus open reservations; (3) no serial positive in two places and lot or serial agree with the product mode; (4) every open reservation sits on a non-terminal line. Results go to the ops log and the metric "ledger assertion drift"; any non-empty result opens an alert. The same queries run in CI (`apps/api/test/ledger/`) and in the diagnose console [DATA 3.4].
3. **Rules and edge cases.** W-7: green, or an alert is open. Roadmap §2 exit: the nightly assertion green every night since WMS-3 merged, with no open drift alert [RM §2]. No KSA or GCC rule.
4. **Data.** Reads the WMS tables; results in the ops log, with no result table. Retention of the ops log is not defined.
5. **Surfaces.** Platform alerts to the owner channel [PLAT 7]; diagnose console [WEB]. No merchant surface.
6. **Permissions.** Platform role only; the diagnose console needs `platform.diagnose.run` [WEB].
7. **Dependencies.** OPS-6 runbook; telemetry PLAT-14 (merged, roadmap §0).
8. **Metrics.** Drift count per night (target zero). Consecutive green nights (the exit criterion).
9. **Market and our shape.** No source read describes a reconciliation of this kind. PCMP section 3 treats the ledger as a stated design. Chosen (repo): own, ADR-0011 and DATA 3.4.
10. **Roadmap.** Covered: WMS-3, OPS-6, roadmap §2 exit. Gap: no merchant-visible drift status (inferred). No owner question open.

## 15. Adjustments with approval threshold

1. **Definition.** A reason-coded correction to on-hand stock, posted as movements to or from ADJUSTMENT. Above an account threshold a second person must approve [DM 4.8; W-16; Q-17].
2. **Workflow.** `requestAdjustment` posts at once below the threshold, otherwise the status is `requested` until approved (then `posted`) or rejected. `approveAdjustment` returns 403 `separation_of_duties`, 409 `insufficient_stock` or `invalid_transition`. `rejectAdjustment` takes a reason [OAPI].
3. **Rules and edge cases.** W-16. CHECK that approver differs from requester; delta not zero [DATA 2.3]. The threshold is a per-account setting; no value is set (Q-17 default, provisional). The unit is not stated. A value threshold needs cost, which the model does not carry (item 18; inferred). No KSA or GCC rule.
4. **Data.** `wms_adjustments`: site_id, reason_code, status CHECK (requested, approved, posted, rejected), requested_by, approved_by. `wms_adjustment_lines`: location, product, lot, serial, delta. Reason codes are extensible with Arabic and English labels [DATA 2.3; WEB]. Header is mutable; postings are append-only movements.
5. **Surfaces.** `/wms/adjustments` (WEB-14).
6. **Permissions.** Request: `wms.adjustments.request` (owner, admin, warehouse_staff). Approve: `wms.adjustments.approve` (owner, admin). Requester cannot approve (CHECK and 403). The UI shows separation of duties but does not enforce it [WEB]. K-7 requires an audit row in the same transaction [DM 2.5].
7. **Dependencies.** Counts post adjustments (item 16); movements (item 11); threshold setting (no settings screen defined for it).
8. **Metrics.** None defined. Candidates: adjustments by reason; rejected share; approval latency.
9. **Market and our shape.** Zid adjustment log by channel [FWMS S1]. Odoo adjustments [FWMS S16]. Infoplus threshold blocks adjustment (search only) [FWMS S18]. ShipHero adjustments take a reason and, since 2026-09-24, a location or LPN [SH D12]. Anchanto and Omniful describe no approval step [AN row 22; OM 4.2]. Chosen (repo): W-16 and Q-17, own; no comparable separation-of-duties threshold was found in the market sources.
10. **Roadmap.** Covered: WMS-5 (wave 3). Open: the threshold value and unit (Q-17). Owner: Q-17, OQ8-11.

## 16. Cycle counts and full counts with schedules

1. **Definition.** A count session counts stock in chosen locations or products, records counted quantities and posts variances as adjustments. A full stocktake would be a session over every location of a site; the contract does not say so [DM 4.15; DATA 2.3].
2. **Workflow.** `planCountSession` (planned; blind by default). `recordCounts` (planned to counting on first count). `submitCountSession` (counting to review). `requestRecount` (review to counting). `postCountSession` (review to posted; variances become ADJUSTMENT movements; 422 `approval_required` above threshold). `cancelCountSession` by approver [OAPI; DM 4.15].
3. **Rules and edge cases.** W-16. Blind hides system quantity while the session is open [OAPI getCountSession]. No schedule, frequency or variance trigger exists in DM, DATA or OAPI. The contract does not say what an empty scope means. No KSA or GCC rule.
4. **Data.** `wms_count_sessions`: site_id, scope jsonb, blind, status, counted_by, approved_by, version. `wms_count_lines`: location, product, lot, system_quantity, counted, variance. `system_quantity` appears to be a snapshot at planning (inferred) [DATA 2.3].
5. **Surfaces.** `/wms/counts` and detail (WEB-14). No counting operation in the handheld scope. ShipHero's mobile app prompts weekly cycle counts [SH 1.10].
6. **Permissions.** Write: `wms.counts.write` (owner, admin, warehouse_staff). Approve: `wms.counts.approve` (owner, admin) [ROLES].
7. **Dependencies.** Ledger (item 11); adjustments (item 15); threshold Q-17.
8. **Metrics.** None defined. Candidates: lines with zero variance (accuracy); recount rate; plan-to-post time.
9. **Market and our shape.** ShipHero: count types Locations, Items and Recount; recounts run until two consecutive counts agree (the two-agree rule is search only) [SH D14, H26]. Fulfillor: scheduled and on-demand counts, blind where supported, count plans by ABC class or handling frequency [FF 2, F16, F12]. Omniful: scheduled and ad hoc counts with an audit trail [OM 2.2]. Anchanto: per-SKU periodic inventory check [AN 3.2]. Zid: counting while selling continues, with discrepancy reports [FWMS S1]. Cin7: no confirmed native cycle count (search only) [FWMS S22]. Chosen (repo): CountSession with blind flag and approver, own (DM 4.15). Proposed: count types and the two-agree recount (ShipHero row 22, "yes"); schedules and threshold triggers (FCOV WMS-14; FWMS P6, "WMS-5a"); ABC plans (FF A2).
10. **Roadmap.** Partial: WMS-5 covers sessions and blind counts, not schedules or types. Owner: Q-17, OQ8-12, OQ8-13.

## 17. Low-stock alerts and reorder points

1. **Definition.** Notify when available falls below the merchant's minimum per product (and per option). Optionally, a reorder point creates a purchase order or a transfer [FWMS module 4; SH H27].
2. **Workflow.** None. The `below_available` query on `listStockSummaries` returns rows; nothing sends a notice. No reorder point exists [OAPI listStockSummaries].
3. **Rules and edge cases.** None in the repo. KSA: Salla notifies per product and per option below a minimum, with a banner, an in-store notice, an email and a "products about to run out" filter [FWMS S3, fetched]. Zid has no native low-stock alert; a third-party app fills it (search only) [FWMS S28].
4. **Data.** No threshold column on products, locations or summaries; no alert table [DATA 2.3].
5. **Surfaces.** None defined. PLAT-14 alerts are operator alerts only [PLAT 7]. FCOV proposes in-app and email alerts through the outbox.
6. **Permissions.** None defined. A threshold write would need `wms.products.manage` [ROLES].
7. **Dependencies.** Outbox and messaging (PLAT-8 and PLAT-9 merged, roadmap §0); messaging is templates only before wave 3 (ADR-0037); WhatsApp through the engine (ADR-0041); staff notification centre DEL-21 (proposed, wave 2).
8. **Metrics.** Products below threshold; alerts sent; time to acknowledge (not defined).
9. **Market and our shape.** Salla per product and option [FWMS S3]. Odoo notice to procurement [FWMS S16]. Logestechs low-stock report [FWMS S5]. Zoho reorder notice [FWMS S17]. Fulfillor facility-level thresholds (Jul 2026) and in-app low-stock alerts (Sep 2026) [FF 2, F6]. ShipHero min and max on pickable locations, enabled by Support; the reorder level drives PO quantity but does not create the PO (search only) [SH H27]. Chosen (repo): none. Proposed: FCOV WMS-13, wave 3, described as "the cheapest KSA expectation to miss"; FWMS P5, wave 3 or 4; replenishment rules post-4 (FWMS P8) or INT-13 (FCOV, wave 4 or later).
10. **Roadmap.** Missing: no row, and roadmap §6 does not defer it. Owner: OQ8-14, OQ8-15.

## 18. Inventory valuation (scope question)

1. **Definition.** The value of stock by cost method (FIFO, average or standard) and the cost of goods sold [FWMS module 1; FCOV section 2].
2. **Workflow.** None. PO lines carry unit cost in halalas; nothing carries cost after receipt [DM 4.3; DATA 2.3].
3. **Rules and edge cases.** No rule and no ADR. VAT and ZATCA are adjacent owner questions [FCOV section 2]; the sources do not tie valuation to ZATCA.
4. **Data.** `wms_purchase_order_lines.unit_cost` (bigint). `wms_stock_movements` has no cost column [DATA 2.3]. Inferred: valuation needs a cost on or beside each movement, or a cost layer. Adding it to the append-only table is a ledger migration, which DATA 3.1 says must be called out in the PR, so it is a one-way door.
5. **Surfaces.** None.
6. **Permissions.** None defined.
7. **Dependencies.** Value-based adjustment threshold (item 15); a finance product if the owner puts valuation there.
8. **Metrics.** None defined.
9. **Market and our shape.** Cin7 ties FIFO and FEFO to its costing method (search only) [FWMS S22]. The other sources do not name valuation [FWMS module 1]. Anchanto reports stock ageing without valuation [AN 3.2]. Fulfillor bills per activity, not valuation [FF 4.3]. Chosen (repo): none.
10. **Roadmap.** Missing; no row; not in roadmap §6. Owner: OQ8-10 (FWMS Q-U3), not yet in roadmap §4.

## 19. Labels for locations and totes

1. **Definition.** Printed barcode labels for bins, racks and totes so a scanner can address a position. Separate from carrier labels [FWMS module 1; SH P5].
2. **Workflow.** None for locations: no operation, template or print log. The carrier label is separate: `getPackageLabel` returns a signed URL [OAPI].
3. **Rules and edge cases.** None in the repo. ADR-0016 covers UI strings; whether label text is bilingual is not stated (inferred). No KSA or GCC rule.
4. **Data.** `wms_locations.code` is the natural printed value (inferred). No label template or print log [DATA 2.3].
5. **Surfaces.** None. Station printers in market use: Zebra, Rollo, Dymo 4XL, Bixolon [SH 1.5, H22].
6. **Permissions.** None defined; would sit with `wms.locations.read` or `manage`.
7. **Dependencies.** Printers and scanners; location tree (item 1); totes (item 2); ShipHero's onboarding includes location labelling and a physical count [SH P5].
8. **Metrics.** None.
9. **Market and our shape.** Logestechs barcoded location system [FWMS S5]. Zoho barcode generation and scanning [FWMS S17]. Chosen (repo): none. Proposed: a WMS-1 extension in wave 3 with inter-site transfers (FWMS P7); FCOV WMS-15 also names labels.
10. **Roadmap.** Partial: WEB-15 assumes scannable positions; no row prints them. Owner: OQ8-17, OQ8-18.

## 20. Stock visibility per channel

1. **Definition.** One-way publication of each product's available quantity to each channel connection (Salla, Zid), with drift reconciliation. Per-channel buffer and allocation are proposals [ADR-0013; INT 8.4].
2. **Workflow.** Available changes; the projector supersedes the pending publication for (connection, product); the `channel_publish` outbox kind sets the quantity with backoff (1 min, 5 min, 15 min, 1 h, 3 h, 6 h); after 24 h the row is dead and WMS emits `wms.channel_publication.dead`. Nightly at 03:00, `readQuantities` for mapped products and drift is republished [INT 8.4, 2.8; DM 5.3]. Publication sets the quantity; it does not increment, so a retry is harmless. Channel stock never writes the ledger (ADR-0013, W-18).
3. **Rules and edge cases.** W-18: one pending row per (connection, product). ADR-0013: one way. KSA: Salla stock deduction and inventory report are search-only sources [FWMS S29, S30]. Anchanto's pages disagree on the direction for Salla and Zid (conflicts table).
4. **Data.** `wms_channel_publications`: connection_id, product_id, quantity, status CHECK (pending, sent, failed, dead, superseded), attempts, next_attempt_at, superseded_by, channel_response, last_error, version; partial unique (connection, product) where pending [DATA 2.3]. Retention of this table is not stated; the pruning job in DATA 5.2 covers `core_outbox` only.
5. **Surfaces.** `/channels` (WEB-17, wave 4); platform `/platform/channel-publications` with replay; `listChannelPublications` (wave 4) [WEB; OAPI].
6. **Permissions.** `wms.channel_publications.read` (owner, admin, viewer). Platform replay needs `platform.outbox.replay` [ROLES; WEB].
7. **Dependencies.** INT-11 Salla and Zid connections (wave 4); INT-12; product mapping; outbox (ADR-0024); Q-36 (content of WMS-W8).
8. **Metrics.** Oldest due publication older than 30 min alerts [INT 7]. Dead rows. Nightly drift count per connection [INT 8.4].
9. **Market and our shape.** Omniful is the inventory master for Zid and Noon, the same direction as our one-way rule [OM 4.6]. Anchanto applies a buffer at publish time for Salla and Zid listings; the push is not stated [AN row 10]. Fulfillor pushes inventory to Salla and Shopify in real time [FF 3.3]. ShipHero's first integration page lists no Salla, Zid or Saudi carrier [SH 1.11]. Chosen (repo): ADR-0013 one-way outbox, W-18. Proposed: buffer at publish (AN P3, amend INT-12); per-channel and per-warehouse allocation (FCOV INT-13, wave 4 or later; FWMS P8). Tracking push-back (FF A3) would change ADR-0013, which names stock only.
10. **Roadmap.** Covered: INT-12 (wave 4) one-way publish and drift; WEB-17. Missing: buffer, per-site allocation, tracking push-back. Owner: Q-36, Q-34, OQ8-20, OQ8-21.

## Conflicts and gaps in the inputs

| # | Item | Source A | Source B | Action for the lead |
|---|---|---|---|---|
| 1 | Available quantity grain | DM 4.10: pickable locations of the site | DATA 3.3: non-system locations, account-wide | Pick one definition before WMS-3 |
| 2 | ShipHero FEFO | FWMS S23: "FEFO by lot priority" | SH D17: "FEFO is not described" | Verify before citing ShipHero as FEFO |
| 3 | Totes moved at pack | W-14: tote to dock at pack by staff | OAPI moveTote needs `locations.manage`, not held by warehouse staff | Owner ruling on the permission |
| 4 | Work-item ids | WMS-9: variants (FCOV), transfers (OM), handheld app (FF), site routing (AN), B2B (FWMS P9) | WMS-10: pick strategies (FCOV), scanner app (OM), transfers (FF A6) | Renumber in the next roadmap amendment |
| 5 | Work-item ids, cont. | WMS-5a: count schedule (FWMS P6) | WMS-5a: count types and recount (SH row 6); WMS-6a: FEFO (FWMS P2) vs routing (SH row 1) | Same as 4 |
| 6 | Ledger ADR status | WMS-3 is bound by ADR-0031 | ADR-0031 is "proposed" | Owner accepts or rejects before WMS-3 |
| 7 | Salla and Zid direction | AN A11: Salla inventory in | AN A12: inventory pushed to Zid | Check Salla and Zid docs before INT-11 |
| 8 | Logestechs and ADR-0011 | ADR-0011: "Logestechs has no WMS" | PCMP 1: its site now sells one | Correct the ADR context when it is next amended |
| 9 | Tracking push-back | FF A3 proposes it | ADR-0013 names stock only | A new ADR or an amendment, not a silent edit |
| 10 | Summary grain for multi-site | DATA 2.3: (account, product) | FCOV P8 and FWMS P8: per-site and per-channel allocation | Gap; an owner ruling on OQ8-9 |

## Feature index

| # | Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|---|
| 1 | Location tree, zones, pick faces | Partial | WMS-1 (WEB-13) | 3 | OQ8-7 |
| 2 | Totes and LPNs | Partial | WMS-1, WMS-6 | 3 | OQ8-17, OQ8-22 |
| 3 | Catalogue, variants, options | Partial (variants missing) | WMS-2; proposed variant extension | 3 | OQ8-1 |
| 4 | Barcodes and GS1 | Partial | WMS-2 | 3 | OQ8-2, OQ8-3, OQ8-24 |
| 5 | Units of measure | Missing | none; proposed post-4 | post-4 | OQ8-4 |
| 6 | Lots | Covered (capture); rule missing | WMS-2, WMS-3, WMS-4 | 3 | OQ8-5, OQ8-6, OQ8-23 |
| 7 | Serials | Covered | WMS-2, WMS-3 | 3 | none |
| 8 | Expiry and FEFO | Missing rule | WMS-2 field; WMS-6 rule proposed | 3 (proposed) | OQ8-5, OQ8-6, OQ8-25 |
| 9 | Kits and bundles | Missing | none | post-4 (proposed) | OQ8-16 |
| 10 | Multi-site scoping and transfers | Partial | PLAT-12, ADR-0018; transfer proposed | 3 (proposed) | OQ8-7, OQ8-8, OQ8-9 |
| 11 | Stock ledger and movements | Covered | WMS-3 | 3 | Q-2 |
| 12 | Stock levels and summaries | Covered; per-site gap | WMS-3, WMS-6 | 3 | OQ8-9 |
| 13 | Projections and rebuild | Covered | WMS-3, OPS-6 | 3 | none |
| 14 | Nightly assertions | Covered | WMS-3, OPS-6 | 3 | none |
| 15 | Adjustments and approval threshold | Covered; threshold open | WMS-5, WEB-14 | 3 | Q-17, OQ8-11 |
| 16 | Cycle and full counts, schedules | Partial | WMS-5; schedule proposed | 3 | OQ8-12, OQ8-13, OQ8-19 |
| 17 | Low-stock alerts and reorder | Missing | none; proposed WMS-13 | 3 (proposed) | OQ8-14, OQ8-15 |
| 18 | Inventory valuation | Missing (scope) | none | none | OQ8-10 |
| 19 | Labels for locations and totes | Missing | none; proposed WMS-1 extension | 3 (proposed) | OQ8-17, OQ8-18 |
| 20 | Stock visibility per channel | Covered one way; gaps | INT-12, WEB-17 | 4 | Q-36, Q-34, OQ8-20, OQ8-21 |

## Unanswered (owner questions)

No source settled these. Roadmap register items (Q-n) are cited as they stand; OQ8-n are new and not yet in roadmap §4.

1. OQ8-1 (3): Are sizes and colours separate products or options of one product?
2. OQ8-2 (4): Are GTIN and GS1-128 needed, or is EAN-13 scanning enough? Does the owner hold GS1 KSA membership?
3. OQ8-3 (4, 8): Is pharmaceutical stock in scope? If so, the SFDA DataMatrix rule and national reporting apply.
4. OQ8-4 (5): Are case and pallet orders in pilot scope? Is the customer a 3PL holding others' stock (ADR-0002 says no)?
5. OQ8-5 (6, 8): Does the pilot sell expiring goods? Must FEFO apply from first release, and to which categories?
6. OQ8-6 (6, 8, 12): Should expired lots leave available stock by default?
7. OQ8-7 (1, 10): How many sites does the pilot run (Q-31)?
8. OQ8-8 (10): Are inter-site transfers with approval needed in wave 3?
9. OQ8-9 (10, 12, 20): Does the pilot need per-site availability and per-channel allocation?
10. OQ8-10 (18): Is valuation in this WMS or in a finance product?
11. OQ8-11 (15): Is the Q-17 threshold a quantity or a value? What number?
12. OQ8-12 (16): Is counting during sales required, and is blind the default?
13. OQ8-13 (16): Are count schedules and recount-until-two-agree wanted in wave 3?
14. OQ8-14 (17): Are low-stock alerts email and in-app only, or also WhatsApp?
15. OQ8-15 (17): Is replenishment needed before INT-12?
16. OQ8-16 (9): Are kits and bundles in scope, and when?
17. OQ8-17 (2, 4, 16, 19): Warehouse device: a native handheld app or a web scanner-first bench on rugged devices? Four notes propose a handheld app (FF A4, OM item 6, AN P7, PCMP WMS-18).
18. OQ8-18 (19): Which label printers and label language for location and tote labels?
19. OQ8-19 (16): What does an empty count scope mean, and is a full stocktake a session over a whole site?
20. OQ8-20 (20): Accept tracking push-back to channels as an outbound kind beside stock? This needs an ADR that supersedes or amends ADR-0013 (FF Q3).
21. OQ8-21 (20): Is a per-channel buffer at publish wanted in wave 4?
22. OQ8-22 (2): May warehouse staff move totes? The contract says `locations.manage` only.
23. OQ8-23 (6): May lot expiry change after receipt, and must the change be audited?
24. OQ8-24 (4): Does any pilot product fall in the ten SASO on-product regulations from 1 Oct 2026? Check the SABER circular.
25. OQ8-25 (8): Which SFDA date label applies to the pilot's food products? Read SFDA.FD 150-1 in Arabic.

Existing register items cited: Q-2 (transit at pickup, DM 4.1, item 11), Q-17 (threshold, item 15), Q-31 (pilot, item 10), Q-34 (order write-back to channel, item 20), Q-36 (WMS-W7 and WMS-W8 content, item 20), Q-38 (closed-account retention, item 11).

## Sources

Repo, read 2026-11-02 at `origin/main` 6ca087e:
- DM: `docs/architecture/domain-model.md` (sections 2.3, 2.5, 3.1, 4.1 to 4.16, 5.3, K-4, K-5, K-7, W-1 to W-18).
- DATA: `docs/architecture/data.md` (sections 2.3, 2.4, 3.1 to 3.5, 5.2, 9, 10).
- ADR-0011, ADR-0012, ADR-0018 (accepted); ADR-0031 (proposed); ADR-0013, ADR-0016, ADR-0024, ADR-0037, ADR-0041 (accepted). Paths `adr/NNNN-*.md`.
- OAPI: `docs/contracts/openapi/staff-wms.yaml` (locations, products, stock, adjustments, count-sessions, channel-publications, schemas) and `components.yaml` (StockLevel).
- ROLES: `docs/contracts/roles.yaml`; PERM: `docs/contracts/permissions.yaml`.
- RM: `docs/roadmap.md` (§0 progress, §1.4 WMS rows, §1.5 INT-12, §2, §4 register, §6).
- WEB: `docs/architecture/web.md` (route table rows for WMS, cache table, separation-of-duties note, diagnose console).
- IDT: `docs/architecture/identity-and-tenancy.md` (section 2 roles and site restriction).
- INT: `docs/architecture/integrations.md` (sections 2.8, 5.x alerts, 8.4 stock publish).
- PLAT: `docs/architecture/platform.md` (section 7 alerts, runbook list).
- AGENTS.md (repo root, hard rules on bilingual strings and tenancy).

Research, read 2026-11-02 with `git show`:
- FWMS: `docs/research/features-wms-2026-11.md` at `origin/docs/feature-coverage` 7396dcc. Source ids S1 to S31 inside it (Zid S1, Salla S2 to S4 and S29, S30, Logestechs S5, Shipa S6, Shipsy S7 and S8, Anchanto S9, Omniful S11, Odoo S16, Zoho S17, Infoplus S18, Extensiv S19, Cin7 S22, ShipHero S23, SASO S25, SFDA S26, Hopstack S28).
- FCOV: `docs/research/feature-coverage-2026-11.md` at the same commit (section 2 decide-now, section 3 WMS-9 to WMS-17 proposals).
- PCMP: `docs/research/platform-comparison-2026-11.md` at `origin/docs/platform-teardowns` d75ed6f (sections 1 to 5).
- SH: `docs/research/shiphero-teardown-2026-11.md` (product map 1.1 to 1.11, API 3.x, mapping section 5 rows 1 to 44, proposals 6, questions 7); D = developer docs, H = help centre, P = product pages.
- FF: `docs/research/teardown-fulfillor-2026-11.md` (product map section 2, rows of section 5, proposals A1 to A8, questions 7; F1 to F19 fetched pages).
- OM: `docs/research/teardown-omniful-2026-11.md` (product map 2.1 to 2.7, operational model 4.x, mapping section 5, proposals section 6; O1 to O35).
- AN: `docs/research/teardown-anchanto-2026-11.md` (product map 3.1 to 3.6, mapping section 5, proposals P1 to P8, questions 7; A1 to A21).

External, read 2026-11-02:
- W1: https://www.hqts.com/saso-new-labeling-rule/ (WebFetch; third-party summary of the SASO circular; the circular on https://saber.sa was not read).
- W2: https://www.sfda.gov.sa/en/faq/what-are-technical-regulations-and-standards-shelf-life-food-products (WebFetch; names SFDA.FD 150-1 and SFDA.FD/GSO 150-2, not their text).
- W3: SFDA drug barcoding, WebSearch only: https://www.biomapas.com/drugs-serialization-and-barcoding-in-saudi-arabia-and-mena-region/ and https://securingindustry.com/pharmaceuticals/pharma-serialization-snapshot-saudi-arabia/s40/a4251. Secondary; the search summary also mixes guideline versions 5.1 and 6.1. The SFDA guideline itself was not read.
- W4: SFDA food expiry, WebSearch only: GCC standardisation document on date labels and the SFDA FD 150-1 PDF (2021, title only). Secondary; Saudi status unconfirmed.
