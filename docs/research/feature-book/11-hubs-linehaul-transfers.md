# Feature book 11: Hubs, linehaul and transfers

Date: 2026-11-02. Branch `docs/feature-book-11-hubs` from `origin/main` at `6ca087e`. Author: researcher agent for the lead. Status: research input; no decisions taken. Each "Chosen shape" is a proposal for the lead to rule; nothing here changes the roadmap, an ADR or the domain model.

Method. Repo facts are read from `origin/main` at `6ca087e` on 2026-11-02 and cited by path and section (R-ids in the registry). Market facts come from the research notes on `origin/docs/feature-coverage` and `origin/docs/platform-teardowns`, read 2026-11-02, cited by note and source ID (N-ids). Three web reads by this researcher on 2026-11-02 are listed as W-ids: two search excerpts and one fetch that returned 403. Labels: **[S]** the source states it; **[I]** my inference from stated facts; **[claim]** a vendor or marketing statement with no mechanism behind it.

Scope note. The twelve requested items are covered by nine feature sections so the chapter fits 500 lines. Items 2 and 3 share F-02, items 4 and 5 share F-03, and items 10 and 11 share F-08. The feature index keeps all twelve items visible.

## Summary for the lead

1. A hub does not exist in the repo. ADR-0018 defines site kinds `branch | warehouse | both` (R-ADR18); domain K-4 limits dispatch to `branch` or `both` and WMS locations to `warehouse` or `both` (R-DM §2.3); `core_sites.kind` has the same CHECK (R-DATA §2.1). No roadmap row names a hub, transfer, manifest, trip or dock capacity (R-RM §1; N-FC §1 calls it "a full gap").
2. A hub needs a decision before any row: either a fourth site kind (amends K-4 and W-1, needs a superseding ADR) or a separate hub entity (reintroduces the table split ADR-0018 rejected). Both need a new ADR, not a quiet edit (AGENTS.md rule 7).
3. Scope is not ruled. ADR-0002 names two modules, Delivery and WMS; hubs and linehaul fit neither. The owner's first question in N-FC §4 is still open.
4. Only Shipsy publishes a hub operating model (scan-driven sort to cages, hub-to-hub trips, load balancing) [S, N-SH §2.2, vendor pages]. Logestechs names line haul and hubs as claims with no mechanism [claim, N-LG §1.5]. Omniful names multi-hub and stock transfer orders by article title only [S, N-OM §2.2].
5. Two kinds of transfer must stay apart. Parcel transfer moves an order between sites (F-05); stock transfer moves product between sites through the ledger (F-06). Stock transfer has the stronger market evidence (five platforms, N-PC §2).
6. Cost to neighbours is highest for Delivery: the site on an order (`del_orders.site_id`), coverage (D-3, D-12), the order state machine (§3.13) and the custody rules (D-18 to D-21). Section 0 lists each.
7. The id space is contested. Handbook 04 and roadmap §0 list no `HUB` prefix; N-FC uses HUB-1 to HUB-3 for transfer, manifests and capacity; N-SH uses HUB-1 and HUB-2 for hub kind and trips; N-WMS calls the stock transfer P7 and N-FC calls it WMS-15. Section "Unanswered" proposes one mapping.
8. TGA freight rules: no source in the input set gives the licence conditions for own-fleet linehaul. One search excerpt says the freight regulation covers carriage for hire and for own account, that intercity goods carriage is reserved for Saudi-registered trucks, and that a TGA permit sits on top of the commercial register (W-S1; secondary, unverified). A second excerpt reports a TGA warning that delivery apps using unlicensed vehicles may be blocked (W-S2). The regulation text was not readable (W-F1, 403).
9. GCC cross-border linehaul is a scope note only. No source reads customs for hub or linehaul flows. ADR-0002's module list and the country model (N-FC §2 item 1) come first.
10. Timing: no hub row is in wave 0 to 2. The stock transfer (WMS-15) can enter wave 3 only if the pilot runs several sites (Q-U9, Q-31 open). Hub parcel work is wave 4 or later and waits on the scope ruling.

## 0. What a hub needs, and what it costs each neighbour

| Neighbour (order, ADR, rule) | What a hub changes | Cost if we add it |
|---|---|---|
| Kernel sites (ADR-0018, K-4, K-5, `core_sites.kind`) | Hub as a kind, or a `core_hubs` row that points at a site | Option A: CHECK change, K-4 and W-1 amended, superseding ADR. Option B: no kind change but a second table, the split ADR-0018 rejected. K-5 (no deactivation with open orders, cash or stock) must cover hubs with parcels in transit. |
| Delivery orders (`del_orders.site_id`, D-3, D-5, §3.13) | A parcel can wait at a hub before its final site | Re-pointing `site_id` re-runs coverage (D-3 is per site and zone). §3.13 has no state for "at a hub"; reassignment is an Assignment change (§3.13 note), so a transfer can follow that pattern without a status. |
| Dispatch and offers (DEL-6, D-12, D-13, CapacityCounter §3.8) | Linehaul trips need a vehicle load limit | `CapacityCounter` counts orders per driver; vehicle capacity in parcels exists (§3.5) but is not enforced per trip. A trip aggregate and a load check are new. |
| Shifts and vehicles (DEL-5, §3.6, §3.17) | Linehaul drivers run shifts at a hub site | Shift rules are per site already; no change beyond the site kind. |
| Cash custody (ADR-0007, D-18 to D-21, §3.11) | Hub staff may receive COD parcels; linehaul carries parcels, not cash | Custody holders are driver, cashier at site, bank (§3.11). A hub cashier needs a CashReport per hub site (D-21). A linehaul driver must not hold COD cash unless a custody rule says so. |
| WMS locations and stock (W-1, W-14, §4.1, §4.4) | A hub that holds product | W-1 forbids non-system locations outside `warehouse` or `both` sites. Parcel-only hubs need no WMS locations. `dock` and `transit` are per-site location types (§4.1). |
| Events and webhooks (§6.3, ADR-0027, INT-10) | New families: hub scan, trip, transfer, exception | Each is a contract addition. Merchant webhooks need signing and a catalogue entry (INT-10). Consumers: WMS (stock transfer), reporting, cash report. |
| Permissions and roles (`docs/contracts/README.md` role table) | Hub staff and supervisors | `site staff` has `delivery.orders.receive` but no scan or trip permission. New permissions need the roles catalogue. |
| Tracking (D-24, §3.12) | A customer may ask where the parcel is | The public view has no "at hub" status. Adding one changes D-24. |
| Reporting (data §9) | Hub dimension | `rpt_site_day` gives a site dimension already; hub KPIs need a new view (F-09). |
| Web and app surfaces (web.md, ADR-0021, ADR-0033) | Site form, hub board, trip planner, scanner | Site form exists (`/settings/sites`, WEB-3 merged #109). Hub board, trip planner and scanner are new. ADR-0021 covers the driver app only. |
| Rollout (ADR-0006, AGENTS.md hard rule) | Any new module | Ships behind `allowlist` by default with the provisioning door. |

## 1. Features

Each feature carries the ten aspects in the order the brief requires. "Roadmap" names the row that exists today; "missing" means no row, aggregate or screen.

### F-01 Hub as a site kind (brief item 1)

Roadmap: missing. Kind set `branch | warehouse | both` (R-ADR18, R-DM §2.3, R-DATA §2.1). N-FC §1 rates the hub and linehaul group "a full gap".

**1. Definition and user goal.** A site that receives parcels from other sites, sorts them and sends them on. The merchant wants one network view of branches and their hub, with its own staff and address. [S, N-SH §2.2; N-OH §4]

**2. Workflow.** Create the hub site (name `ar`/`en`, address, National Address short code, point, hours, staff through membership `site_ids`, R-DM §2.2). States `active ⇄ inactive` as for any site (K-5). No hub-specific lifecycle is defined by any source. [I]

**3. Business rules and edge cases.** A hub that dispatches its own orders is excluded by K-4 as written. Shipsy's setup has "Active and Disabled Hub" articles (N-SH §2.2, A5 titles only). Logestechs lists "Manage Multiple Hubs" with no mechanism [claim, N-LG §1.5]. Omniful defines a hub as a facility that receives, stores, processes and distributes [S, N-OM §2.2, O4 titles]. Corridor distances between Riyadh, Jeddah and Dammam are not in any source. [I]

**4. Data.** Option A: `kind` gains `hub`; K-4 and W-1 change; one CHECK migration. Option B: `core_hubs (site_id unique)` with hub-only attributes; no kind change. Under either, a hub with product needs W-1 locations, so Option A must also amend W-1. Retention: as sites, never deleted once referenced (R-DM §2.3). [I on the options; K-4, W-1, K-5 as stated]

**5. Surfaces.** The site form at `/settings/sites` gains the kind (R-WEB §8 screen inventory, WEB-3). The site switcher lists `membership.site_ids` (R-WEB §4 site scoping). No API change beyond the existing `core.sites.manage` routes. [S for the existing screens]

**6. Permissions, roles and audit.** `core.sites.manage` for create and update; site scope from membership (R-CONTRACTS role table). Admin actions write audit rows (K-7). [S for K-7; the hub write being audited is [I]]

**7. Dependencies and integrations.** PLAT-12 sites (merged #89), the `delivery` feature gate (ADR-0006, DEL-1), coverage rows `del_coverage` keyed by site (R-DATA §2.2). Cost to each neighbour is in section 0. [S]

**8. Metrics and reporting.** Hub count per account; hubs with open parcels blocked from deactivation (K-5 extended). No market metric is sourced. [I]

**9. How the market builds it.** Shipsy: hub and rider master data, hub setup as an admin article (N-SH §2.2, A5). Omniful: multi-hub with a hub-to-channel mapping at connection setup (N-OM §4.1, O18 [F]). Logestechs: claim only (N-LG §1.5). No source states a fourth kind. Chosen shape (proposal): Option A is the smaller change for one screen and one location tree; Option B keeps ADR-0018 intact but repeats the address table ADR-0018 rejected. Trade-off named by R-ADR18: the two-table split duplicates address handling and forces a join whenever a site dispatches its own orders; the single table avoids both. ADR needed: a new ADR (proposed number ADR-0042, the next free on `origin/main`) superseding the K-4 clause of ADR-0018.

**10. Roadmap mapping.** Missing. Gate before HUB-1 to HUB-3. Owner: Q-H1 (scope), Q-H2 (kind or entity). Wave: the decision can be taken now; the kind change ships with the first hub order in wave 4 (proposal). [I]

### F-02 Parcel inscan, outscan, sort-by-destination and cages (brief items 2 and 3)

Roadmap: missing; DRV-4 pickup-by-scan is the only scan path (R-RM §1.2).

**1. Definition and user goal.** Inscan records a parcel's arrival at a hub; outscan records its departure on a trip. Sort routes each scanned parcel to a cage or bag by destination and route order, so a parcel's place is always known. [S, N-SH §2.2 rows "Scan-driven sorting", "Inscan with weight and volume"]

**2. Workflow.** Inscan (hub staff scans; system checks weight and volume) → sort instruction (audio and visual guidance to a cage by destination and route sequence) → cage closed → outscan onto a trip (F-04). Exceptions: duplicate scan, unknown identifier, wrong cage (F-08). A per-parcel state such as `in_hub` or `in_cage` is [I]; §3.13 has none and should keep none, so the scan log carries the location. [S for the sort; [I] for states]

**3. Business rules and edge cases.** Sort is by destination and route sequence [S, N-SH]. No KSA rule on hub sorting appears in any source. An own-fleet order has no scannable identifier: `del_orders` carries `number` (`D-000123`) and `source_ref` [R-DM §3.1, R-DATA §2.2]; barcodes exist only on products (`wms_product_barcodes`, R-DATA §2.3). A parcel-level barcode or the order number must be chosen. [I, gap in R-DM]

**4. Data.** `del_hub_scans` append-only, modelled on `del_order_events` (D-15, trigger): `order_id`, `site_id`, `kind ∈ {inscan, outscan}`, `cage_id`, `trip_id`, `device_id`, `client_ts`, `server_ts`, `idempotency_key` unique per account. Cages: either a new `del_cages` table or a `wms_locations` type; the second needs W-1, so it is a stock-holding site. Retention: as order events [I]. [S for D-15 pattern]

**5. Surfaces.** Scanner: none. No warehouse handheld app exists; ADR-0021 covers the driver app only (R-ADR21 by title, N-SH §6 item 7). Five of nine platforms run the floor on handhelds (N-PC §5 Q1). Web: a scanner-first bench is WEB-15 for packing only (R-RM §1.4). Cage and parcel labels: none in the roadmap (WMS-15 lists printable location and tote labels, N-WMS P7).

**6. Permissions, roles and audit.** No scan permission exists. `delivery.orders.receive` (site staff) is the nearest and is too broad for outscan [I]. A new `delivery.hub.scan` would be proposed. Every scan is an append-only row, which is the audit. [S for the role table; [I] for the new name]

**7. Dependencies and integrations.** DEL-2 (order number), INT-1 storage for label files, WMS-7 label patterns, PLAT-8 outbox for any hub event that an integration consumes. The scan itself calls no external system, so no outbox row is required for the scan [I].

**8. Metrics and reporting.** Sort accuracy = scans routed to the correct cage ÷ sort scans; a mis-route is visible only if a later check finds it, so a second signal is needed [I]. Dwell time = outscan time − inscan time per site. Shipsy claims 99% sort accuracy and 40% faster hub processing [claim, N-SH §2.2, A3]; not used as a target.

**9. How the market builds it.** Shipsy: scan at intake, audio and visual sort instruction, cage and loading group by destination and route sequence, hub app and devices [S, N-SH §2.2, A3 and A4 F]. Anchanto and Omniful: sorting-hub management and inter-hub routing in an AWS listing [claim, N-OM §2.2, O15 T]. Logestechs: "zone-based sorting" in the handler app [claim, N-LG §1.2, L5]. Chosen shape (proposal): adopt Shipsy's deterministic sort (bins by destination), with no ML, as the first version; the scan log is ours. Reason: Shipsy's own teardown recommends "bins by destination and capacity; no AI until there is data" [I from N-SH §5 row 168]. Trade-off: one write per parcel per hop, against a complete trail.

**10. Roadmap mapping.** Missing. Proposed order HUB-3 (N-FC §3 "sort-by-destination and cages", wave 4 or later), with the inscan part of HUB-1. Owner: Q-H3 (handheld app or web bench), and the parcel identifier question in the data section.

### F-03 Outbound and inbound manifests, load lists and handover to a driver (brief items 4 and 5)

Roadmap: missing as manifests. Partial: pack-time handover (W-14, WMS-7) and driver pickup by scan (DRV-4).

**1. Definition and user goal.** An outbound manifest is the list of parcels going to a destination on a trip, printed and scanned at loading. An inbound manifest is what a sending site expects a hub to receive. A load list is the part of a manifest on one vehicle. A handover scan is the moment a driver takes parcels from a warehouse or branch. [S, N-OH §4 rows; N-SH §2.2]

**2. Workflow.** Branch or warehouse builds the outbound manifest → scan at loading → trip departs (F-04) → hub receives the inbound manifest (whole-manifest receive at destination, one vendor article [weak, N-OH S24 search summary]) → exceptions to F-08. Warehouse handover: `dock` → `transit` at handover (W-14), then `picked_up` on the driver's scan (§3.13). Manifest-level handover is missing [S, N-OH §4 row].

**3. Business rules and edge cases.** W-14: each package moves tote → `dock` at pack, `dock` → `transit` at handover, `transit` → CUSTOMER on delivery, each idempotent per package (R-DM §4.16). W-13: a package's method cannot change after `handed_over`. Whether a carrier-style manifest with end-of-day close is needed for the pilot is open (N-WMS Q-U13; Shipsy has one [S, N-SH]). KSA: none.

**4. Data.** `del_manifests` (`site_from`, `site_to`, `trip_id`, `status ∈ {open, sealed, received}`, `sealed_at`, `version`) and `del_manifest_lines` (`order_id` or `package_id`, scanned flag). Invariant [I]: a parcel is on at most one open manifest (partial unique index, the pattern of D-9). Sealed manifests are immutable. Retention: as orders. [I]

**5. Surfaces.** Dispatch board (WEB-7) for printing a load list; driver app run list (DRV-4 pattern) for the linehaul run [I]; no scanner (F-02). API: none exists [I].

**6. Permissions, roles and audit.** Trip and manifest creation: `delivery.orders.dispatch` (dispatcher, R-CONTRACTS role table). The `wms.*` permission list has no handover permission (R-CONTRACTS permission catalogue), so a warehouse handover needs one [I]. Audit through the append-only scan and event rows.

**7. Dependencies and integrations.** DEL-6 (assignment per trip), DEL-4 (driver), DEL-5 (shift and vehicle), WMS-7 packages (`handed_over`), INT-1 for label files, DEL-20 labels (proposed, N-FC §3).

**8. Metrics and reporting.** Load variance = expected lines − scanned lines at loading; handover lag = manifest sealed − driver scan; missing-at-loading rate. All derived from F-02 and F-03 rows. [I]

**9. How the market builds it.** Shipsy: automated trip creation and vehicle loading [S, N-SH §2.2 A3 F]. FarEye: a shipment call generates a label and a manifest [S, N-OH §4, search summary]. Logestechs: "receive load requests, load, zone-based sorting" in the driver and handler apps [claim, N-LG §1.2, A1 F]. Chosen shape (proposal): our own sealed manifest entity. Reason: W-14 and D-15 already make the parcel path an append-only fact; a sealed list adds the proof of what left. Trade-off: a manifest is one more object to keep consistent with the trip; without it, the trip is the only list.

**10. Roadmap mapping.** Missing. Proposed HUB-2 (N-FC §3), depends on F-05 and DEL-5. Owner: Q-H4 (is a manifest a document the pilot needs; N-WMS Q-U13).

### F-04 Hub-to-hub and branch-to-hub linehaul trips with capacity balancing (brief item 6)

Roadmap: missing. Vehicle capacity in parcels exists (R-DM §3.5); DEL-6 and DEL-10 plan offers per order, not trips.

**1. Definition and user goal.** A trip moves a loaded set of parcels between two sites by one vehicle and driver. Balancing spreads parcels across trips and vehicles by capacity, destination and service time. [S, N-SH §2.2 "Hub-to-hub trip creation", "Load balancing"]

**2. Workflow.** Planner creates the trip (manual, or by rule) → parcels allocated from the outscan pool by destination → vehicle and driver assigned on an active shift (DEL-5) → depart → arrive (inscan at the destination hub, F-02) → close. Trip states [I]: `planned → loading → departed → arrived → closed`, plus `cancelled`. Shipsy also runs delay alerts that resequence downstream stops [S, N-SH §2.2 CT Agent; vendor].

**3. Business rules and edge cases.** Vehicle capacity in parcels (R-DM §3.5); load ≤ capacity [I]. Driver on an active shift at the origin site (cf. D-12 pattern). Regulation scope: a search excerpt says the freight regulation covers carriage for hire and for own account [W-S1, secondary, unverified; the text was not readable, W-F1 403]. Intercity carriage: the same excerpt says only Saudi-registered trucks may carry goods between Saudi cities [W-S1, unverified]. A TGA permit on top of the commercial register: a consultancy guide [W-S1, secondary]. The TGA warned that delivery apps using unlicensed vehicles may be blocked [W-S2, Zawya excerpt]. Corridor distances and times: none in the sources. GCC cross-border and customs: not read; the TMS and customs module is out of scope (ADR-0002, N-SH §5 row 173). Own vehicles and drivers only (ADR-0005), so third-party line-haul carriers are excluded [I, consistent with N-OH §7 item 9].

**4. Data.** `del_trips` (`site_from`, `site_to`, `vehicle_id`, `shift_id`, `planned_depart`, `departed_at`, `arrived_at`, `status`, `capacity_parcels`, `version`) and `del_trip_lines` (`order_id` or `package_id`, outscan reference). Invariants [I]: a parcel on at most one open trip; trip load ≤ vehicle capacity in one transaction. Trip GPS: DEL-5 ring keeps one hour; trails 90 days (R-DM §7, ADR-0028).

**5. Surfaces.** Web trip planner (new screen; WEB-7 pattern). Driver app linehaul run list (new; the driver app spec has no linehaul screen [I]). Recipient tracking for trips: none (D-24 covers orders only).

**6. Permissions, roles and audit.** `delivery.orders.dispatch` for trip creation [I]; trip changes audited through the trip event rows.

**7. Dependencies and integrations.** DEL-5 (vehicle position), DEL-4 (driver), F-03 manifests, INT-6 (VROOM sequencing per driver, ADR-0010; multi-stop between hubs is not a per-driver tour [I]), DEL-16 (re-solve, wave 4).

**8. Metrics and reporting.** Trip utilisation = parcels or kilograms loaded ÷ vehicle capacity at departure; on-time departure; linehaul dwell at each end; delay alerts. Shipsy's 30% linehaul cost claim is vendor-stated [claim, N-SH §2.2].

**9. How the market builds it.** Shipsy: AI trip creation, vehicle loading, route planning for land and air, load balancing by capacity, destination and SLA, linehaul tracking [S, N-SH §2.2 A3 F]. FarEye: long-haul and cross-docking [search summary, N-OH §4 S25]. DispatchTrack: multi-depot routing [S, N-OH §3 S21]. Logestechs: "Line Haul Management for inter-branch transport", no mechanism [claim, N-LG §1.5 L11]. Chosen shape (proposal): deterministic first version, with bins by destination and capacity, and no AI trip creation (the Shipsy teardown's own proposal, N-SH §6 item 2). Reason: no trip data exists yet; Shipsy publishes no rule schema (N-SH §4.5 [I]). Trade-off: rules are predictable but do not optimise a network.

**10. Roadmap mapping.** Missing. Proposed HUB-2, wave 4 or later (N-FC §3, N-OH P8). Depends on F-05 and DEL-5. Owner: Q-H5 (corridors and frequency for the pilot), Q-H6 (own vehicles only; TGA position on own-account carriage, RES-1 in N-PC §4).

### F-05 Inter-site order transfer with arrival scan (brief item 7)

Roadmap: missing. `del_orders.site_id` is the dispatching site only (R-DM §3.1). N-FC proposes HUB-1 "transfer state for orders between sites with an arrival scan" (wave 4).

**1. Definition and user goal.** An undelivered order moves from its dispatching site to another site, and the receiving site scans it in. The merchant wants a parcel that a branch cannot deliver to reach the branch that can. [S, N-OH §4 "Inter-site transfer of orders"]

**2. Workflow.** Request at origin (dispatcher) → outscan at origin (F-02) → in transit → arrival scan at destination → accept (order `site_id` changes) or reject (returns to origin). No state is defined in §3.13 (`pending` to `cancelled`). Transfer states [I]: `requested → in_transit → arrived → accepted | rejected`. Cancel after pickup keeps its current route (failed then returned, §3.13).

**3. Business rules and edge cases.** D-3: an order stays `pending` with `outside_coverage` unless its address zone is covered by its site. A transfer that moves `site_id` must re-run coverage at the destination [I]. By analogy with D-13 (other sent offers become `withdrawn` when one is accepted), open offers should be withdrawn on transfer [I]. COD: a cash parcel carries its custody holder across a transfer only by a custody entry (D-19); no entry type exists for a parcel in transit [I]. KSA: none in sources.

**4. Data.** `del_order_transfers` append-only with `order_id`, `site_from`, `site_to`, `status`, `requested_by`, `arrived_at`, `accepted_at`; partial unique index: one open transfer per order [I]. Each accepted transfer increments the order `version` (R-DM §8 sequence rule). Retention: as order events.

**5. Surfaces.** Order detail action "transfer" (WEB-5 extension, new); arrival scan on the scanner or web bench (none, F-02); API: none in `docs/contracts` yet [I]. Webhook events `delivery.order.transferred` and `.arrived` would be new [I]; INT-10 decides exposure.

**6. Permissions, roles and audit.** Request: `delivery.orders.dispatch` [I]; arrival and accept: `delivery.orders.receive` (site staff, R-CONTRACTS role table, S). Audit through the transfer rows.

**7. Dependencies and integrations.** DEL-2 (state machine, `If-Match`), DEL-6 (offers), DEL-7 (proofs stay with the attempt), DRV-4 (handover at the origin), PLAT-8 outbox for events that other contexts consume (R-DM §1.1, ADR-0024). INT-3's template list has no transfer template [I; R-RM §1.2 INT-3 row].

**8. Metrics and reporting.** Transfer lead time (`requested` to `accepted`); arrival-scan lag; rejected rate; transfers per order. [I]

**9. How the market builds it.** Logestechs: cross-docking as transfers of a parcel between drivers; hub-to-hub transfer not described [S, N-LG §1.5 L7 F]. Shipsy: hub-to-hub trips [S, N-SH §2.2]. Torod: branch shipping in a retail case [S, N-OH §4 S1]. Omniful routes an order to one hub; no split [S, N-OM §4.5 O7 F]. Fulfillor: "Transfer Shipment" for inter-warehouse moves, Jan 2026 [S, N-FU §2 F6 changelog]. Chosen shape (proposal): a transfer aggregate beside the order, not a new order status. Reason: §3.13 is the state machine D-5 enforces, and reassignment is already modelled outside it (§3.13). Trade-off: the ledger of who holds the parcel gets a second table; a driver-to-driver handoff (Logestechs style) is a custody event under ADR-0007, which is a different rule.

**10. Roadmap mapping.** Missing. Proposed HUB-1 (N-FC §3, wave 4, after DEL-6, DEL-7, DRV-4). Owner: Q-H7 (may a parcel change its dispatching site before delivery; who pays for the transfer).

### F-06 Inter-site stock transfer order with approval and destination receipt (brief item 8)

Roadmap: missing; proposed WMS-15 (N-WMS P7 "WMS-1a"; N-FC §3 "WMS-15"). Partial: `transfer` is a movement reason (R-DM §4.4) and tote transfer exists (W-2).

**1. Definition and user goal.** A document that moves product between two sites of one account: requested, approved, shipped into `transit`, and confirmed at the destination, with its own movements. [S, N-PC §2 pattern row; N-WMS Module 4 table row]

**2. Workflow.** Draft → requested → approved (approver is not the requester) → dispatched (movement from pick location to `transit` at origin, reason `transfer`) → received at destination (movement from `transit` to a putaway location) → closed. Partial receipt and short-ship variance are [I]. Zid: stock transfers in three steps [S, N-WMS, S1 F]. Zoho: transfer orders update stock on transfer [S, N-WMS S17 F].

**3. Business rules and edge cases.** Both ends must be `warehouse` or `both` sites (W-1). `from ≠ to` and quantity > 0 (W-5). No negative stock at origin (W-6); transfers draw only available quantity, `on_hand − reserved` over pickable locations (W-8, R-DM §4.10) [I on the transfer reading]. Approval mirrors the adjustment rule: approver ≠ requester (CHECK pattern on `wms_adjustments`, R-DATA §2.3). Withdrawal priority across sites with automatic order split is a Zid feature [S, N-WMS row; not in any roadmap row]. KSA: no WMS rule in the sources [S, N-WMS summary item 9].

**4. Data.** `wms_transfers` (`number` from the per-account sequence, `site_from`, `site_to`, `status`, `requested_by`, `approved_by`, `dispatched_at`, `received_at`, `version`) and `wms_transfer_lines` (product, lot or serial, `quantity_sent`, `quantity_received`). Movements: `reason = transfer`, `ref_type = transfer`, one batch per dispatch and per receipt (R-DM §4.4). Stock truth is the ledger (ADR-0011): a receipt variance is an ADJUSTMENT movement (W-16), never an edit. Retention: `wms_stock_movements` is append-only (R-DATA §3.1 triggers); R-DATA §10 sets no retention period for movements [I].

**5. Surfaces.** WEB-14 stock and movements screens (wave 3) and a transfer screen [I]. Printable location and tote labels (N-WMS P7). Handheld receiving: none (F-02).

**6. Permissions, roles and audit.** No transfer permission exists in the `wms.*` catalogue (R-CONTRACTS permission list). Proposed split follows `wms.adjustments.request` and `wms.adjustments.approve`: `wms.transfers.request`, `.approve` and `.receive`, with approve ≠ request enforced in the database (the R-DATA `wms_adjustments` CHECK). Audit: ledger rows plus `core_audit_log` (K-7).

**7. Dependencies and integrations.** WMS-1 (location trees per site), WMS-3 (ledger and StockSummary cursor), WMS-6 (reservations), WMS-4 (putaway at destination), ADR-0011. Adversary: yes, since it moves stock (R-RM §0 header: "yes" for stock ledgers).

**8. Metrics and reporting.** Transfer lead time; in-transit quantity and age (from `transit` balances, R-DM §4.5 projection); receipt variance rate; transfers per product. [I]

**9. How the market builds it.** Pattern seen in five platforms: a transfer document with its own movements through `transit`, two receipts and approval [S, N-PC §2]. Zid three-step transfers and withdrawal priority [S, N-WMS S1 F]. Omniful: STO between hubs, article title only [S, N-OM §2.2 O4 titles]. Anchanto: auto transfer orders for out-of-stock lines, dated 2022-05-31 [S, N-AN §2 A17]. Fulfillor: transfer shipment with its own movements [S, N-FU F6]. Chosen shape (proposal): borrow the platform pattern inside our ledger: one transfer equals one movement batch per leg. Reason: ADR-0011 forbids mutable quantities, and the `transfer` reason already exists. Trade-off: two movement rows per leg in place of one, as ADR-0011 already costs. No new ADR is needed if the transfer stays inside ADR-0011; a hub that holds stock needs F-01's ADR.

**10. Roadmap mapping.** Missing. Proposed WMS-15, wave 3 if the pilot is multi-site, else wave 4 (N-WMS P7). Depends on WMS-1 and WMS-3. Owner: Q-H8 and Q-U9 (site count for the pilot), with Q-31 (pilot merchant) which decides the timing.

### F-07 Hub capacity and dock throughput (brief item 9)

Roadmap: missing. Partial: `dock` location type (R-DM §4.1, pack-out "packed goods awaiting pickup"), which is a pack-out location, not a hub dock.

**1. Definition and user goal.** A limit per hub, dock or departure on parcels per hour or per load, and the throughput the hub actually achieves, so that planning does not overload a departure. [S, N-OH §4 "Hub capacity and dock throughput"]

**2. Workflow.** Capacity configured per hub or dock → inscan and outscan counts → alert when a departure passes a set load → trip planning checks load (F-04). No state machine is needed [I].

**3. Business rules and edge cases.** Shipsy reports load percentage per departure [S, N-OH §4 S23, vendor]. Logestechs names a Hubs Report [claim, N-OH §4 L10 F]. Reusing `dock` for hub docks would mix pack-out with inbound docks; a separate concept is needed [I].

**4. Data.** `del_hub_capacity` (`site_id`, `dock_code` or null, `parcels_per_hour`, `parcels_per_departure`); throughput is a projection over F-02 scans, rebuildable (the R-DATA §3.5 rebuild pattern applies to projections [I]). No invariant exists in the repo.

**5. Surfaces.** Hub board per site (new). None exists.

**6. Permissions, roles and audit.** Capacity configuration: `core.sites.manage` [I]; read by hub staff.

**7. Dependencies and integrations.** F-02 scans, F-04 trips, WMS-1 locations if `dock` is reused, which requires a W-1 site.

**8. Metrics and reporting.** Dock throughput (parcels per dock-hour); peak load percentage per departure; inscan queue time. [I]

**9. How the market builds it.** Shipsy: load percentage per departure [S, N-OH §4 S23 vendor]. N-OH rates the feature Medium and later. Chosen shape (proposal): configured limits plus a counted projection, no optimiser. Reason: the evidence is one vendor page. Trade-off: a limit can be wrong without a throughput history.

**10. Roadmap mapping.** Missing. Proposed HUB-3, later (N-FC §3 "HUB-3 capacity and sort-by-destination"). Owner: Q-H9 (needed before the pilot's volume?).

### F-08 Missing-parcel and overage handling at a hub; transfer reconciliation (brief items 10 and 11)

Roadmap: missing. No source read names a missing-parcel or overage rule for a hub. Closest: stock overage and shortage through adjustments (W-16, R-DM §4.8) and COD difference classes (N-FU INT-13 proposal).

**1. Definition and user goal.** At a hub, a parcel expected by a manifest or transfer but not scanned is missing; a parcel scanned but not expected is overage. Reconciliation closes each trip or transfer with every difference classed and resolved. [I; the terms follow N-OH §4 "Inbound manifest reconciliation"]

**2. Workflow.** Trip or transfer arrives → inbound scan (F-02) → system compares scanned set with manifest or transfer lines → exceptions listed (missing, overage, damaged) → staff resolve (found, forwarded, returned to origin, written off with approval) → close. States [I]: `open → reconciled` or `open → exception → resolved`. Each resolution is a row.

**3. Business rules and edge cases.** Stock write-off needs an approver other than the counter (W-16). Parcel liability: the driver liability entry exists for cash only (R-DM §3.11 "signed amount ... reason"; D-20); no rule attributes a lost parcel to a driver [I]. Claims and damage are proposed as DEL-27, wave 3 (N-FC §3). KSA: none in sources.

**4. Data.** `del_hub_exceptions` (`site_id`, `trip_id` or `transfer_id`, `order_id` or `package_id`, `kind ∈ {missing, overage, damaged}`, `status`, `resolution`, `resolved_by`, `approved_by`), resolution rows append-only [I]. Stock lines use `wms_adjustments` (R-DATA §2.3). Retention: as orders; proofs two years (R-DATA §10).

**5. Surfaces.** Exceptions list on the hub board (N-PC §4 "exception list" pattern, DEL-33 proposed). Scanner: none (F-02).

**6. Permissions, roles and audit.** Resolution by a hub supervisor; write-off of stock with approver ≠ requester (W-16 pattern) [I]. Audit rows.

**7. Dependencies and integrations.** F-02, F-03, F-05, F-06, DEL-27 (claims, proposed), DEL-21 (staff alerts, proposed; N-FC §3), DEL-7 (proofs).

**8. Metrics and reporting.** Missing-at-hub rate = missing exceptions ÷ parcels expected per period; overage rate; time to resolve; share of reconciliations closed the same day. [I]

**9. How the market builds it.** Fulfillor's COD gap classes: seven classes for courier settlements [S, N-FU INT-13 proposal, F14]. Shiprex: a single scan receives a whole manifest at the destination hub [weak, search summary, N-OH S24]; no discrepancy rule is stated. Shipsy and Omniful: no missing-parcel mechanism found in the pages read [I, absence in N-SH and N-OM]. Chosen shape (proposal): our own exception rows with a closed reason set and append-only resolutions. Reason: ADR-0007 liability is cash-only today; a goods liability rule is an owner ruling. Trade-off: without a liability rule, exceptions close without a money consequence.

**10. Roadmap mapping.** Missing. Split across HUB-2 (manifest reconciliation) and WMS-15 (stock variance). Owner: Q-H10 (who bears a lost or damaged parcel: driver, merchant or Eeasy; does ADR-0007 liability reach goods?).

### F-09 Hub KPIs (brief item 12)

Roadmap: partial. DEL-17 "SLA and scorecards" (wave 4) names no hub dimension (N-OH §4 row). `rpt_site_day` gives a site dimension (R-DATA §9).

**1. Definition and user goal.** A small set of hub measures read by the owner and hub supervisor: dwell, sort accuracy, missing-at-hub rate, trip utilisation, dock throughput, transfer lead time. [S, N-OH §4 "Hub and linehaul reports"; N-SH §2.2]

**2. Workflow.** Live values on the hub board; closed days stored nightly (R-DATA §9, `rpt_daily_kpis` filled 02:00 Asia/Riyadh). No user workflow beyond viewing. [S for the reporting rule]

**3. Business rules and edge cases.** Definitions are ours (F-02, F-04, F-07, F-08 formulas). Vendor targets (99% sort accuracy, 40% processing time) are unverified and not used [claim, N-SH §2.2]. A KPI that uses a closed day must read only closed data (R-DATA §9).

**4. Data.** A plain view `rpt_hub_day` per site and business date, `WITH (security_invoker = true)`, read by the reporting module only (R-DATA §9 rules). Projections are not ledgers and can be rebuilt [I]. Retention: as `rpt_daily_kpis`.

**5. Surfaces.** Owner dashboard tile (RPT-1, proposed, N-FC §3); DEL-17 scorecards (wave 4). No API.

**6. Permissions, roles and audit.** `delivery.cash.read`-style read for reports is the pattern; a hub report permission is [I]. Site scope applies through membership `site_ids` (R-WEB §4).

**7. Dependencies and integrations.** F-02, F-04, F-05, F-06, F-08 event sources; DEL-17; RPT-1 (proposed).

**8. Metrics and reporting.** The metrics named in item 8 of F-02, F-04, F-06, F-07 and F-08, each with its source table. Targets are not sourced; the owner sets them (Q-H11).

**9. How the market builds it.** Logestechs lists "hubs" among its report names [claim, N-LG §1.7 L10 F]. Shipsy's control tower monitors sorting and linehaul in real time [vendor, N-SH §2.2 A3]. Chosen shape (proposal): a read-only reporting view, not a module, following ADR-0026 and R-DATA §9. Reason: reporting is already defined as views. Trade-off: a view over several contexts reads more joins; the rule that dashboards join only through views stays intact.

**10. Roadmap mapping.** Partial (DEL-17). Amend DEL-17 with a hub dimension after HUB-1 to HUB-3. Owner: Q-H11 (which KPIs and targets).

## Feature index

| Feature (brief item) | Status | Order (proposed) | Wave | Owner question |
|---|---|---|---|---|
| F-01 Hub as a site kind (1) | Missing | HUB gate with ADR-0042 (this chapter) | Decision now; kind ships with wave 4 | Q-H1, Q-H2 |
| F-02 Parcel inscan and outscan (2); sort-by-destination and cages (3) | Missing | HUB-1 (inscan), HUB-3 (sort, cages) per N-FC | 4 | Q-H3 |
| F-03 Outbound and inbound manifests (4); load lists and handover to driver (5) | Missing; partial (W-14, DRV-4) | HUB-2 | 4 | Q-H4 |
| F-04 Hub-to-hub and branch-to-hub linehaul with capacity balancing (6) | Missing | HUB-2 | 4 or later | Q-H5, Q-H6 |
| F-05 Inter-site order transfer with arrival scan (7) | Missing | HUB-1 | 4 | Q-H7 |
| F-06 Inter-site stock transfer with approval and receipt (8) | Missing; partial (`transfer` reason) | WMS-15 (N-FC), P7 (N-WMS) | 3 if multi-site, else 4 | Q-H8, Q-U9 |
| F-07 Hub capacity and dock throughput (9) | Missing; partial (`dock`) | HUB-3 | Later | Q-H9 |
| F-08 Missing and overage at hub (10); transfer reconciliation (11) | Missing | HUB-2 (parcels), WMS-15 (stock) | 4 | Q-H10 |
| F-09 Hub KPIs (12) | Partial (DEL-17) | DEL-17 amendment; RPT-1 | 4 | Q-H11 |

## Unanswered

Owner questions. Each is for the owner, not the lead alone, and the scope ruling Q-H1 comes first.

- **Q-H1 Scope.** Is an own hub network in scope (transfers, manifests, linehaul, sorting), and in which wave? ADR-0002 names two modules and the roadmap has no row (N-FC §4 item 1; N-PC §5 item 3).
- **Q-H2 Kind or entity.** Add `hub` to the site kinds (superseding ADR-0018 K-4 and W-1), or a separate hub entity over a site (the split ADR-0018 rejected)?
- **Q-H3 Hub hardware.** A native offline handheld app for inscan, sort and handover, or a web scanner bench on rugged devices? ADR-0021 covers the driver app only (N-PC §5 item 1; N-SH §7 item 4).
- **Q-H4 Documents.** Does the pilot need a sealed manifest or end-of-day close (N-WMS Q-U13)?
- **Q-H5 Corridors.** Which corridors and frequencies does the pilot merchant run (Riyadh, Jeddah, Dammam or others)? How many sites (Q-31, N-WMS Q-U9)? No source gives distances or times.
- **Q-H6 Linehaul fleet and TGA.** Own vehicles and drivers only (ADR-0005)? What TGA permit does own-account intercity carriage need? The regulation text was not readable (W-F1, 403); W-S1 and W-S2 are secondary and unverified. Also RES-1 (N-PC §4).
- **Q-H7 Parcel transfer.** May a parcel change its dispatching site before delivery, and who pays for the transfer?
- **Q-H8 Stock transfer timing.** Wave 3 or wave 4 (N-WMS Q-U9, Q-31)?
- **Q-H9 Capacity.** Is a dock or departure limit needed for the pilot's volume? Evidence is one vendor page (N-OH §4).
- **Q-H10 Lost or damaged parcels.** Who bears the loss: driver, merchant or Eeasy? Does ADR-0007 liability apply to goods, or cash only?
- **Q-H11 KPIs.** Which hub KPIs and targets, and how is sort accuracy confirmed when a mis-sort is found late?
- **Q-H12 GCC cross-border.** Is GCC linehaul in scope before wave 4? If yes, customs, the country model and the three-decimal currencies of N-FC §2 item 1 come first; no source reads customs for hub flows.
- **Q-H13 Order identifier.** Which parcel identifier does a scan use: the order number `D-000123`, a new parcel barcode, or the WMS package id (`wms_packages`)? R-DM §3.1 has none.

Naming and register conflicts, for the lead to fix in the next amendment:

- `HUB` is not in the prefix list of roadmap §0 or handbook 04. The lead must add it with the ruling.
- N-SH numbers HUB-1 as hub kind and HUB-2 as trips; N-FC numbers HUB-1 as order transfer, HUB-2 as manifests and trips, HUB-3 as capacity and sort. This chapter uses N-FC's numbers.
- N-WMS calls the stock transfer P7 ("WMS-1a"); N-FC calls it WMS-15. This chapter uses WMS-15.
- Q-2 (R-RM §4) decides when stock leaves the books. A transfer's `transit` leg depends on it, so Q-2 must be settled before WMS-15.

## Source registry

All reads are dated 2026-11-02 unless marked.

Repo (`origin/main` at `6ca087e`):
- R-ADR18 `adr/0018-one-sites-concept.md` (accepted, 2026-10-31): kinds, context and alternatives.
- R-ADR05 `adr/0005-own-fleets-only.md`: own fleets, executor seam dormant.
- R-ADR02 `adr/0002-scope-last-mile-and-wms.md`: two modules.
- R-ADR21 `adr/0021-driver-app-inside-the-monorepo.md`: the driver app only.
- R-ADR11 `adr/0011-stock-as-double-entry-ledger.md`: movements and projections.
- R-ADR07 `adr/0007-driver-cash-custody-logestechs-model.md`: custody and liability (its Logestechs citation is itself open, N-LG §7 item 1).
- R-DM `docs/architecture/domain-model.md`: §2.2, §2.3 (site, K-4, K-5, K-7), §3.1, §3.3 (D-15), §3.5, §3.8, §3.11, §3.12, §3.13, §3.16 to §3.18 (D-3, D-5, D-12, D-13, D-18 to D-21, D-24), §4.1, §4.4, §4.5, §4.7, §4.8, §4.16 (W-1, W-5, W-6, W-8, W-13, W-14, W-16), §6.3, §7, §8.
- R-DATA `docs/architecture/data.md`: §2.1 (`core_sites`), §2.2 (`del_orders`, `del_coverage`), §2.3 (`wms_locations`, `wms_adjustments`, `wms_product_barcodes`), §9 (reporting views), §10 (retention).
- R-RM `docs/roadmap.md`: §0, §1.2 (DRV-4, DEL-6, DEL-10), §1.4 (WMS-1 to WMS-7), §1.5 (DEL-16, DEL-17, WMS-8), §2, §4 (Q-2, Q-31, Q-36), §6 (deferred; no hub item).
- R-CONTRACTS `docs/contracts/README.md`: role and permission table.
- R-WEB `docs/architecture/web.md`: sites screens (§8 screen inventory, WEB-3), site scoping (§4).
- AGENTS.md: hard rules (ledgers, tenancy, outbox, allowlist, own fleets) and the sizing rule.

Research (`origin/docs/feature-coverage`, `origin/docs/platform-teardowns`):
- N-FC `docs/research/feature-coverage-2026-11.md` (`origin/docs/feature-coverage`): §1, §2 item 1 and 5, §3 (HUB-1 to HUB-3, WMS-15, RPT-1, DEL-21, DEL-27), §4 items 1 and 2.
- N-OH `docs/research/features-orders-dispatch-hubs-2026-11.md` (`origin/docs/feature-coverage`): §4 hub table, §5 sources S1 to S33, §6 P7 to P9, §7 items 1 and 9.
- N-WMS `docs/research/features-wms-2026-11.md` (`origin/docs/feature-coverage`): Module 4 transfer row, P7, Q-U9, Q-U13, sources S1, S17.
- N-PC `docs/research/platform-comparison-2026-11.md` (`origin/docs/platform-teardowns`): §2 pattern table, §4 proposals (RES-1, DEL-33), §5 owner questions.
- N-SH `docs/research/teardown-shipsy-2026-11.md`: §1, §2.2 (hub table), §4.5, §5 mapping (rows 167 to 170), §6 items 1 and 2, §7, source A3 (`https://shipsy.ai/middle-mile-hub-operations`, fetched), A4 (`http://shipsy.io/solutions/courier-express-parcel/`), A5 (`https://knowledge.shipsy.ai/`, titles).
- N-LG `docs/research/teardown-logestechs-2026-11.md`: §1.2, §1.5 (cross-docking L7 F, line haul L11 claim), §1.7 (L10 Hubs report), §6 item 6, §7 item 1.
- N-AN `docs/research/teardown-anchanto-2026-11.md`: §2 (A2, A17), §5 row 4 and row 24, §6 item P2.
- N-OM `docs/research/teardown-omniful-2026-11.md`: §2.1 (multi-hub, O4 titles), §2.2 (O15 TMS listing), §4.1, §4.5 (O7 smart routing), §6 item 4 (STO).
- N-FU `docs/research/teardown-fulfillor-2026-11.md`: §2 (F6 changelog, Jan 2026; F16), §5 rows 2 and 3, §6 items A5 and A6 (INT-13 gap classes, WMS-10 transfer shipment).

Web (2026-11-02):
- W-S1 WebSearch, query "Saudi Transport General Authority freight transport licence intercity trucks own vehicles requirement Wasl", read 2026-11-02. Excerpts from the results (qanoniah.com regulation page, argaam.com, gccbusinessnews.com, arabnews.pk, and a consultancy guide at noblecoreksa.com). Secondary and unopened; the hire and own-account scope, the Saudi-truck rule and the TGA permit claim all come from these excerpts. No single URL was confirmed as the source of each claim.
- W-S2 WebSearch, query "Saudi TGA Tarweej logistics services licence last mile delivery company requirements 2026". Excerpts from zawya.com (`https://www.zawya.com/en/world/middle-east/saudi-tga-warns-of-penalizing-delivery-apps-that-ship-their-products-through-unlicensed-carriers-332227`) and noblecoreksa.com (`https://noblecoreksa.com/transport-delivery-company-saudi-arabia/`, consultancy guide, secondary). No Tarweej-specific requirement was found.
- W-F1 WebFetch of the Qanoniah regulation "Regulation Governing the Activity of Freight Transport, Freight Forwarders, and Truck Leasing on Land Roads 1439". HTTP 403; not read. Own-account and licensing articles remain unverified.

Limits. Vendor pages are marketing; enterprise APIs and hub screens are login-gated (N-SH §7 item 8, N-LG §7 item 2). No corridor distance, sort-accuracy figure or hub price appears in any source read.
