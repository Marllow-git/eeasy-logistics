# Feature census: WMS (wave 3 and 4 scope), 2026-11

Date: 2026-11-02. Branch `docs/features-wms` from `origin/main` at `1e0c184`. Author: researcher agent for the lead.
Scope: WMS modules 1 to 4 of the lead's brief (setup and inventory, inbound, outbound, returns and channel stock).
Roadmap basis: `docs/roadmap.md` §1.4 (WMS-1 to WMS-7, INT-8, WEB-13 to WEB-15, OPS-6) and §1.5 (INT-12, WMS-8, DEL-18); `docs/architecture/domain-model.md` §4 (4.1 to 4.16) and §5.3. Owner register items cited as Q-n from `docs/roadmap.md` §4.

## Summary for the lead

1. Read 2026-11-02: 9 regional and 9 global products gave usable feature lists; Torod, Flow and Stockwise gave none (Stockwise not found). Source IDs S1 to S29 are listed at the end.
2. Roadmap already covers the spine: locations and totes (WMS-1), catalog with lots and serials (WMS-2), append-only ledger (WMS-3), receipts and counts (WMS-4, WMS-5), reservations and pick tasks (WMS-6), packages with own-fleet and carrier handoff (WMS-7, INT-8), return dispositions (WMS-8) and channel publication (INT-12).
3. High-relevance gaps: product variants (Salla and Zid stock per option, S2, S3); FEFO and expiry-first allocation rule (S16, S23, S8); wave, batch and zone pick strategies (S9, S16, S19); box suggestion (S18, S20, both secondary) and packing slip (S19); transfer orders between sites with approval (S1).
4. Native low-stock alerts are a Salla feature (per product and option, banner, in-app notice, email; S3) and are in no roadmap row; this is the cheapest KSA expectation to miss.
5. Medium gaps: scheduled and threshold-triggered cycle counts, quality hold and put-away rules, B2B fulfilment, unit-of-measure conversion, GS1 identifiers (drug GS1 DataMatrix only, S26).
6. Low or out of scope: cross-dock, kitting, cluster picking, pick-to-light, inventory valuation (no aggregate in domain §4), carrier rate shopping (excluded by ADR-0001 and W-12).
7. Salla and Zid stock features are thin: Salla's return flow restocks only on an optional click (S4); Zid has multi-warehouse, transfers and withdrawal priority (S1) but no lots or alerts on its page.
8. Regional WMS vendors with feature pages: Shipsy (S8), Anchanto (S9), Omniful (S11), Logestechs (S5), Shipa (S6). These are vendor pages; treat their claims as marketing.
9. No product source states a KSA-specific WMS rule. The SASO labelling rule from 1 Oct 2026 (third party, S25) asks for supplier name and CR number on product, not barcodes. ZATCA e-invoicing sits outside the WMS but touches B2B documents (S27).
10. Ten proposed orders below; eight extend existing WMS or INT rows.

## Method and evidence grades

- Every fact below is from a source read on 2026-11-02. Each source line carries a grade: **[F]** the page was fetched and its features were extracted, **[S]** only a search excerpt was seen, not the page.
- "Who offers" cites source IDs. A feature marked "not named" means the grade-[F] page did not name it; it does not prove the product lacks it.
- What the source states is written as a plain fact. Relevance ratings and wave suggestions are my inference, marked "(inferred)" where the reason is my reading and not a source.
- Roadmap coverage is read from the roadmap and domain model, cited by row id or section. "Covered" means a roadmap row or domain aggregate names the feature. "Partial" names what is missing.
- Vendor performance numbers (accuracy percentages, speed gains) are self-reported and are not used.

## Module 1 · Setup and inventory

| Feature | What it does | Who offers it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Location tree (site, zone, aisle, rack, shelf, bin) | Models where stock sits, with a generated path and pickable flag | Zid multi-warehouse (S1 [F]); Cin7 Omni zones and bins (S22 [S]); Shipsy fixed-bin and velocity slotting (S8 [F]) | high: multi-branch Salla and Zid merchants (inferred) | covered: WMS-1, domain 4.1, W-1 | done (3) |
| Totes and movable containers | A tote's parent changes by transfer batch; holds pick lines | Shipsy handling-unit management (S8 [F]); pick-to-tote itself not named by the other pages read | medium: needed for multi-order pick runs, not for single parcels (inferred) | covered: WMS-1, domain 4.1, W-2; pick target in WMS-6 | done (3) |
| Dock, transit, returns and quarantine locations | Staging for packed goods, goods with a carrier or driver, returns, held stock | Shipsy dock-to-stock flow (S8 [F]); Shipa racked, bulk and temperature storage (S6 [F]) | medium: handover staging is needed at every pack bench (inferred) | covered: domain 4.1 types, W-14, W-17 | done (3) |
| Printable location and tote barcodes | Labels for bins and totes so scanners can address them | Logestechs barcoded location system (S5 [F]); Zoho barcode generation and scanning (S17 [F]) | high: bin scanning is how the pick bench works (inferred) | partial: WMS-1 names locations, no label printing; WEB-15 scanner-first | 3 · WMS-1 extension (P7) |
| Pick faces and pick-face replenishment | Fixed forward pick locations refilled from reserve | Shipsy pick-face replenishment (S8 [F]); Omniful automated replenishment (S11 [F]) | medium: matters once a site has reserve and pick areas (inferred) | partial: WMS-1 has zone and pickable; no replenishment task | 4 · with INT-12 or later (P8) |
| Product catalogue with SKU, barcodes, Arabic and English names | Product master with tracking mode, unit, weight, dimensions | Zoho barcode generation and scanning (S17 [F]); AR and EN names are the owner rule (AGENTS.md) | high: AR and EN mandatory (AGENTS.md) | covered: WMS-2, domain 4.2 | done (3) |
| Product variants (size, colour, option) with stock per option | One product with options, stock and alerts kept per option | Salla per-option quantities on branches (S2 [F]) and per-option minimum (S3 [F]); Shipa option stock not named | high: Salla and Zid stores sell options by default (inferred from S2, S3) | missing: domain 4.2 has product only, no variant child; WMS-2 names none | 3 · WMS-2 extension (P1) |
| Barcodes and GS1 identifiers | Scan EAN and GTIN; validate and print GS1-128 for lot or expiry | Odoo GS1, EAN13 and EAN14 out of the box (S16 [F]); Deposco labelling (S20 [S]); SFDA drug GS1 DataMatrix (S26 [S]) | medium: GS1 need is mainly pharma and own-brand retail; SASO labelling does not require barcodes (S25 [F]) (inferred) | partial: WMS-2 has barcodes field; no GS1 validation or GS1-128 | 3 · WMS-2 extension, owner question Q-U5 |
| Units of measure with conversion (each, case, pallet) | Buy in one unit, sell or pick in another | Odoo unit conversion on receipt (S16 [F]); Shipsy multi-UoM (S7 [S]) | medium: wholesale and case buying (inferred) | missing: Product has one unit (domain 4.2) | post-4 (P9) |
| Lots (batch) with expiry | Lot code and expiry on each lot; lot-tracked picks | ShipHero lot and expiry tracking (S23 [F]); Infoplus lot control and recall (S18 [S]); Anchanto batch, serial and expiry (S9 [F]) | high: food, cosmetics and supplements in KSA climate (inferred) | covered: WMS-2, domain 4.2 Lot, W-4 | done (3) |
| Serial numbers | One unit per serial, on hand in one location | Odoo lot and serial (S16 [F]); Cin7 Core serials (S22 [S]); Extensiv serial on item record (S19 [F]) | medium: electronics and returns verification (inferred) | covered: WMS-2, domain 4.2, W-4 | done (3) |
| Expiry-first allocation (FEFO) and removal strategies | Pick the earliest-expiry lot; FIFO, LIFO, nearest zone as options | Odoo FEFO, FIFO, LIFO and nearest-zone removal (S16 [F]); ShipHero FEFO by lot priority (S23 [F]); Shipsy shelf-life and FEFO (S8 [F]); Cin7 FIFO and FEFO only in advanced plan (S22 [S]) | high: shelf life in hot climate, expiry loss (inferred) | partial: Lot has expiry (domain 4.2); WMS-6 names no allocation or pick rule | 3 · WMS-6 extension (P2) |
| Kitting and bundles (kit BOM) | A parent SKU built from components, or sold as a bundle | Shipsy kitting and bundling (S8 [F]); Omniful bundling (S11 [F]); Zoho composite items (S17 [F], partial); Deposco kit-to-order (S20 [S]); Odoo kits not named (S16 [F]) | low: most KSA SME merchants sell single SKUs (inferred) | missing: Consumable (domain 4.8) is consumption, not a kit | post-4 (new, unscheduled) |
| Multi-warehouse (several sites, one account) | Several warehouses or branches with per-site stock | Zid multi-warehouse, nearest-warehouse display and channel per warehouse (S1 [F]); Anchanto multi-location (S9 [F]); Extensiv combined view (S19 [F]); Shipa multi-site (S6 [F]) | high: branch merchants on Salla and Zid (inferred from S1, S2) | partial: sites of kind warehouse (domain 2.3, W-1); no inter-site transfer order | 3 · WMS-1 (transfer part in P7) |
| Stock ledger with append-only movements and audit | Every change as a movement with reason and reference | Zid adjustment log of additions and withdrawals by channel (S1 [F]); Infoplus audit trails (S18 [S]); Logestechs SKU movement report (S5 [F]) | high: owner disputes and audit (inferred) | covered: WMS-3, domain 4.4, W-5 | done (3) |
| Stock summary and availability (on hand, reserved, available) | Per-product totals and per-location on hand | Salla product inventory report with available and sold (S29 [S]); Zid per-location quantities (S1 [F]) | high: channel sync needs available (inferred) | covered: WMS-3 (StockSummary), domain 4.5, 4.10 | done (3) |
| Cycle counts: scheduled and on demand | Count a location or product on a schedule or after a threshold; post variances | ShipHero scheduled and on-demand counts, mobile (S23 [F]); Odoo recurring counts (S16 [F]); Infoplus count work from location table, threshold blocks adjustment (S18 [S]); Cin7 has no confirmed native cycle count (S22 [S]) | high: daily control for any merchant holding stock (inferred) | partial: WMS-5 has CountSession by scope; no schedule or threshold trigger | 3 · WMS-5 extension (P6) |
| Full stocktake and blind count | Count all stock in a window; counters do not see system quantity | Zid real-time counting while selling continues, with discrepancy reports (S1 [F]); domain 4.8 blind flag | high: year-end and branch audits (inferred) | covered: WMS-5, domain 4.8, 4.15; live counting during sales not written | done (3) |
| Adjustments with approval | Reason-coded adjustments; approver differs from requester above a threshold | Zid adjustment log (S1 [F]); Odoo adjustments (S16 [F]); domain 4.8 requested_by and approved_by; W-16 | high: control over losses (inferred) | covered: WMS-5, W-16; threshold is owner Q-17 (open, default per account) | done (3) |
| Inventory valuation (cost layers, COGS) | Value stock by FIFO, average or standard cost | Cin7 ties FIFO and FEFO to costing method (S22 [S]); others not named in S16, S17, S19, S23 | medium: owners ask for stock value (inferred) | missing: PurchaseOrder carries unit cost (domain 4.3) but no valuation aggregate; not in roadmap | owner decision (Q-U3) |

## Module 2 · Inbound

| Feature | What it does | Who offers it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Supplier record | Name, contact and tax number of a vendor | Zoho purchase orders with supplier (S17 [F]); Shipsy supplier-level quality control (S7 [S]) | medium: needed for every restock; VAT number is the KSA field (inferred) | covered: WMS-4, domain 4.3 (name, contact, VAT) | done (3) |
| Purchase order with line costs and status | Order stock from a supplier with expected lines and status | Zoho purchase orders (S17 [F]); Shipsy PO-based inbound (S8 [F]) | high: importers and brand owners restock on PO (inferred) | covered: WMS-4, domain 4.3, 4.11 | done (3) |
| Advance shipping notice (ASN) matching | Match a supplier's pre-advised lines to the receipt | Shipsy ASN matching and e-signature on receipt (S8 [F]); Extensiv receipts by EDI or API (S19 [F]); Deposco EDI (S20 [S]) | medium: needed for large suppliers and 3PL clients, not for a single merchant (inferred) | missing: no ASN in domain 4.3 or 4.11 | post-4 (P10) |
| Receiving by scan against expected lines | Scan each unit; record received and damaged counts | Shipsy scan-based goods receipt (S8 [F]); Extensiv scanner receipts (S19 [F]); Logestechs handler receiving and sorting (S5 [F]) | high: receiving accuracy is the first WMS control (inferred) | covered: WMS-4; receipt lines expected, received, damaged (domain 4.3) | done (3) |
| Over-receipt approval above PO tolerance | Receipt above the PO line plus a tolerance needs an approver | not named by any product page read; roadmap rule only | medium: over-shipment from suppliers is common (inferred) | covered: W-15 (WMS-4); tolerance value not set in docs | done (3) |
| Expiry and lot capture on receipt | Record lot code and expiry when goods arrive | Zoho batch, serial and expiry marked partial (S17 [F]); Cin7 expiry shown on receipt (S22 [S]); Odoo lot and expiry (S16 [F]) | high: expiry data must exist before FEFO works (inferred) | covered: WMS-4 receipt lines with lot (domain 4.3), WMS-2 Lot | done (3) |
| Quality hold before stock is sellable | Received stock sits in a hold status until inspected and released | Shipsy quality control workflows (S8 [F]); Shipsy supplier-level QC (S7 [S]) | medium: food, cosmetics and supplements inspection (inferred) | partial: receipt has damaged count; domain 4.1 has quarantine location; no hold status or release step | 3 · WMS-4 extension (P4) |
| Put-away rules (capacity, storage need, zone) | Choose a storage location by rule, not by hand | Odoo putaway rules by capacity, storage need and accessibility (S16 [F]); Extensiv directed putaway (S19 [F]); Shipsy guided putaway and velocity slotting (S8 [F]); NetSuite directed putaway (S21 [S]) | medium: value grows with several storage zones (inferred) | partial: WMS-4 names put-away; no rule in domain 4.3 or 4.11 | 3 · WMS-4 extension (P4); slotting post-4 |
| Cross-dock (inbound straight to outbound) | Move received goods to outbound without storage | Shipsy cross-docking (S8 [F]); Omniful cross-docking (S11 [F]); Odoo cross-dock (S16 [F]); Deposco cross-docking (S20 [S]) | low for a single-site merchant, medium for 3PL (inferred) | missing: dock type holds packed goods only (domain 4.1) | post-4 (P10) |
| Supplier compliance fields (CR number on product) | Supplier name and commercial registration printed on product for ten listed regulations | SASO on-product labelling from 1 Oct 2026, third-party summary (S25 [F]); SABER registration (S25 [F]) | low: applies to ten product groups, e.g. car seats and solar PV (S25; inferred scope) | missing: supplier record has no CR number (domain 4.3) | owner question Q-U6 |

## Module 3 · Outbound

| Feature | What it does | Who offers it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Fulfilment order from channel, manual or API | One order record with source, recipient, address and lines | Anchanto 200+ integrations (S9 [F]); Omniful plug-and-play integrations (S11 [F]); Aymakan Shopify, Zid and Salla integration (S10 [F]); OTO multi-channel sync (S12 [F]) | high: Salla and Zid order flow (inferred) | covered: WMS-6, domain 4.6 (source channel, manual, api); Salla and Zid intake is INT-11 (wave 4) | 3 · WMS-6 with INT-11 |
| Order waves (group orders for a carrier cut-off, release together) | Batch of orders released at a timed cut-off | Anchanto wave and flexible picking (S9 [F]); Extensiv wave picking (S19 [F]); Odoo wave picking (S16 [F]); Shipsy wave planning (S8 [F]); Logiwa wave as timed release (S24 [S]); NetSuite wave release (S21 [S]) | high: daily courier pickup cut-offs (inferred) | partial: WMS-6 PickTask "or a wave of them" (domain 4.6); no wave object or release rule | 3 · WMS-6 extension (P2) |
| Reservation and allocation | Reserve available stock at order; release on pick or cancel | Omniful real-time inventory sync to avoid overselling (S11 [F]); Salla stock deduction (S30 [S]) | high: prevents double sale across channels (inferred) | covered: WMS-6, domain 4.5, 4.10, W-8 | done (3) |
| Hold for stock (back-order until stock arrives) | Order waits in a hold status and is allocated when stock arrives | Zid automatic order split when one location is short (S1 [F]) | medium: back-orders on Salla and Zid stores (inferred) | covered for the hold state: domain 4.12 (on_hold to allocated), W-9; customer back-order promise not written | done (3) |
| Partial shipment (ship available lines, keep the rest) | Package the lines in stock and hold the others | Zid order splitting across locations (S1 [F]) | medium: stock-outs on multi-line orders (inferred) | partial: packages per fulfilment order (domain 4.7) allow a split; no rule for shipping available lines | 3 · WMS-7 extension (P3) |
| Single-order pick | One pick task per fulfilment order | Shipsy single-order picking (S8 [F]); ShipHero single-item batch (S23 [F]) | high: default for small merchants (inferred) | covered: WMS-6, PickTask (domain 4.13) | done (3) |
| Batch pick (several orders in one walk) | Pick several orders at once; sort into totes or orders later | ShipHero automatic batches and guided routes (S23 [F]); Odoo batch picking (S16 [F]); Shipsy smart batching (S8 [F]); Logiwa batch (S24 [S]) | high: multi-order daily volume (inferred) | partial: WMS-6 PickTask "or a wave of them"; batch sort step not written | 3 · WMS-6 extension (P2) |
| Zone pick (pickers confined to zones, then sort) | Each picker works one zone of the site | Extensiv zone picking (S19 [F]); Shipsy zone picking (S8 [F]); Logiwa zone picking (S24 [S]); NetSuite zone picking (S21 [S]) | medium: needs several pick zones per site (inferred) | missing: zone is a location type (domain 4.1); no zone pick rule | 3 · WMS-6 extension (P2) |
| Cluster pick (several orders sorted into totes at the bench) | Pick several orders, sort at a cluster station | Odoo cluster picking (S16 [F]); Logiwa cluster picking (S24 [S]); Shipsy cluster picking strategy (S8 [F]) | low: needs a sort station (inferred) | missing | post-4 |
| Pick-to-tote (lines into the order's tote) | Put each picked line into a tote named for the order | Shipsy consolidation and sorting (S8 [F]); pick-to-tote not named by other pages read | medium: multi-order picks (inferred) | covered: WMS-1 totes and WMS-6 target tote (domain 4.6), W-2, W-9 | done (3) |
| Mobile scanner pick and pack | Phone or handheld scanner drives each pick and pack step | Logestechs handler app and barcode scanning (S5 [F]); Extensiv mobile scanning at pack (S19 [F]); ShipHero mobile pick and pack (S23 [F]) | high: Arabic-first handheld UI (inferred) | covered: WEB-15 (scanner-first bench) | done (3) |
| Pick-to-light, voice, pick-path optimisation | Light or voice guidance, optimised walk | ShipHero pick-to-light (S23 [F]); Shipsy pick-path optimisation (S8 [F]); Omniful AI picking routes (S11 [F]) | low: hardware cost for small sites (inferred) | missing | post-4 |
| Item scan verification at pack | Scan each picked item before the package closes | ShipHero barcode-verified packing (S23 [F]); Shipsy barcode-verified packing (S8 [F]) | high: wrong-item returns cost more than the scan (inferred) | partial: WMS-7 measures weight and dimensions (domain 4.7, W-10); item scan at pack not written | 3 · WMS-7 and WEB-15 extension (P3) |
| Box suggestion (cartonisation from a box catalogue) | Pick the box that fits the lines; record box and cost | Infoplus cartonisation (S18 [S]); Deposco cartonisation (S20 [S]); Shipsy consolidation into secondary packages (S7 [S]) | medium: box cost and carrier size classes (inferred) | missing: WMS-7 needs measured dimensions at bench; no box catalogue (domain 4.7) | 3 · WMS-7 extension (P3) |
| Packing slip and shipment documents | Print the slip or document set for the package | Extensiv packing slips (S19 [F]); Shipsy shipment documentation (S8 [F]) | medium: slip for every parcel, invoice for B2B (inferred) | missing: no slip in domain 4.7 | 3 · WMS-7 extension (P3); invoice owner Q-U7 |
| Shipping labels (carrier) | Print an AWB label from the carrier | Shipsy label generation (S8 [F]); OTO bulk label generation across carriers (S12 [F]) | high: label per parcel (inferred) | covered: INT-8 (labels, carrier shipment), WMS-7 (domain 4.7, W-12); behind allowlist flag (INT-8) | 3 · INT-8 (after Q-29) |
| Carrier manifest and end-of-day close | Close the day's shipments into a manifest for pickup | Shipsy manifestation (S8 [F]) | high: courier pickup every day (inferred) | partial: INT-8 covers shipment, AWB and tracking; no manifest named | owner question Q-U13 |
| Own-fleet handoff (driver pickup creates a Delivery order) | Package goes to the merchant's own driver; a Delivery order is created in the same transaction | not in any product page read; this product's design (ADR-0014) | high: own fleets are the product's core (inferred) | covered: WMS-7, W-11, DEL-2 | done (3) |
| Dispatch staging and handover (dock to transit) | Packed goods wait at dock, then move to transit at handover | Shipsy dispatch staging (S8 [F]) | high: every handover (inferred) | covered: domain 4.1 (dock, transit), W-14, WMS-7 | done (3) |
| COD amount on the fulfilment order | Cash-on-delivery amount carried from order to parcel | Shipa COD and payment at door (S6 [F]); OTO sorts carriers by COD (S12 [F]) | high: COD is common in KSA (inferred) | covered: WMS-6 field (domain 4.6); cash custody in Delivery (ADR-0007) | done (3) |
| B2B fulfilment (wholesale order, PO reference, pallets, EDI) | Order type for wholesale buyers with PO reference and case or pallet lines | Extensiv B2B order type and 3PL billing (S19 [F]); Omniful B2B and B2C (S11 [F]); Anchanto B2B and B2C (S9 [F]); Aymakan B2B and B2C (S10 [F]); ShipHero wholesale EDI (S23 [F]) | high for distributors, low for parcel merchants (inferred); S7 cites a Saudi food distributor case [F] | missing: source is channel, manual or api only (domain 4.6) | post-4 (P9) |
| Carrier rate shopping | Pick the cheapest carrier label by rules | ShipHero Rate Shop Plus (S23 [F]) | not applicable here | out of scope: ADR-0001 and W-12, this product never computes carrier prices | excluded |

## Module 4 · Returns, channel stock and replenishment

| Feature | What it does | Who offers it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Return receiving (expected, then received) | Log a return against the order and count it in | Shipsy automated returns workflow (S7 [S]); OTO self-service returns portal and return labels (S12 [F]); Aymakan local and international returns (S10 [F]); Extensiv returns via add-on (S19 [F]) | high: returns are routine in KSA e-commerce (inferred) | covered: WMS-8, domain 4.8; depends on DEL-18 (wave 4) | 4 · WMS-8 |
| Disposition per line (restock, quarantine, scrap) | Each returned line gets a disposition that moves stock | Odoo return routes for assessment, refurbish, restock, disposal (S16 [F]); Shipsy restock, reject and write-off routing (S8 [F]) | high: damaged returns must not reach stock (inferred) | covered: WMS-8, W-17 | 4 · WMS-8 |
| Restock on a store return (merchant's choice) | Merchant decides in the store whether returned goods go back to stock | Salla: "Return the products to stock (optional)" at the restored step, not automatic (S4 [F]) | high: sets merchant expectation on Salla (inferred) | partial: WMS-8 depends on DEL-18 and Q-36; the trigger from a store return is not written | owner question Q-U12 |
| Exchange (one stop, out and in) | Swap an item in one visit | Salla article does not mention exchanges (S4 [F]) | medium (inferred) | covered elsewhere: DEL-18 and Q-4 (one order of kind exchange); WMS side not written | 4 · DEL-18 |
| Channel stock publication (quantity per product per channel) | Push available quantity to each sales channel | Zid assigns sales channels to each warehouse (S1 [F]); Omniful real-time sync across channels (S11 [F]); Aymakan integration with Salla and Zid (S10 [F]) | high: Salla and Zid merchants (inferred) | covered: INT-12, domain 4.9, 5.3, W-18 | 4 · INT-12 |
| Channel drift reconciliation | Compare published quantity with the channel and correct it | Omniful real-time sync (S11 [F]) | high: overselling on channels (inferred) | covered: INT-12 ("drift reconcile"); Q-36 open | 4 · INT-12 |
| Per-channel or per-warehouse allocation (safety stock) | Hold back stock from one channel or site | Zid channel per warehouse (S1 [F]); Salla per-branch availability (S2 [F]) | medium: channel shares for multi-branch merchants (inferred) | missing: ChannelPublication carries one quantity (domain 4.9) | 4 · INT-12 extension (P8) |
| Native low-stock alert (threshold per product and option) | Notice when available falls below the merchant's minimum; in-app banner and email | Salla minimum per product and per option, red marking, banner, in-store notice, email, "products about to run out" filter (S3 [F]); Odoo low-stock notice to procurement (S16 [F]); Logestechs low-stock report (S5 [F]); Zoho low-stock notice for reorder (S17 [F]); Zid has none native, third-party Hopstack (S28 [S]) | high: Salla merchants already get it (inferred) | missing: no alert row in roadmap; domain 6 has only ops alerts | 3 or 4 · WMS-3 extension (P5) |
| Replenishment rule (min and max to PO or transfer) | Create a PO or transfer when stock falls below a level | Odoo reordering rules (S16 [F]); Zoho reorder notice (S17 [F]); Omniful automated replenishment (S11 [F]); Shipsy pick-face replenishment (S8 [F]) | medium: restocking discipline for merchants with suppliers (inferred) | missing | post-4 (P8) |
| Inter-site transfer order (request, approve, confirm at destination) | Move stock between sites with an approval and a confirmation at the receiver | Zid stock transfers in three steps (S1 [F]); Zoho transfer orders update stock on transfer (S17 [F]); Omniful transfers across locations (S11 [F]) | high: branch merchants (inferred) | partial: movement reason transfer (domain 4.4), tote transfer (W-2); no transfer order or approval | 3 · WMS-1 and WMS-3 extension (P7) |
| Withdrawal priority across sites | Which site ships first when several hold stock | Zid withdrawal priorities with automatic order split (S1 [F]) | medium: multi-branch merchants (inferred) | missing | 3 · P7 scope |
| Stock movement and reconciliation report | SKU movements, low stock, inbound and outbound | Logestechs SKU movements, low-stock and inbound-outbound reports (S5 [F]); Zid adjustment log by channel (S1 [F]) | high: owner audit (inferred) | partial: ledger (WMS-3) exists; reporting views are in document 5, no WMS row | 3 · WMS-3 reporting (doc 5 §3) |

## Proposed orders

Eight of the ten are extensions of existing WMS or INT rows; the rest are new and unscheduled.

- **P1 · WMS-2a variants.** Options (size, colour) as child SKUs with stock and alerts per option. Depends on WMS-2, before WEB-13. Needs Q-U1. Wave 3.
- **P2 · WMS-6a pick strategies.** Wave release, batch and zone pick, expiry-first (FEFO) lot allocation. Depends on WMS-6 and WMS-3 (StockSummary) and Q-U4. Wave 3.
- **P3 · WMS-7a packing.** Box catalogue and box suggestion, item-scan verification at pack, packing slip, partial shipment of available lines. Depends on WMS-7 and WEB-15. Wave 3.
- **P4 · WMS-4a receiving holds and put-away rules.** Quality-hold status before stock is sellable; rule-based put-away. Depends on WMS-4 and the zones of WMS-1. Wave 3.
- **P5 · WMS-3b low-stock alerts.** Threshold per product and option on StockSummary; in-app and email sent through the outbox (PLAT-8, PLAT-9), never direct from the service. Depends on WMS-3 and PLAT-8; channel choice needs Q-U8. Wave 3 or 4.
- **P6 · WMS-5a scheduled and threshold cycle counts.** Count schedule and variance-threshold trigger on CountSession. Depends on WMS-5 and Q-17. Wave 3.
- **P7 · WMS-1a inter-site transfers.** Transfer order with request, approval and destination confirmation; withdrawal priority across sites; printable location and tote labels. Depends on WMS-1 and WMS-3; timing depends on Q-U9. Wave 3 if the pilot is multi-site, else 4.
- **P8 · INT-12a channel allocation and replenishment.** Safety stock per channel and per warehouse; min and max replenishment to PO or transfer. Depends on INT-12, WMS-4 and P7; needs Q-36 and Q-U7. Post-4.
- **P9 · WMS-9 B2B fulfilment (new).** Wholesale order type with PO reference, case and pallet units, unit-of-measure conversion on WMS-2. Depends on WMS-6, WMS-7 and the UoM extension; needs Q-U2. Post-4, unscheduled.
- **P10 · WMS-4b ASN matching and cross-dock (new).** Depends on WMS-4 and P4. Post-4, only if a 3PL client needs it.

## Unanswered

Owner questions (the sources do not settle these):

- **Q-U1 Variants.** Are sizes and colours separate products or options of one product? Salla and Zid model options per product (S2, S3).
- **Q-U2 Customer type.** Does the product serve 3PL clients holding several clients' stock in one account, or only merchants with their own stock? AGENTS.md says own stock and own fleets; B2B and cross-dock depend on the answer.
- **Q-U3 Valuation.** Is inventory valuation (cost layers, COGS) in this WMS or in a finance product?
- **Q-U4 Expiry.** Does the pilot merchant sell expiring goods, and must FEFO allocation apply from the first release? Which categories? Pharma would bring the SFDA GS1 DataMatrix rule (S26, secondary).
- **Q-U5 GS1.** Are GTIN and GS1-128 needed, or are internal SKUs with EAN-13 scanning enough? Does the owner hold GS1 KSA membership?
- **Q-U6 Labelling.** Do any pilot products fall in the ten SASO labelling groups from 1 Oct 2026 (S25, third party)? If so, the supplier record needs a CR number.
- **Q-U7 Documents.** Is the packing slip in scope? Does the merchant's Salla or Zid invoice serve as the document, or does this product issue ZATCA e-invoices (S27, secondary; the wave 24 date cited there has passed)?
- **Q-U8 Alert channels.** Are low-stock alerts email and in-app only, or also WhatsApp?
- **Q-U9 Pilot shape.** How many sites does the pilot merchant run? Q-31 is still open and decides the timing of P7.
- **Q-U10 Live counts.** Is counting while sales continue required (Zid offers it, S1), and is a blind count the default?
- **Q-U11 Over-receipt.** What is the default tolerance above the PO line (W-15 leaves it to the account)?
- **Q-U12 Store returns.** Should a store return restock automatically, or only on a manual disposition (Salla is manual, S4)?
- **Q-U13 Manifest.** Is a carrier manifest and end-of-day close needed for the pilot (Shipsy has one, S8)?
- **Q-U14 Returns to supplier.** Is return-to-supplier in scope? No product page read named it.

Research gaps (no source settled these):

- Torod, Flow and Stockwise: no WMS feature list found (S13, S14, S15). Their feature set is unknown.
- Deposco's own platform page returned 404 on 2026-11-02; its features come from third-party excerpts (S20).
- Logiwa's WMS page returned an image only; its features come from one search excerpt (S24).
- Infoplus, NetSuite, Cin7 Omni and Shipa rely partly on search excerpts or on a Shipa page that names a Kuwait site while excerpts name Dubai sites (S6, S18, S21, S22).
- Salla's inventory report and retail stock-deduction behaviour were seen only in search excerpts (S29, S30).

## Sources (read 2026-11-02; [F] fetched and extracted, [S] search excerpt only)

- S1 [F] https://zid.sa/en/solutions/inventory-management/
- S2 [F] https://help.salla.sa/en/article/control-product-quantities-branches/crqxuonirexeqkgd3w1iqjrk (marked old, Special plan only)
- S3 [F] https://help.salla.sa/en/article/low-stock-alerts/sc46ypoxa7sa02zr5qmtcde9
- S4 [F] https://help.salla.sa/en/article/manage-order-returns-refunds/lwd3jzhb0qs7v51b50rcc50a
- S5 [F] https://logestechs.com/fulfillment-management-system/
- S6 [F] https://shipa.com/shipa-ecommerce/e-fulfillment/
- S7 [S] https://shipsy.io/?p=26984 (guide; vendor features separated from general guidance)
- S8 [F] https://www.shipsy.ai/warehouse-management-system (redirect from shipsy.io)
- S9 [F] https://explore.anchanto.com/en-sa/?p=135680
- S10 [F] https://aymakan.com/storage-fulfillment
- S11 [F] https://www.omniful.ai/best-wms-software
- S12 [F] https://www.tryoto.com/en-ae/otopedia/blog/optimizing-shipping-operations
- S13 [S] https://torod.co/en/about-us
- S14 [S] https://www.tradearabia.com/news/IND_292827.html ; https://linkedin.com/company/flowpl
- S15 Stockwise: no source found.
- S16 [F] https://www.odoo.com/app/inventory-features
- S17 [F] https://www.zoho.com/inventory/warehouse-management-software/
- S18 [S] https://www.infopluscommerce.com/products/wms ; https://www.infopluscommerce.com/knowledge-base/perform-cycle-counts-infoplus-1 (infoplus.ai returned a parked domain)
- S19 [F] https://www.extensiv.com/warehouse-management-system
- S20 [S] https://www.rfp.wiki/supply-chain-logistics-transportation/warehouse-management-systems/ongoing-wms/deposco ; https://deposco.com/resources/success-stories/gunner/ (deposco.com platform URL returned 404)
- S21 [S] https://www.netsuite.com/portal/products/erp/warehouse-fulfillment/wms.shtml ; https://www.cleverence.com/articles/oracle-documentation/netsuite-wms-overview-4827/
- S22 [S] https://help.core.cin7.com/hc/en-us/articles/9034555914383-Serial-numbers-and-batch-numbers-in-Cin7-Core-WMS ; https://help.omni.cin7.com/hc/en-us/articles/9128553363855-Locations-overview ; https://help.core.cin7.com/hc/en-us/community/posts/14448451870863-Feature-Request-Cycle-Count
- S23 [F] https://www.shiphero.com/ecommerce-wms ; lot video [S] https://www.shiphero.com/videos/lot-and-expiration-tracking
- S24 [S] https://www.logiwa.com/?p=15981
- S25 [F, third party] https://www.hqts.com/saso-new-labeling-rule/
- S26 [S] https://gs1.org/insights-events/case-studies/complying-saudi-arabian-requirements-drug-identification-and-traceability
- S27 [S] https://www.cleartax.com/sa/zatca-wave24-einvoicing-in-saudi-arabia ; https://www.wafeq.com/en-sa/tax-and-reporting/which-zatca-wave-am-i-in-deadlines-and-what-to-do
- S28 [S] https://www.hopstack.io/integrations/zid
- S29 [S] https://help.salla.sa/en/article/review-product-inventory-salla/s9xjb3vv31r0ockqf42mekze
- S30 [S] https://help.salla.sa/en/subcategory/retail-sales/f65p91dcdbjxx33nr4gi16z5
- S31 [S, third party] https://apps.odoo.com/apps/modules/16.0/gts_arabic_report
