# Feature book 02: Zones, coverage, routing and dispatch

- **Date:** 2026-11-02. Repo baseline: `origin/main` at `1e0c184`, read 2026-11-02. Research branches read 2026-11-02 as listed in Sources.
- **Labels:** "Source" = the document states it. "Inferred" = my reading of stated facts. "Proposed" = a shape for the owner or lead to rule, not a decision. "Not sourced" = no source read settled it.
- **Status words:** Covered (merged) = the order is merged on main; Covered (planned) = a roadmap row exists (and a plan on main where one is listed), code not merged; Partial = some of the aspect is in a row; Missing = no row.
- **Source IDs** are defined in the Sources section (for example `DM 3.8` = `docs/architecture/domain-model.md` §3.8; `WA 2.1` = Wasal teardown §2.1).

## Summary for the lead

- Merged on main: zones, polygon coverage and the coverage check (DEL-1, 2026-11-02). Planned and not yet merged: offers, manual dispatch, shifts, board, streams, route stop sequence (DEL-6, DEL-5, WEB-7, INT-6).
- Not in any roadmap row: service levels with cutoffs, route templates, batching, ability matching, an assignment gap, offer escalation, an official boundary source. Each differs from today's roadmap and needs an order or an owner ruling.
- Preview-then-confirm sits in DEL-16 (wave 4). Wasal and Shipsy both place it in the auto-dispatch step [PC §2]. Proposed: amend DEL-10 (wave 2).
- Route optimisation (VROOM, rungs 1 to 3) and the Hudhud matrix with OSRM fallback follow ADR-0010. Both are deferred to the end of their waves (A-24). Q-18 (where the stop order lives) and Q-45 (OSRM or Valhalla) are open.
- Official district boundaries have no confirmed licensed polygon source (Hudhud note §3). DEL-1 ships drawn polygons only.
- Live transport is SSE with polling twins at 10 to 15 s (ADR-0009, ADR-0029). The dispatch and driver streams are planned in DEL-6.
- Geofences are used only for the driver's parked profile (ADR-0039). Arrival alerts or proof radius would be business side effects and must go through the outbox (ADR-0028).
- Not sourced: weekday and weekend rules, Ramadan hours, prayer-time pauses. Labour-hour and PDPL points below are secondary sources and need counsel.

## How to read the features

The ten aspects are numbered as the brief asks. Each feature ends with its own roadmap mapping (aspect 10). The index at the end gives the status, order, wave and owner question for each.

---

## Zones, coverage and eligibility

### F1 Zones and polygon boundaries

- **1 Definition and goal.** A named area (Arabic and English names) with a `MultiPolygon` boundary in EPSG:4326 that a site can cover. Goal: a merchant or dispatcher states where a site delivers, and the system answers from geometry, not from a list of districts [DM 3.4; DEL-1 plan 2.2].
- **2 Workflow.** Create zone (drawn, or source `official`) → validate (`ST_IsValid`, bounds, count limits) → store → edit names, boundary or `active` (`version + 1`) → deactivate (coverage rows kept, the check ignores the zone). No state machine; the only state is `active`. Actors: staff with `delivery.zones.manage`, and the platform provisioning door (`platformProvisionZone`) [DEL-1 plan 2.3, 2.6; OA staff-delivery `/zones`]. Exceptions: invalid ring → `400 validation_failed` with the `ST_IsValidReason` text; zone outside the box → `400` at `/body/boundary`; 201st zone → `422 limit_exceeded`.
- **3 Rules and edge cases.** Source: a boundary is at most 20 polygons and 10,000 positions in total; coordinates must sit in the box lat 16 to 33, lng 34 to 56 (Saudi Arabia); names 1 to 120 code points; at most 200 zones per account (a constant until `AccountLimits` gains a key) [DEL-1 plan 2.2; DATA del_zones]. Overlapping zones are allowed; the smallest covering zone by `ST_Area(boundary::geography)` answers [DEL-1 plan 2.5]. Inferred from the coordinates: the box is Saudi-only in intent and also cuts off the eastern edge of the UAE and Oman (lng above 56), so GCC use needs a box per country; whether GCC is in scope is FCN §4 Q2. No Ramadan or weekend rule applies to zones.
- **4 Data.** `del_zones`: `account_id`, `name_ar`, `name_en`, `boundary geometry(MultiPolygon,4326) NOT NULL`, `source ∈ {official, drawn}`, `active`, `version`; GiST on `boundary`; CHECK `ST_IsValid`; RLS on both lanes [DATA del_zones; DEL-1 plan 2.1]. Retention: none stated; zones are configuration and follow the account.
- **5 Surfaces.** Merchant web: `/zones`, `/zones/[zoneId]` with the polygon editor (WEB-6, planned) [WE 8; PW6 2.3, 2.4]. API: `listZones`, `createZone`, `getZone`, `updateZone` [OA]. Console: provisioning zone door [OA]. Driver app and recipient page: none.
- **6 Permissions and audit.** `delivery.zones.read` / `delivery.zones.manage`. Audit `delivery.zone.created` and `delivery.zone.updated` with changed keys; the boundary is recorded as polygon and position counts, never as geometry [DEL-1 plan 2.3, 2.7].
- **7 Dependencies.** PostGIS and GiST; the `delivery` feature gate (DEL-1 plan 2.9); PLAT-13 provisioning; WEB-6 editor and Map provider (Q-19).
- **8 Metrics.** None defined. Candidate: orders pending with `outside_coverage` per zone (DEL-2 reason; `del_orders.pending_reason`) [DATA del_orders]. Not specified in DM §7.
- **9 Market and our shape.** Bringg service areas, Tookan geofenced agent areas, Logestechs zone segmentation [FCD §3]; Wasal custom coloured zones on all tiers [WA 2.2]. Shape: **own**. Explicit polygons joined to sites by `del_coverage`, because ADR-0015 says coverage is explicit data, not inferred from zones. Borrow only the naming and editing UX of Wasal's zone page.
- **10 Roadmap mapping.** Covered (merged 2026-11-02, PR #132, migration `20261102125922_del_zones`) [RM]. WEB-6 editor: planned (plan exists, design references merged in PR #144). Official import: Missing (see F2). Zones are wave 1.

### F2 Official boundary imports

- **1 Definition and goal.** Load an official district or city polygon instead of drawing one, so coverage matches how addresses are named in KSA.
- **2 Workflow.** Source chosen and licence checked → seed script per city (`official boundaries are imported by a seed script per city`) [DATA line 418] or GeoJSON import in the editor (`Polygon`, `MultiPolygon` or `Feature`) [PW6 2.3] → zone saved with `source = official`.
- **3 Rules and edge cases.** Source: no open district dataset with a confirmed licence and admin-level 9 coverage for Riyadh or Jeddah was found. The OSM Saudi admin import covers regions and governorates only [HD §3, read 2026-11-02]. The MOMRAH-derived bilingual dataset (13 regions, 21,235 districts) has MIT code and an unstated data licence [HD §3, search excerpt]. A 2023 Riyadh Municipality boundary shapefile was seen in an academic table; licence not seen [HD §3]. SPL's Lookups API lists districts; its terms were not readable [HD §2.2]. Boundary rendering against Saudi requirements is unverified [WE 6.4; Q-19]. Inferred: a district list from SPL would give names and IDs, not polygons, unless the licence allows geometry.
- **4 Data.** `del_zones.source` only. No import-batch table is defined; the seed script's provenance (source name, licence, date) has no field [DEL-1 plan 2.8].
- **5 Surfaces.** Seed script (fixtures and per-city imports); WEB-6 GeoJSON import control (planned). No bulk-import operation exists in the OpenAPI.
- **6 Permissions and audit.** Editor import uses `delivery.zones.manage`; the seed runs outside the API. The audit row for an import would be `delivery.zone.created` with `source = official`.
- **7 Dependencies.** A source ruling (DEL-1 plan §7 Q1), a licence read, the boundary-rendering check (WE 6.4 open question 3).
- **8 Metrics.** None defined.
- **9 Market and our shape.** No teardown read describes official boundary import; regional products name zones but not their source [FCD §3; WA 2.2]. Shape: **own, deferred**. Drawn and GeoJSON-imported polygons ship first (DEL-1 default). The official import follows a licence check. Adapt: keep the editor's GeoJSON path as the only import route, so an official file and a drawn zone share one validation path.
- **10 Roadmap mapping.** Missing as an order. DEL-1 plan §7 Q1 has the question but roadmap §7 does not list it. Owner question C2-1.

### F3 Coverage per site and the coverage check

- **1 Definition and goal.** Which zones each site serves (`branch` or `both`), and a check that turns a point or address into a zone and the sites that cover it. Goal: no order is accepted for delivery where no owned site can serve it [DM 3.4; ADR-0015].
- **2 Workflow.** `replaceSiteCoverage` (full set per site) → `checkCoverage` (point wins over address; address goes through the Geocoder, short code first) → intake: no covering zone keeps the order `pending` with reason `outside_coverage` (D-3). The check is read-only and takes no `Idempotency-Key` [OA; DEL-1 plan 2.4, 2.5; DM D-3].
- **3 Rules and edge cases.** Source: only sites of kind `branch` or `both` (`422 site_kind_mismatch` for a warehouse) [DEL-1 plan 2.4]. `ST_Covers` treats a point on a boundary as covered [DATA; DM]. Deactivated zones are ignored. Geocode confidence below 0.6 means no reliable point: the order is accepted without a point and waits in "needs location" [IN 6.2]. National Address short codes match `^[A-Z]{4}[0-9]{4}$` and resolve first [DATA core_sites; IN 6.2]. Inferred: when two sites cover one point, the spec returns `site_ids` (a union) but names no rule for choosing the dispatching site; see C2-2.
- **4 Data.** `del_coverage`: `(account_id, site_id, zone_id)` unique, index `(account_id, zone_id)`, both RLS policies [DATA del_coverage]. Coverage rows are audited on replace (`delivery.coverage.replaced` with before and after zone ids) [DEL-1 plan 2.7].
- **5 Surfaces.** Zones page coverage panel (WEB-6). Order create and edit show the coverage result (WEB-5, planned). API: `listCoverage`, `replaceSiteCoverage`, `checkCoverage` [OA]. Driver app and recipient: none. Platform console: `platformProvisionCoverage` writes coverage as part of account provisioning [DEL-1 plan 2.6].
- **6 Permissions and audit.** `delivery.coverage.manage` to replace; `delivery.zones.read` to list; `delivery.orders.read` for the check. Replacement is audited with before and after sets.
- **7 Dependencies.** INT-2 Geocoder and short-code lookup (Hudhud agreement, Q-28); DEL-2 intake; WMS-7 pack bench via `CoverageQueryPort` [DEL-1 plan 2.5].
- **8 Metrics.** Orders per status, including `pending` (DM §7 lists orders per status). Coverage misses per zone are not defined.
- **9 Market and our shape.** Anchanto routes orders to warehouses by ordered first-match rules with a primary fallback [AN §2 multi-warehouse routing row, source A17]; Locus sets capacity per zone and window and Bringg attaches slots to service areas [FCD §3]. Shape: **own** for coverage (explicit rows, ADR-0015). Borrow the idea of an ordered site-choice rule for multi-site coverage, but only after the owner rules on it (C2-2). Reason: ADR-0015 rejects inference from zones.
- **10 Roadmap mapping.** Covered (merged, DEL-1). The intake consumer is DEL-2 (registered, in build). Multi-site choice: Missing.

### F4 Capacity counters

- **1 Definition and goal.** How many open orders a driver may hold (`CapacityCounter`) and how many parcels a vehicle carries. Goal: no driver is loaded past what the account allows, and the counter never drifts from the open assignments [DM 3.8; D-10].
- **2 Workflow.** Assignment created → counter +1 in the same transaction; assignment ended → −1; reassignment → old holder −1, new holder +1 (D-10). Offer acceptance or assign over the limit → `422 capacity_exceeded` [OA offerOrder, assignOrder].
- **3 Rules and edge cases.** Source: `CreateDriverRequest.capacity_limit` defaults to 30 (minimum 1) [OA]; `CapacityCounter.limit` [DM 3.8]; `del_capacity_counters.order_limit` with CHECK `0 ≤ active_orders ≤ order_limit` [DATA]; `del_vehicles.capacity_parcels ≥ 0` [DATA]. Inferred gap: three names for two numbers. The spec does not say whether the counter copies the driver's limit when a shift starts or when the limit changes; see C2-12. Vehicle parcel capacity appears only in the planner inputs (rung 2, "capacities") [IN 6.4]; no source says the assign door checks it.
- **4 Data.** `del_capacity_counters(driver_id PK, active_orders, order_limit)`; `del_assignments` is the source of truth; the counter is a projection of open assignments (D-10). Retention follows the assignments.
- **5 Surfaces.** Offer and assign responses (`422`); driver offer sheet shows "capacity" refusal text [DA §8.3]. Board load per driver: not specified in WEB-7.
- **6 Permissions and audit.** Changing a limit: `delivery.drivers.manage` (`updateDriver`), audited through the driver row. Counter changes are not separately audited; assignment rows are.
- **7 Dependencies.** DEL-4 driver and vehicle; DEL-5 shifts; DEL-6 assignments.
- **8 Metrics.** Refusals `capacity_exceeded` per hour (candidate). Not in DM §7.
- **9 Market and our shape.** Locus and OptimoRoute constrain load by vehicle capacity [FCD §3]; Shipsy balances load by capacity, destination and SLA [SH 2.2]. Wasal allows a per-driver `max_stops_override` and a per-depot `max_stops_per_route` [WA 2.1]. Shape: **own** counter (D-10), with the limit on the driver. Adapt Wasal's per-driver override only if the owner wants per-shift limits; that is an owner call (C2-12).
- **10 Roadmap mapping.** Driver limit: Covered (merged in DEL-4). Counter: Covered (planned, DEL-6). Balancing objective: Missing (FC §3 row 82; DEL-10).

### F5 Eligibility

- **1 Definition and goal.** The filter that decides which drivers may receive an offer or an assignment, applied before any offer, assignment or VROOM problem is built [IN 6.4 last paragraph].
- **2 Workflow.** Candidate drivers → filter: driver `active`; not cash-blocked; an `active` shift with a vehicle; the site covers the order's zone (D-12) → refusal with a typed code (`driver_not_eligible` with `details.reason`, `driver_cash_blocked`, `outside_coverage`) [OA; DEL-5 plan 2.4]. Cash block: a driver holding cash from a previous business day (Asia/Riyadh) is blocked until a supervisor clears it, with an audit row (D-11).
- **3 Rules and edge cases.** Source: shift-start reasons `driver_suspended`, `cash_blocked`, `vehicle_inactive`, `vehicle_unknown`, `shift_live`, `shift_not_planned`, `outside_window` (starts more than 60 minutes early or after `planned_end`) [DEL-5 plan 2.4]. Planned shift at most 16 hours and at most 14 days ahead; ad hoc shift 12 hours [DEL-5 plan 2.3, 2.4]. Q-26: shift start without background location is allowed with a warning to dispatch. Not sourced: weekday, Friday and Saturday rules, Ramadan hours. Secondary sources (not the Royal Decree text) say Saudi labour law sets 8 hours a day and 48 a week, and cuts Muslim employees' Ramadan day to 6 hours and week to 36 [W1]. A 16-hour planned shift needs counsel against those limits; the sources disagree on other job types.
- **4 Data.** `del_drivers.status`, `cash_blocked_at`; `del_driver_shifts.status`, vehicle `active`. Eligibility is computed, not stored.
- **5 Surfaces.** Refusal text on the dispatch board and the driver's offer sheet (DA §8.3). Board display of why a driver is not offered: not specified.
- **6 Permissions and audit.** Offers and assigns: `delivery.orders.dispatch`. Clearing a cash block: `delivery.drivers.clear_cash_block` with an audit row (WE §8 Cash rows; D-11).
- **7 Dependencies.** DEL-4, DEL-5, DEL-11 (cash block source), DRV-3 (location profile, Q-26).
- **8 Metrics.** Cash-blocked drivers (DM §7 lists it); offer acceptance latency (DM §7).
- **9 Market and our shape.** Safee assigns drivers only within a client account's driver groups, with a permission to manage groups [SF 2.3]. Bringg matches drivers on required abilities [FCD §3]. Shape: **adapt**. Site scope (ADR-0018) plus the D-11 and D-12 filters are the eligibility; a Safee-style driver group is a candidate (C2-8), not decided.
- **10 Roadmap mapping.** Partial: D-12 in DEL-6 (planned); shift reasons in DEL-5 (building); cash block in DEL-11 (wave 2). Driver groups and ability tags: Missing.

---

## Assignment, offers and auto-dispatch

### F6 Manual assignment, unassignment and transfer

- **1 Definition and goal.** A dispatcher sets or changes the driver of an order. "Transfer" here means an assignment change between drivers, not an inter-site transfer (that is a hub or WMS question) [DM 3.13; OA assignOrder].
- **2 Workflow.** `accepted → assigned` (assignOrder) → `assigned → accepted` (unassignOrder) → transfer while `assigned` or `picked_up` ends the old assignment (`end_reason = reassigned`) and opens a new one; the order status does not change [DM 3.13 note; OA]. Each write sends `If-Match` (`428 version_required`, `409 version_conflict`).
- **3 Rules and edge cases.** At most one open assignment per order (D-9); offers and assignments only to eligible drivers (D-12); a driver's own events are accepted for work completed before a reassignment (D-23, Q-1). After pickup the parcel is physically with the old driver until handover; no source says how a transfer after pickup is recorded (inferred gap; C2-13).
- **4 Data.** `del_assignments`: `order_id`, `driver_id`, `vehicle_id`, `shift_id`, `assigned_by`, `started_at`, `ended_at`, `end_reason ∈ {completed, reassigned, unassigned, returned}`, `version`; partial unique `(order_id) WHERE ended_at IS NULL` [DATA].
- **5 Surfaces.** Dispatch board drag-and-drop with a keyboard path (select card, choose driver in a combobox) [WE 6.3]; order detail (WEB-5). API: `assignOrder`, `unassignOrder`, `listAssignments`.
- **6 Permissions and audit.** `delivery.orders.dispatch`. Audit each assignment change with `assigned_by` and `end_reason`; the order's `OrderEvent` records the transition [DM 3.3].
- **7 Dependencies.** DEL-5 shifts; DEL-7 driver events; the `delivery.assignment.ended` event that the driver stream consumes [CR §12.3].
- **8 Metrics.** Manual reassignments per day (candidate; not in DM §7).
- **9 Market and our shape.** No market page read names manual assignment explicitly; Onfleet dispatches own and partner drivers from one platform and Tookan has an assignment help page [FCD §3, search summary]; Wasal supports manual assign and drag-and-drop re-optimise [WA 2.1]; Safee reassigns by ignition signal [SF 2.3], which we cannot do (no telematics, ADR-0039). Shape: **own**, from our D-9 and D-22 rules; the order status stays put during a transfer.
- **10 Roadmap mapping.** Covered (planned): DEL-6 (wave 1), WEB-7 (wave 1). DEL-6 has no plan file on main yet (roadmap row only).

### F7 Offers with expiry and first-acceptance-wins

- **1 Definition and goal.** A time-boxed invitation to one or more drivers for one order. The first accepted offer assigns the order; every other open offer is withdrawn [DM 3.14; D-13].
- **2 Workflow.** `offerOrder` (1 to 20 driver ids; `expires_in_s` 30 to 1800, default 120) → order `offered` → driver accepts (`driverAcceptOffer`), declines (`driverDeclineOffer`, optional reason), or lets it expire (system at `expires_at`) → if no sent offer remains, order returns to `accepted` (DM 3.13 `offered → accepted`). `withdrawOffer` by dispatcher [OA; DA §8.3].
- **3 Rules and edge cases.** D-13: one sent offer per driver per order; first accept under a row lock on the order; others `withdrawn` in the same transaction. Offer payload before acceptance is `OfferOrderView` only (no recipient name, phone or full address) [OA components]. Accept only while online (`409 offer_withdrawn`, `offer_expired`, `shift_not_active`, `capacity_exceeded`, `driver_cash_blocked`, `driver_not_assignee`) [DA §8.3]. Offline: offers expire and are not accepted (DA §8.2). Gap: no rule says what happens after the last wave expires beyond returning to `accepted`; FCD §3 flags this as missing escalation.
- **4 Data.** `del_offers`: `order_id`, `driver_id`, `status`, `sent_at`, `expires_at`, `responded_at`, `wave`, `version`; partial unique `(order_id, driver_id) WHERE status = 'sent'`; scan index on `expires_at` [DATA].
- **5 Surfaces.** Driver app offer sheet with countdown, sound and haptic; push on channel `offers` (high importance) [DA §8.1–8.2]; SSE `delivery.order.offered` [CR §6]; dispatch board shows offers (`listOrderOffers`).
- **6 Permissions and audit.** Offer and withdraw: `delivery.orders.dispatch`; accept and decline: the driver's token. Audit of offer creation is not specified (C2-4).
- **7 Dependencies.** PushSender (`push` outbox kind, expired offers dropped) [IN 2.5, 4.1]; SSE and polling twins (F19); DRV-4 and DRV-5 (planned).
- **8 Metrics.** Offer acceptance latency (DM §7); decline and expiry counts per wave (candidate).
- **9 Market and our shape.** Bringg sends to the closest driver with timeouts and auto-cancel when nobody accepts [FCD §3, developer doc summary]; Tookan sends one request per cycle [FCD §3, search summary]. Shape: **own**. The market reads do not describe a first-accept lock; keep D-13. The 120-second default is a starting point, not a market figure.
- **10 Roadmap mapping.** Covered (planned): DEL-6 (wave 1), DRV-4, DRV-5. Escalation after the last wave: Missing (C2-4).

### F8 Auto-dispatch waves and the assignment gap

- **1 Definition and goal.** Rule-created offers sent in rounds (`wave`) to eligible drivers, without a dispatcher. The assignment gap is a minimum time between consecutive assignments to different drivers, so one order does not flap between drivers [DM 3.8, 3.13; SF 2.3; PC §4].
- **2 Workflow.** Order `accepted` → system `accepted → offered` (wave 1) → expiry → next wave → when all waves expire, order back to `accepted`. Assignment gap (proposed): before a new offer or assignment to another driver, wait for the gap to pass since the last assignment on the order.
- **3 Rules and edge cases.** Source: rule-created offers go only to eligible drivers (D-12, D-13); `wave` field exists [DM 3.8]; the roadmap row says "offers created by rule within D-12 and D-13" [RM DEL-10]. Not in any source: wave size, ordering of candidates, number of waves, the gap rule itself. Safee's gap is a per-company setting with default 60 seconds, dated 2026-08-27 in its release notes and tied to its telematics [SF 2.3, source S14]. Our trigger would be an offer, not a device signal (ADR-0039).
- **4 Data.** `del_offers.wave smallint`. The gap needs a setting; no account-setting key exists yet (`AccountSettings` not extended in any plan read).
- **5 Surfaces.** Board shows the wave and time left (candidate); driver offer sheet unchanged; escalation alerts through DEL-21 (proposed).
- **6 Permissions and audit.** The system is the actor for rule-created offers. Account setting: `core.account.manage`. Audit row per rule run: not specified (C2-4).
- **7 Dependencies.** DEL-9 slot windows (for time-based waves); INT-6 matrix for nearest-first ordering (not defined); DEL-5 shifts; F5 eligibility.
- **8 Metrics.** Offer acceptance latency; orders that exhaust all waves (candidate); assignment changes within the gap (candidate, to show flapping).
- **9 Market and our shape.** Wasal distributes stops by area and priority [WA 2.1]; Shipsy uses rule and ML allocation with 3PL allocation by cost, speed and rating [SH 2.1]; Safee's gap [SF 2.3]; Omniful names dispatch but not its assignment logic [OM 2.3]. Shape: **adapt**. Rule-based waves inside D-12 and D-13; the gap as an account setting with Safee's 60 seconds as the starting value; no ML (no data, SH 5).
- **10 Roadmap mapping.** Partial: DEL-10 (wave 2) has rule offers but no gap, wave policy or escalation. Owner questions C2-4 and C2-5.

### F9 Preview, then confirm

- **1 Definition and goal.** An auto-dispatch or planner run computes proposed assignments and ETAs, shows them, and writes nothing until a person confirms. Commit goes through the offer path, not direct assignment [IN 6.4 rung 2; ADR-0010].
- **2 Workflow.** Simulate (no write) → review (unassigned jobs with the solver's reason) → commit → offers created through D-12 and D-13 → driver accepts or declines (F7).
- **3 Rules and edge cases.** Source: "simulate" shows routes without writing; "commit" creates offers, never assignments [IN 6.4]. Ineligible drivers are removed before the problem is built [IN 6.4]. Inferred: a preview is a snapshot, so commit must re-check versions and eligibility (no source names the mechanism).
- **4 Data.** Nothing persisted by simulate (source). Whether a preview is kept for audit is not specified.
- **5 Surfaces.** Planner screen (WEB-18, wave 4). Auto-dispatch preview on the board: not in the roadmap (proposed DEL-10 amendment).
- **6 Permissions and audit.** `delivery.orders.dispatch`; commit audited as offers. No separate permission is named.
- **7 Dependencies.** INT-6 (rung 1 matrix and VROOM), DEL-16, DEL-10.
- **8 Metrics.** Preview-to-commit ratio and changed-after-preview count (candidates).
- **9 Market and our shape.** Wasal: select drivers, preview, confirm [WA 2.1, 5]; Shipsy shows preview then commit as a pattern [PC §2]. Our ADR-0010 names "simulate, optimise, create, assign" as the UX to copy from OTO [PC; ADR-0010]. Shape: **borrow**, and move it into DEL-10 (wave 2) as an amendment, so auto-dispatch does not ship without a preview.
- **10 Roadmap mapping.** Partial: DEL-16 (wave 4) has simulate and commit. DEL-10 (wave 2) has none. Proposed amendment (owner, C2-5).

### F10 Time slots and slot days

- **1 Definition and goal.** Delivery windows per site, zone and date, each with a capacity. A recipient or staff member books one at acceptance or reschedule [DM 3.9].
- **2 Workflow.** `SlotDay` open or closed for `(site, zone, date)` → `Slot` windows with capacity → order books at acceptance (`slot_id` optional) → reschedule through a 48-hour recipient token (DEL-14) → full slot refuses with `409 slot_full` on update [DM 3.9; OA updateSlot; RM DEL-14].
- **3 Rules and edge cases.** Source: `booked ≤ capacity`, `ends_at > starts_at` [DATA del_slots]; business dates are `YYYY-MM-DD` in Asia/Riyadh [CR §3]. No weekday rule, holiday calendar, Ramadan schedule or prayer-time pause appears in any source read. Not sourced: whether a service day is a Friday or Saturday. Slot days are created one by one; there is no recurrence or template table (DATA; OA `createSlotDay`).
- **4 Data.** `del_slot_days` unique `(account_id, site_id, zone_id, date)` with `open`; `del_slots(slot_day_id, starts_at, ends_at, capacity, booked)` [DATA].
- **5 Surfaces.** `/slots` (WEB-9, wave 2); reschedule page `/reschedule/[token]` and address pin `/pin/[token]` (wave 2) [WE §8]; the driver offer view carries the window (`OfferOrderView.window`) [OA]. Notification `order_rescheduled` (INT-7).
- **6 Permissions and audit.** `delivery.slots.manage` to write; `delivery.orders.read` to read. Audit of slot edits: not specified.
- **7 Dependencies.** DEL-2 intake; DEL-14; INT-6 (time windows from booked slot in rung 1) [IN 6.4]; INT-7 messages.
- **8 Metrics.** Booked over capacity (should be zero by CHECK); fill rate per window and reschedules (candidates).
- **9 Market and our shape.** Locus closes a window when its order limit is reached and sets capacity per zone [FCD §3, S17]; Bringg sets slots per date and service area with a route cap [FCD §3, S15]; DispatchTrack offers feasible windows by zip or zone [FCD §3, S21]. Shape: **own** (DM 3.9). Borrow Locus-style closure as a later step; capacity that follows live driver hours is missing and is an owner decision.
- **10 Roadmap mapping.** Partial: DEL-9 (wave 2, not started), DEL-14 (wave 2). Live capacity: Missing (FC §3 row 71).

### F11 Service levels and cutoffs

- **1 Definition and goal.** A named service per site (for example same-day or next-day) with a cutoff time, SLA days, service days and availability. An order accepted after the cutoff rolls to the next service day [WA 2.2].
- **2 Workflow.** Service configured per site → order takes a service at intake → cutoff tested at acceptance → rolled to next available service day → SLA clock → SLA reports [WA 2.2, 5 row "Service offerings"].
- **3 Rules and edge cases.** Wasal: price per stop, SLA days, cutoff, service days, per-depot availability, and a stop-type limit by tier; items past cutoff move to the next available day [WA 2.2]. Price is not ours until Q-33 is ruled. KSA: no source gives a service-day calendar, weekend rule or Ramadan cutoff change (not sourced). No product read names prayer-time pauses (not searched).
- **4 Data.** No entity exists in DM §3 or in DATA. Any service record needs a domain-model change.
- **5 Surfaces.** None in the OpenAPI (`staff-delivery.yaml` has no service operation; checked 2026-11-02).
- **6 Permissions and audit.** Not defined.
- **7 Dependencies.** DEL-2 intake; DEL-9 slots (overlap with cutoffs); DEL-17 reports; Q-33 (pricing and limits).
- **8 Metrics.** SLA met per service and cutoff misses (candidates). DEL-17 is wave 4 with Q-32 open [RM; Q-32].
- **9 Market and our shape.** Wasal is the only read with a service record that carries cutoffs [WA 2.2]; Locus names "service levels" among its constraints [FCD §3]. Shape: **adapt**, as a site-level record that sits beside slots rather than replacing them. This needs a domain-model change and probably an ADR, because it adds an aggregate to DM §3. No order owns it yet.
- **10 Roadmap mapping.** Missing. Proposed as DEL-32 in the platform comparison [PC §4] and as DEL-19 in the Wasal teardown [WA §6 item 5]; the two ids clash with feature-coverage (see ID clashes). Owner question C2-3.

---

## Routing and route planning

### F12 Route optimisation, rung 1: driver stop sequence and ETA

- **1 Definition and goal.** For one driver's run, the stop order and a per-stop ETA, from VROOM over a custom distance matrix. Goal: the driver app shows a sequence the driver can follow, with an explicit "optimised" or "fallback" marker [IN 2.3, 6.4; ADR-0010].
- **2 Workflow.** Run on an active shift → problem built: one vehicle (the driver's run), start at the driver's last ping or the site, end open, shift window as time window, capacity in parcels; one job per stop point (orders at one point grouped), service time 180 s by default, time window from the booked slot [IN 6.4] → matrix (F14) → VROOM with a 10 s timeout → ordered stops and ETAs → driver run list in server sequence (DRV-7, wave 2). On timeout or error the nearest-neighbour answer is used and marked `solver = fallback` [IN 2.3].
- **3 Rules and edge cases.** Source: a custom matrix needs `start_index` (not `start`), and `end_index` is omitted for an open route; confirmed 2026-10-31 [IN 6.4; PF §10]. Unassigned jobs come back with the solver's reason; ineligible drivers never reach the problem (F5). Q-18 is open: where the stop order is stored is left to the INT-6 order as an additive change to the domain model and the contracts [RM Q-18; CR §12.4]. No stop-order column exists in DM §3.1. Not sourced: Ramadan or prayer-time effects on service time.
- **4 Data.** Stop order and ETA: no column or table yet (Q-18). Matrix cache: F14.
- **5 Surfaces.** Driver run list (DRV-7 row: run list in server sequence, wave 2). Dispatcher sees the sequence on the board only if WEB-7 adds it (not specified). No staff or driver operation in OpenAPI returns a sequence (checked 2026-11-02).
- **6 Permissions and audit.** Not defined; solver output is read-only (IN 2.3 "sync, read-only").
- **7 Dependencies.** INT-5 matrix; DEL-6 runs; DEL-9 windows; Q-18; Q-45 (engine choice for matrices).
- **8 Metrics.** Share of runs with `solver = fallback`; ETA error against actual arrival (candidate; not in DM §7).
- **9 Market and our shape.** Every product read claims route optimisation [FCD §3]. Wasal offers goals (minimise distance, minimise time, respect time windows), an optimised flag and an ETA per stop [WA 2.1]. Safee claims route logic without naming an algorithm [SF 2.4]. Shape: **own**, per ADR-0010: VROOM with a fallback. Borrow Wasal's goal parameter only as a question: VROOM's objective options were not read in this chapter's sources (C2-6).
- **10 Roadmap mapping.** Covered (planned): INT-6 (wave 2, deferred to the end of the wave, A-24). Q-18 open (owner). The roadmap row omits time windows, which integrations §6.4 includes (a row-to-doc gap).

### F13 Route optimisation, rungs 2 and 3: planner and automation

- **1 Definition and goal.** Rung 2 is a dispatcher planner across every eligible driver on shift, with simulate and commit. Rung 3 re-solves on triggers and sends the result through offers [IN 6.4; ADR-0010].
- **2 Workflow.** Rung 2: select site and date → all eligible drivers (D-12), skills from vehicle kind, capacities; all accepted unassigned orders as jobs; pickup-and-delivery pairs for `pickup_request` and `return_pickup` as shipments; priority for late slots → simulate (no write) → commit creates offers (D-12, D-13). Rung 3: worker job with a 60 s budget, triggered by new order, offer declined or shift start; departure-time matrix if available; results through offers [IN 6.4].
- **3 Rules and edge cases.** Source: plan timeout 30 s for rung 2 [IN 2.3]; rung 3 runs in a worker with 60 s. No source gives solver throughput at 50 to 300 stops; a benchmark on our data is needed [GEO, Unanswered 1]. Valhalla documents time-dependent matrices, which rung 3 might need; the choice is open (Q-45, benchmark before route optimisation). OSRM traffic is static preprocessing, not live [GEO §2]. Hudhud traffic-aware departure is "to confirm" [IN 6.3].
- **4 Data.** None defined for planner runs. A stored plan or run id is not specified.
- **5 Surfaces.** Planner screen WEB-18 (wave 4), with "simulate" and "commit".
- **6 Permissions and audit.** Assumed `delivery.orders.dispatch`; not stated in the contracts (no planner operation in OpenAPI).
- **7 Dependencies.** INT-6; DEL-10; DEL-16; Q-45; the shipment support in VROOM [GEO §1].
- **8 Metrics.** Unassigned share, solver time, commit rate (candidates).
- **9 Market and our shape.** OTO's simulate, optimise, create, assign flow is the UX ADR-0010 copies, not its engine [ADR-0010]. OptimoRoute and FarEye re-plan on change [FCD §3]. Shipsy's AI trip creation is not borrowed (no data, SH 5). Shape: **own engine (VROOM), borrowed UX**.
- **10 Roadmap mapping.** Missing until wave 4: DEL-16 and WEB-18. Pull-forward is an owner decision (F15, C2-6).

### F14 Distance matrix, ETA and the OSRM fallback

- **1 Definition and goal.** Travel time and distance between points. It feeds rung 1 and rung 2, and the ETA on the tracking page [IN 2.1; DM D-24].
- **2 Workflow.** `matrix(points, profile 'car', departAt?)` (sync, read-only, timeout 5 s for up to 100 × 100; larger problems tiled) → only missing pairs requested from cache → adapters in order: Hudhud, then OSRM container (wave 2), then straight-line × 1.35 at 25 km/h (in-process) → result labelled `source` → sequencing screen shows "approximate" when straight-line [IN 2.1]. ETA for the tracking page uses `route` in wave 1 with straight-line allowed [IN 2.1].
- **3 Rules and edge cases.** Source: Hudhud confirmed to offer a distance matrix; wire format not stated [PF §8]. Hudhud gives no caching, storage or retention statement [HD §1.6]. OSRM Saudi data: only the Geofabrik GCC extract is listed; Saudi coverage unconfirmed [PF §11]. VROOM is fed the matrix as durations and distances per profile [PF §10]. Cache: Redis key `mx:{account}:{site}:{date}:{geohash8}:{geohash8}` expiring at end of business day [IN 2.1]; but `del_distance_matrix_cache` in Postgres with a 7-day delete [DATA line 420]. Two cache designs; reconcile.
- **4 Data.** `del_distance_matrix_cache(site_id, business_date, provider ∈ {hudhud, osrm}, points_hash, n, durations_s[], distances_m[])` unique per point list [DATA].
- **5 Surfaces.** Tracking ETA (`eta` in `PublicTrackingView`, nullable) [OA components]; planner and sequence "approximate" label (WEB-18, DA ETA label not specified). No driver-facing matrix.
- **6 Permissions and audit.** None (read-only). Per-adapter breaker state is the observable.
- **7 Dependencies.** INT-2 (Hudhud key; Q-28, signer and quota unknown); PLAT-2 containers for VROOM and OSRM; INT-5.
- **8 Metrics.** Calls per 1,000 orders (IN 6.6 estimate: about 80,000 matrix elements per 1,000 orders); cache hit rate; share of answers from each source (candidates).
- **9 Market and our shape.** Hudhud is the first adapter, OSRM the fallback, per ADR-0010 and the owner ruling of 2026-09-20. Valhalla and GraphHopper are named as alternatives in the research and need an ADR to add [GEO §2; GEO, Mapping to the ADRs]. Wasal claims "real-world traffic" without a source [WA 2.1]. Shape: **own, per ADR-0010**.
- **10 Roadmap mapping.** INT-5 (wave 2, end of wave, A-24): Missing in code. ETA in wave 1 uses straight-line; owner question on the wave 1 ETA (C2-15). Q-28 and Q-45 open.

### F15 Re-solve on change

- **1 Definition and goal.** Recompute stop order or the plan when an order changes, a driver goes off shift, or a stop is added. Goal: the run the driver sees matches the state of the day [IN 6.4 rung 3; FCD §3].
- **2 Workflow.** Trigger (new order, offer declined, shift start, cancellation, stop change) → re-solve (rung 1 per run; rung 3 across the site) → new sequence → driver app banner when the current stop is affected, and the run refetched [DA §8.2; IN 6.4]. Rung 1 costs only the new stop's row and column in the cache [IN 6.3].
- **3 Rules and edge cases.** Source: rung 3 results "still go through offers" [IN 6.4]; a driver's accepted run is changed only by an assignment or an unassignment. Not sourced: a re-solve on a run already in progress (picked-up stops) and whether it may move a stop already out for delivery. Shipsy's driver re-optimisation prompt is "next release", not shipped [SH 2.1].
- **4 Data.** None beyond F14 cache and Q-18.
- **5 Surfaces.** Driver app banner and run refetch; board (not specified).
- **6 Permissions and audit.** System actor; an offer created by re-solve is audited as an offer (F7).
- **7 Dependencies.** INT-6, DEL-10, DEL-16; D-12 filters.
- **8 Metrics.** Re-solves per run per day; sequence changes per run (candidates).
- **9 Market and our shape.** FarEye and Locus re-plan in real time [FCD §3, S16, S17]; OptimoRoute changes depot mid-route [FCD §3]. Shape: **own** (rung 3 with offers). The pull-forward from wave 4 to wave 2 is an owner decision (feature-coverage §7 Q7).
- **10 Roadmap mapping.** Partial: DEL-16 (wave 4). Proposed pull-forward after INT-6 (FC §3 DEL-25 and P6). Owner question C2-6.

### F16 Batching and vehicle or ability matching

- **1 Definition and goal.** Batching: several nearby orders in one run, handled as one unit. Matching: restricting offers and runs by vehicle kind, skill or ability tag (for example a van for a large item) [FCD §3; IN 6.4].
- **2 Workflow.** Batching (proposed): rule groups eligible orders by zone or point → a batch is offered or assigned as a run → capacity applies per order (D-10). Matching: vehicle kind (`car`, `van`, `motorbike`) and VROOM `skills` filter candidates before the problem is built (F5). Ability tags on order and driver are not in any source.
- **3 Rules and edge cases.** Source: vehicle kind is an enum on `del_vehicles` [DATA]; VROOM skills use vehicle kind at rung 2 [IN 6.4]. Tookan pools up to two orders or four tasks per driver [FCD §3, search summary]. No source gives a batch objective (fewest drivers, fair spread or shortest distance; FC §7 Q11). Large-item rules: not sourced.
- **4 Data.** `del_vehicles.kind` only. A batch id, an ability tag set and a skill list are not defined.
- **5 Surfaces.** Order create (tags are a proposal: DEL-31 in PC §4); offer sheet shows the required vehicle kind (not specified).
- **6 Permissions and audit.** Tags: `delivery.drivers.manage` for driver tags; no permission for order tags is defined (C2-8).
- **7 Dependencies.** DEL-4, DEL-10, INT-6 skills; F4 counters.
- **8 Metrics.** Batch size distribution; no-match rate; orders refused for lack of skill (candidates).
- **9 Market and our shape.** Bringg matches drivers on abilities and groups orders into batches for nearby stops [FCD §3]; OptimoRoute matches skills and vehicles [FCD §3]; Safee scopes drivers to client groups [SF 2.3]. Shape: **adapt**. Vehicle kind and VROOM skills now (ADR-0010); ability tags and batching as one proposed order with the objective as an owner decision (C2-8).
- **10 Roadmap mapping.** Partial: vehicle kind (DEL-4, merged). Missing: batching and ability tags. Proposed DEL-24 (FC §3, wave 2, after DEL-10 and DEL-4) is not in the roadmap.

### F17 Route templates and route copy

- **1 Definition and goal.** Save a route's settings and stops as a template, create a new route from it, and copy a route to a new date [WA 2.1].
- **2 Workflow.** Route built and saved as template → new route pre-filled → stops copied with account and site scope; no proof or status carries over [WA §6 item 6]. Copy endpoint `POST /route-groups/copy` [WA 2.1].
- **3 Rules and edge cases.** Source: Wasal stores templates and routes as first-class objects with names and dates [WA 2.1, 3.3]. Our unit is the order with an assignment and a driver's run; there is no route entity in DM §3 or DATA. A template therefore needs either a run entity or a saved filter of orders. Not sourced: whether templates hold addresses (personal data) and their retention.
- **4 Data.** None defined.
- **5 Surfaces.** None in the OpenAPI. Would sit on the board and the orders list.
- **6 Permissions and audit.** Not defined.
- **7 Dependencies.** DEL-6, DEL-9 (slot windows), F13 and F16.
- **8 Metrics.** Template reuse count (candidate).
- **9 Market and our shape.** Wasal has templates and a copy endpoint [WA 2.1, 5]. Shape: **undecided**. Adapt only if the owner wants a route entity; the platform comparison proposes DEL-32 for route templates [PC §4] and Wasal proposes DEL-20 [WA §6 item 6]; see ID clashes.
- **10 Roadmap mapping.** Missing. Owner question C2-7.

---

## Live dispatch and field location

### F18 Dispatch board and map

- **1 Definition and goal.** The live staff screen: order lanes by status, driver cards, positions on a map, and the actions to offer, assign, unassign and transition orders [WE 6.3, 8].
- **2 Workflow.** Load (`listOrders`, `listAssignments`, `listOrderOffers`, `listLatestDriverPositions`, `listShifts`) → stream patches applied by aggregate id and `sequence` (F19) → an action updates optimistically and sends `If-Match` → `409` rolls back, shows `ConflictNotice` and refetches; the UI never retries a conflicted write by itself [WE 7.3, 7.4].
- **3 Rules and edge cases.** Lanes by status; cards keyed by order id; a keyboard path is required because drag alone fails accessibility [WE 6.3]. The map never computes coverage; `checkCoverage` does [WE 6.4]. Numbers are Latin; the map does not mirror in RTL, panels do [WE 5; PW6 2.8]. Tiles: Hudhud or self-hosted Protomaps, open (Q-19) [RM Q-19].
- **4 Data.** None new; reads of orders, assignments, offers and positions (Redis latest point, 10-minute TTL) [DM §7; OA DriverPosition].
- **5 Surfaces.** `/dispatch` (WEB-7, wave 1). Live toggle on `/drivers` polling every 15 s (WEB-6, before the stream exists) [PW6 2.5].
- **6 Permissions and audit.** View: `delivery.orders.read`, `delivery.locations.read`. Act: `delivery.orders.dispatch`, `delivery.shifts.manage` [WE §8]. Actions audited through the writes they make (F6, F7).
- **7 Dependencies.** WEB-6 map (MapLibre, ADR-0033 as cited in WE 6.4); DEL-6 writes; F19 streams.
- **8 Metrics.** Age of last update shown on the card ("updated X seconds ago", `UpdatedAgo`) [WE 6.3]; conflicts per day (candidate).
- **9 Market and our shape.** Onfleet tracks each delivery in real time [FCD §3]; Wasal shows drivers on a live map and re-optimises after a drag [WA 2.1, 2.3]; Safee shows vehicles second by second [SF 2.1]; Shipsy's control tower is a separate product surface [SH 2.6]. Shape: **own** (WE 6.3 and 6.4). An exceptions queue is missing in every row; the market shape is Wasal's "exceptions" list and is borrowed as DEL-33 (PC §4), owner to rule.
- **10 Roadmap mapping.** Covered (planned): WEB-7 (wave 1), WEB-6 (wave 1). Exceptions queue: Missing (DEL-33 proposed; DEL-21 alerts proposed in FCN §3).

### F19 SSE streams and polling twins

- **1 Definition and goal.** Server-sent event streams that push domain events and driver positions to the dispatch board, the driver app and the recipient page, with a REST twin for each for polling [CR §6; ADR-0009; ADR-0029].
- **2 Workflow.** Connect with `Last-Event-ID` → events applied in order → buffer lost or a long gap: one `stream.resync`, then REST refetch → three failed reconnects: web switches its queries to 12 s polling and retries the stream every 60 s; the driver app polls every 15 s and retries every 2 min [WE 7.1, 7.2; DA §8.1].
- **3 Rules and edge cases.** 15-minute replay buffer; `retry: 5000`; keep-alive comment every 20 s; web closes the stream after 60 s hidden and treats 45 s of silence as dead [WE 7.1; CR §6]. Positions carry no `id` and never touch the order cache or the stored last id (ADR-0028; WE 7.1). A stream ends when its credential expires, the member or device is revoked, or the account is suspended [CR §6]. Recipient stream: purpose `track` only, reduced envelope, token as a header on web (the query-string form exists on the wire) [CR §6; WE 7.1]. Polling interval 10 to 15 s (ADR-0009).
- **4 Data.** Redis pub/sub channel per account; 15-minute replay buffer in Redis (ADR-0029); latest position per driver in Redis, 10-minute TTL; Postgres ring of 240 points per driver, one hour at 15 s (ADR-0028). Production Redis or Valkey is OPS-1's choice under Q-42 and A-24 [RM A-24, Q-42].
- **5 Surfaces.** `streamDispatch` (board, shift events) [OA]; driver stream `/v1/driver/stream` (offers, assignments, cancellations) [CR §6]; recipient stream `/v1/recipient/tracking/stream` [CR §6]. REST twins: `listLatestDriverPositions`, `listOrders?updated_from`, `driverListOffers`, `driverListRun`, `recipientGetTracking` [CR §6].
- **6 Permissions and audit.** Dispatch stream filtered to the member's `site_ids`; driver stream by the token's driver; recipient stream by the token [CR §6]. Stream access is not separately audited.
- **7 Dependencies.** Redis; API process statelessness (ADR-0009); reverse proxies that buffer SSE force polling (WE 7.2).
- **8 Metrics.** Reconnects, resync count, share of time on polling (candidates). DM §7 lists offer latency and ping lag but not stream health.
- **9 Market and our shape.** The market reads do not describe their push transport (not sourced). ADR-0009 records that no reference product updates driver positions faster than every several seconds. Shape: **own**: SSE with polling twins, no WebSocket gateway in waves 0 to 3 (ADR-0009).
- **10 Roadmap mapping.** Covered (planned): DEL-6 (streams with replay and polling twins, wave 1), WEB-7. Driver app consumer: DRV-4 (planned).

### F20 Geofences

- **1 Definition and goal.** A region whose entry or exit changes something. Three uses are in play: (a) the driver's parked geofence that switches the tracker to a low-power profile (planned in DRV-3 per ADR-0039); (b) zone polygons for coverage, which are not events (F1); (c) arrival warnings and proof-radius checks (proposed only) [ADR-0039; FCD §3 DEL-26; SH 2.1].
- **2 Workflow.** (a) Driver arrives at a stop (own event) or stays within 30 m for 3 minutes → one geofence of about 150 m is registered → exit or departure → back to `moving`; on iOS an exit also restarts a killed app [DA §6.2; ADR-0039]. (c) Proposed: advisory arrival warning outside the point's geofence; Shipsy-style "within N metres of the consignee pin" before Deliver is enabled [FCD §3; SH 2.1].
- **3 Rules and edge cases.** Google Play removes geofencing as an approved foreground-service use case from 2027-01-27; our geofence uses the Geofencing API and an FGS of type `location` from shift start to end, so Q-41 records us as unaffected. Whether the geofence-transition start exemption survives is unresolved [PLP §1; RM Q-41]. Any alert derived from positions is a business decision and writes an outbox row (ADR-0028 consequences). Privacy: secondary law-firm summaries say the 2023 amendment removed location from sensitive data and that legitimate interest needs a documented balancing test; not verified against the statute [W2]. No geofence table in DATA.
- **4 Data.** Parked geofence is device state only. Arrival alerts would add an outbox row and a domain event; no table is defined.
- **5 Surfaces.** Driver app in the background (DRV-3). Proposed: arrival warning on the driver's run card and on the recipient tracking view (not specified).
- **6 Permissions and audit.** Driver consent through the permission screens (DRV-3; DA §6.3). No staff permission. Any arrival alert would be audited as a delivery event.
- **7 Dependencies.** ADR-0039; DRV-3; Google Geofencing API and iOS region monitoring (ADR-0039); the outbox (ADR-0024 as cited by ADR-0028).
- **8 Metrics.** Parked and moving time share; battery use against the 4 % per hour budget (Q-39) [RM Q-39]; geofence exits and arrival warnings per run (candidates).
- **9 Market and our shape.** Tookan geofences agent areas [FCD §3]; Safee sends entry and exit alerts [SF 2.1]; Shipsy checks proof within N metres [SH 2.1]; Wasal offers geofencing on its top tier only [WA 4.2]. Shape: **own** for the parked geofence (ADR-0039). Arrival warnings and proof radius: **proposed**, adapted from Shipsy's advisory check, pending C2-11 (privacy review).
- **10 Roadmap mapping.** Covered (planned): parked geofence in DRV-3 (wave 1). Partial: arrival warning proposed as DEL-26 (wave 2, FCD §3). Missing: proof radius (proposed DRV-4 amendment, SH §6 item 3).

---

## Feature index

| # | Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|---|
| F1 | Zones and polygon boundaries | Covered (merged 2026-11-02) | DEL-1; WEB-6 editor (planned) | 1 | none |
| F2 | Official boundary imports | Missing | none (DEL-1 plan §7 Q1) | 1 | C2-1 |
| F3 | Coverage per site and coverage check | Covered (merged) | DEL-1; consumed by DEL-2 | 1 | C2-2 |
| F4 | Capacity counters | Partial: limit merged in DEL-4; counter planned in DEL-6 | DEL-4, DEL-6 | 1 | C2-12 |
| F5 | Eligibility | Partial | DEL-6 (D-12), DEL-5, DEL-11 (D-11) | 1; cash block 2 | C2-8, C2-9, Q-26 |
| F6 | Manual assignment, unassign, transfer | Covered (planned) | DEL-6, WEB-7 | 1 | C2-13 (after pickup) |
| F7 | Offers, expiry, first accept | Covered (planned) | DEL-6, DRV-4, DRV-5 | 1 | C2-4 (escalation) |
| F8 | Auto-dispatch waves and assignment gap | Partial (waves yes; gap and escalation missing) | DEL-10 | 2 | C2-4 |
| F9 | Preview, then confirm | Missing in DEL-10; planned in DEL-16 | DEL-16 (DEL-10 amendment proposed) | 4 (proposed 2) | C2-5 |
| F10 | Time slots and slot days | Partial (planned) | DEL-9, DEL-14, WEB-9 | 2 | C2-9 |
| F11 | Service levels and cutoffs | Missing (proposed) | none (DEL-32 in PC; DEL-19 in WA; ids clash) | proposed 2 | C2-3, Q-33 |
| F12 | Route optimisation, rung 1 | Covered (planned) | INT-6 | 2, end of wave | Q-18, Q-45 |
| F13 | Route optimisation, rungs 2 and 3 | Covered (planned) | DEL-16, WEB-18 | 4 | C2-6 |
| F14 | Distance matrix, ETA, OSRM fallback | Covered (planned) | INT-5, INT-2 | 2, end of wave; ETA straight-line in wave 1 | Q-28, Q-45, C2-14, C2-15 |
| F15 | Re-solve on change | Partial | DEL-16 | 4 (pull-forward proposed) | C2-6 |
| F16 | Batching and vehicle or ability matching | Partial (vehicle kind only) | DEL-4 (kind), DEL-10; DEL-24 proposed | 2 | C2-8 |
| F17 | Route templates and copy | Missing | none (proposed) | proposed 2 | C2-7 |
| F18 | Dispatch board and map | Covered (planned) | WEB-7, WEB-6 | 1 | Q-19 |
| F19 | SSE streams and polling twins | Covered (planned) | DEL-6, WEB-7, DRV-4 | 1 | none |
| F20 | Geofences | Partial (parked yes; arrival proposed) | DRV-3; DEL-26 proposed | 1; 2 proposed | C2-10, C2-11 |

## Unanswered

These are the parts no source settled. Each is an owner or counsel question; none is answered by this chapter.

1. **C2-1 Official boundary source.** Which licensed source gives district polygons for Riyadh and Jeddah, and does its licence allow storage and display? (F2; HD §3 found none confirmed.)
2. **C2-2 Multi-site coverage.** When two sites cover a point, which site dispatches? The spec returns a union of `site_ids` and names no rule (F3). Candidate: an ordered first-match rule (AN §2), owner to rule.
3. **C2-3 Service records.** Add a per-site service with cutoff and SLA days? That needs a domain-model change and probably an ADR. Pricing waits on Q-33. (F11)
4. **C2-4 Auto-dispatch policy.** Wave count and size; candidate order; escalation after the last wave and to whom (FCN §4 Q9); assignment gap default and scope (60 s in Safee); audit of each rule run. (F7, F8)
5. **C2-5 Preview placement.** Move preview-then-confirm into DEL-10 (wave 2) or keep it in DEL-16 (wave 4)? (F9)
6. **C2-6 Route objective and re-solve timing.** Which objective the VROOM call optimises (time, distance or windows; the goal selector is a Wasal feature); whether rung 3 is pulled forward from wave 4 (FCN §7 Q7). (F12, F13, F15)
7. **C2-7 Route entity.** Is a route or run a stored entity (Wasal has one) or only the order plus assignment we have? (F17)
8. **C2-8 Batching and ability.** Batch objective (fewest drivers, fair spread or shortest distance; FCN §7 Q11), ability tags, and whether driver groups per client exist. (F5, F16)
9. **C2-9 Calendar.** Service-day weekdays (Friday and Saturday are not sourced), Ramadan hours and whether shift caps change; counsel on the 16-hour planned shift against statutory daily limits, using secondary sources that conflict [W1]. (F5, F10)
10. **C2-10 Prayer-time pauses.** None of the sources read handles prayer-time pauses and none was searched. Owner decides whether any pause is in scope. (F5, F11)
11. **C2-11 Position privacy.** Lawful basis, retention and notice for driver positions and trails (Q-5 says 90 days). Counsel; W2 is secondary. Needed before any arrival or proof-radius check. (F14, F20)
12. **C2-12 Capacity source.** Driver `capacity_limit`, counter `order_limit` and `CapacityCounter.limit` are three names for two numbers. Which is authoritative, and is it copied at shift start? (F4)
13. **C2-13 Custody after pickup.** When a driver is replaced after pickup, how is the parcel's custody moved between drivers? No source records it (DM 3.13 covers only the assignment change). (F6)
14. **C2-14 Matrix cache.** Redis key expiring at end of business day (IN 2.1) versus a Postgres table deleted after 7 days (DATA line 420). Hudhud caching terms are not stated (HD §1.6). (F14)
15. **C2-15 Wave 1 ETA.** Is a straight-line ETA acceptable on the tracking page before INT-6 (IN 2.1), or should the page show no ETA until then (FCN §1)? (F14)

## ID clashes to resolve before the next roadmap amendment

- **DEL-19 and DEL-20.** FCN §3 uses them for intake hardening and labels; WA §6 proposes them for service levels and route templates. This chapter uses none of them for those features.
- **DEL-32 and DEL-33.** PC §4 uses them for service levels with route templates and for exception rules. Usable here if the lead accepts PC's numbering.
- **DRV-8 and DRV-12.** FCN §3 uses DRV-8 for recipient OTP capture; SF A4 proposes DRV-8 for driver SOS; PC §4 uses DRV-12 for SOS.
- **HUB-1 and HUB-2.** FCN §3 (transfer state; manifests) and SH §6 (hub as a site kind; hub trips) differ. Outside this chapter; hubs are an owner ruling (FCN §4 Q1).
- **Transfer.** In this chapter, "transfer" always means an assignment change between drivers (DM 3.13). It is not the inter-site stock transfer (WMS-15) or the hub transfer (HUB-1).

## Sources

Repo files are read on `origin/main` at `1e0c184` on 2026-11-02, unless a line says otherwise. Research branches are read through `git show` on 2026-11-02.

- **DM** `docs/architecture/domain-model.md` §2.5, §3.3–3.5, §3.8, §3.9, §3.13, §3.14, §3.18 (D-3, D-5, D-6, D-9 to D-13, D-22 to D-24), §7, §9.
- **IN** `docs/architecture/integrations.md` §2.1–2.5, §5.4, §6.1–6.6, §12.
- **WE** `docs/architecture/web.md` §5, §6.3, §6.4, §7.1–7.4, §8, §12.
- **DATA** `docs/architecture/data.md` (tables `del_zones`, `del_coverage`, `del_drivers`, `del_vehicles`, `del_assignments`, `del_offers`, `del_capacity_counters`, `del_slot_days`, `del_slots`, `del_distance_matrix_cache`; zone and routing notes at lines 417–420).
- **DA** `docs/architecture/driver-app.md` §3.14, §5 (profiles), §8.1–8.4.
- **CR** `docs/contracts/README.md` §3, §5, §6, §10, §12.
- **OA** `docs/contracts/openapi/staff-delivery.yaml` (zones, coverage, offers, assignments, slots, streams, driver positions, `CreateDriverRequest`); `components.yaml` (`Zone`, `Coverage`, `CoverageCheck`, `Offer`, `OfferOrderView`, `Slot`, `PublicTrackingView`); `driver.yaml` (`driverListOffers`, `driverListRun`).
- **ADR** `adr/0009`, `adr/0010`, `adr/0015`, `adr/0028`, `adr/0029`, `adr/0039` (read). ADR-0018 and ADR-0033 are cited as the repo cites them (DM, WE); not read here. ADR-0024 is cited via ADR-0028.
- **PLAN** `docs/orders/DEL-1/plan.md` §2, §7, §8.0; `docs/orders/DEL-5/plan.md` §2; `docs/orders/WEB-6/plan.md` §2. DEL-6 has no plan on main; its roadmap row is the only source.
- **RM** `docs/roadmap.md`: status table (DEL-1 merged, PR #132; DEL-2 and DEL-5 registered); rows DEL-1, DEL-5, DEL-6, DEL-9, DEL-10, DEL-11, DEL-14, DEL-16, INT-2, INT-5, INT-6, WEB-6, WEB-7, WEB-9, WEB-18; questions Q-5, Q-18, Q-19, Q-26, Q-28, Q-32, Q-33, Q-39, Q-41, Q-42, Q-45; amendment A-24.
- **HD** `docs/research/hudhud-geocoding-2026-11.md` §1.6, §2.2, §3, §4, Unanswered (research on main).
- **PF** `docs/research/provider-facts-2026-10.md` §8, §10, §11.
- **GEO** `docs/research/geo-logistics-oss-census-2026-11.md` §1, §2, §5, Unanswered, Mapping to the ADRs (research on main).
- **PLP** `docs/research/play-location-policy-2026-11.md` §1 (research on main).
- **BLT** `docs/research/background-location-teardown-2026-11.md` (searched for the geofence context; no claim in this chapter rests on it alone).
- **FCN** `origin/docs/feature-coverage:docs/research/feature-coverage-2026-11.md` §1 to §4.
- **FCD** `origin/docs/feature-coverage:docs/research/features-orders-dispatch-hubs-2026-11.md` §3 (rows), §5 (sources S14 to S23), §6 (P1 to P10), §7 (Unanswered). Its competitor citations are its own search and page reads of 2026-11-02; search summaries are marked as such there.
- **PC** `origin/docs/platform-teardowns:docs/research/platform-comparison-2026-11.md` §2, §4, §5.
- **WA** `origin/docs/platform-teardowns:docs/research/teardown-wasal-2026-11.md` §2.1–2.9, §4.2, §5, §6, §7.
- **SF** `origin/docs/platform-teardowns:docs/research/teardown-safee-2026-11.md` §2.1–2.5, §5, §6 (sources S5, S6, S14, S15, S17 as the note registers them).
- **SH** `origin/docs/platform-teardowns:docs/research/teardown-shipsy-2026-11.md` §2.1–2.6, §5, §6 (sources A3, A4, A8 as the note registers them).
- **OM** `origin/docs/platform-teardowns:docs/research/teardown-omniful-2026-11.md` §2.3, §5 (TMS rows).
- **AN** `origin/docs/platform-teardowns:docs/research/teardown-anchanto-2026-11.md` §2 (multi-warehouse routing row), §5, §6 (source A17, dated 2022-05-31 on its page; S1 is a search excerpt).
- **W1** Saudi working hours in Ramadan: secondary sources (ksaexpats.com, etqanlawfirm-sa.com, qanoniah.com), searched 2026-11-02. Not the Royal Decree text. Sources disagree on non-office job types. Needs counsel.
- **W2** Saudi PDPL and employer location data: secondary sources (tamimi.com, cms.law, gotrust.tech, pwc.com), searched 2026-11-02. Not the statute or the Implementing Regulations. Needs counsel.
