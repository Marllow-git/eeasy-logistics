# Feature book 04: Fleet and workforce

Date: 2026-11-02. Status: research input for the lead; no decision taken; the roadmap does not change. Scope: drivers, vehicles, devices, shifts, location telemetry, driver groups and site scope, compliance documents, onboarding, scorecards, pay, cash block and attendance for merchants with their own drivers in KSA and the GCC.

Repo facts were read at `origin/main` b58760d on 2026-11-02. Remote research notes were read with `git show` on 2026-11-02. Source tags are listed at the end.

## Summary for the lead

1. Driver identity, devices, shifts and location telemetry are specified in depth and partly built: DEL-4 is merged (#114) and DEL-5 leg 1 is building. The shapes below are close to fixed; the gaps sit around them.
2. Missing from every order: compliance documents with expiry and an offer gate, onboarding and pre-shift checks, vehicle service tasks, driver groups, incentives, attendance rules and MDM. Proposals exist (DEL-22, DRV-9, VEH-1, A3, RES-1); none is ordered.
3. Shift gap: no rule ends an active shift at `planned_end`. Only the driver, a dispatcher, suspension or the no-show rule changes shift state, and the stale-tracking alert does not end a shift.
4. Wave conflict: DEL-5 (wave 1) builds `planShift`; the contract marks `planShift` wave 2, and DEL-10 and WEB-9 (both wave 2) list planned shifts again.
5. Scope conflict: DEL-5 §2.7 puts `@SiteScoped()` on the position doors, DEL-4 §8.2 #14 says no door is site-scoped, and `roles.yaml` gives no site-scoped role any driver or location permission. As written, a site manager cannot see their drivers.
6. Plans P4 §6 and P5 §2.4 cite DEL-8 for the cash block; the roadmap gives DEL-8 to recipient tracking and DEL-11 to the block and its clearing. Correct the plan references before DEL-11 is planned.
7. Labour and PDPL: planned shifts of up to 16 h and ad hoc shifts of 12 h exceed the 8-hour day in secondary sources on Saudi labour law. No hour, rest, overtime or attendance rule exists in DEL-5 or DEL-13. Position and ID data have no PDPL basis in the repo.
8. Government links: no Absher, Tamm, Naql, Wasl or CST integration is in any order or ADR. Arabic press reports TGA conditions for delivery platforms and motorcycles; these are unverified against the regulator's text.
9. Scorecards (DEL-17, wave 4) and pay statements (DEL-13, wave 2) are planned as read-only reports over `rpt_driver_day` under Q-32. No incentive rule and no pay policy exist.
10. Shapes that differ from the roadmap rows: DEL-5 (planned-end close, site scope), DEL-4 and DEL-10 (wave of `planShift`), DEL-13 (hour and overtime rules), and the proposed DRV-9 and DEL-22 (not in the roadmap). Nothing is decided; each appears under Unanswered.

## Conventions

- **Chosen (repo)** means what an ADR, plan, contract or roadmap row fixes today. It is not a recommendation. Where the repo fixes nothing, the aspect says "none chosen".
- **Market** means what a teardown or census note reports. Vendor claims are marked "claimed". Secondary web sources are marked as such.
- Driver tables are in `docs/architecture/data.md` §2.2 (Delivery). The brief cites §2.1, which is the shared kernel.
- Each feature carries the ten aspects in the fixed order. Aspect 3 marks each KSA or GCC rule by its grade: repo (decided), research note (secondary), or web (secondary, unverified).

## 1. Driver records: create by phone, status, home site, capacity, suspension, archive

1. **Definition and user goal.** A dispatcher adds a driver by phone, sets a home site and a capacity, and suspends or archives the driver. The record decides who may receive offers and shifts [P4 §0; DM §3.5].
2. **Workflow.** States `active ⇄ suspended → archived` [DA §2.2 CHECK]. Happy path: `createDriver` (name, E.164 phone, `home_site_id`, `capacity_limit` default 30) returns 201 and enqueues the invitation in the same transaction [P4 §2.2–2.3; OAPI]. Refusals: `site_kind_mismatch` (warehouse site); `limit_exceeded` (`limits.drivers`, code default 25, counted over active and suspended drivers); `role_combination_forbidden` (phone holds a staff cash role); `duplicate` (phone already drives here) [P4 §8.2 #8, #10]. A re-created archived driver reuses the row and clears the PIN [P4 §8.2 #9]. Out of `archived`: 409 `invalid_transition` [P4 §8.2 #15]. Actor: dispatcher or above; the driver has no write path.
3. **Rules and edge cases.** Phone normalised to E.164 [DM §8]. Iqama and driving licence: no field and no check in any table or order. Secondary press reports Saudi-national and age 18–60 conditions for delivery-app work, and a motorcycle carve-out pending regulation [WL4, unverified]. A person may drive for several accounts; `name` lives on the account's row [P4 §8.2 #38]. A capacity below the current active orders gives `capacity_exceeded` [P4 §2.4].
4. **Data.** `del_drivers`: `user_id`, `membership_id`, `home_site_id`, `name` (1–120), `status`, `capacity_limit` (≥0, default 30), `cash_blocked_at`, `cash_blocked_reason`, PIN fields, `version`; unique `(account_id, user_id)` [DA §2.2]. Invariants D-10 and D-12 [DM §3.18]. Retention: life of the membership; push token cleared on archive [DA §10].
5. **Surfaces.** Merchant web: driver list in WEB-6 (wave 1, not built) [RM]. API: `listDrivers`, `createDriver`, `getDriver`, `updateDriver` [OAPI]. Driver app: sign-in only [DRV §7.1]. Messaging: WhatsApp `driver_invitation`, wave 1, from the account's sender [INT §5.1].
6. **Permissions, roles, audit.** Read `delivery.drivers.read` (owner, admin, dispatcher, viewer). Write `delivery.drivers.manage` (owner, admin, dispatcher) [ROLES]. Audit `delivery.driver.created` and `updated`, with before and after and the phone tail only [P4 §8.2 #16].
7. **Dependencies.** The platform WhatsApp number, one per product (ADR-0041, Q-27) [INT §5.1; RM]. The `delivery` feature gate [P4 §6]. No government or HR system.
8. **Metrics.** Drivers by status and home site: none defined. Invitation sent versus first sign-in: not defined in any document.
9. **Market and chosen shape.** Market: Shipday runs in-house and third-party drivers [FDF S7]; Safee adds drivers by hand or by Excel import and types them static or dynamic [TSF §2.3]. Chosen (repo): one account-scoped row per person, created by phone with a WhatsApp invitation [P4 §2.2–2.3; ADR-0023]. Safee's CSV driver import and driver types are proposal A3 and are not chosen [TSF §6].
10. **Roadmap mapping.** Covered: DEL-4, merged as #114 with migration `20261102122929_del_drivers` [RM §0]. Missing: CSV driver import and driver types (A3, not ordered). Owner question 4 (groups) and the A3 wave fit.

## 2. Vehicles and service tasks

1. **Definition and user goal.** A vehicle record (plate, kind, parcel capacity, active) that a shift runs with. Service tasks would track date or odometer maintenance; only the record exists.
2. **Workflow.** `createVehicle` and `updateVehicle`, with an active flag and no status machine [OAPI; DM §3.5]. Shift start refuses `vehicle_inactive` and `vehicle_unknown` [P5 §2.4]. Service tasks: none in the repo. Proposal VEH-1 (date and odometer tasks, overdue warnings, no blocking) [TSF §6 A6].
3. **Rules and edge cases.** Plate 1–20 characters, upper-cased, unique per account [P4 §8.2 #20]. Kind is `car`, `van` or `motorbike` [DM §3.5]. KSA: a TGA regime for goods transport by motorcycle is reported to require a licence, a commercial register and registration of drivers and motorcycles on the TGA platform [WL4, unverified]. Wasl publishes a per-activity guide, including "Motorcycle Delivery" 1.1 [TSF §2.7]. No repo document maps these to vehicle fields.
4. **Data.** `del_vehicles`: `plate`, `kind`, `capacity_parcels` (≥0), `active`, `version`; unique `(account_id, plate)` [DA §2.2; P4 §8.2 #20]. No odometer, no service table, no registration or insurance fields. Retention: not stated.
5. **Surfaces.** Vehicles in WEB-6 (wave 1) [RM]. API `listVehicles` and `createVehicle` [OAPI]. The driver app picks a vehicle at shift start from `driverListVehicles` (DEL-6) [P4 §6; DRV §6.1].
6. **Permissions, roles, audit.** Write `delivery.vehicles.manage` (owner, admin, dispatcher); read through `delivery.drivers.read` [ROLES]. Audit `delivery.vehicle.created` and `updated` [P4 §2.13].
7. **Dependencies.** None external. A service reminder would need a notification channel, which no order builds [FDF Module 3].
8. **Metrics.** Active vehicles. No utilisation or service metric is defined.
9. **Market and chosen shape.** Market: Tryoto manages vehicle types and teams [FDF S9]; Safee runs maintenance tasks by odometer, date, period and prompt, with PDF task cards [TSF §2.6]. Chosen (repo): kind and capacity only; service tasks not chosen. VEH-1 is proposed, with its wave left to the owner [TSF §6].
10. **Roadmap mapping.** Partial: vehicles covered by DEL-4; service tasks missing (VEH-1 proposed, not in RM). Owner question 2.

## 3. Driver devices, revocation and device management (MDM)

1. **Definition and user goal.** A driver signs in on at most two phones, each bound to an app device id. A dispatcher lists the devices and revokes a lost one. Company-phone management (MDM) is not defined anywhere.
2. **Workflow.** Sign-in with a code binds the device; a third device gets `409 device_limit_reached` [P4 §2.7; DRV §7.1]. A dispatcher's `revokeDriverDevice` ends the device's refresh families, clears its push token, and the next refresh answers `401 device_revoked` [P4 §8.2 #17, #29]. A revoked app id stays revoked on later sign-in [P4 §8.2 #39]. For a lost SIM, the guidance is to suspend the driver, because a thief can sign in on a new app id [P4 §8.2 #39]. Actors: driver (sign-in), dispatcher (revoke).
3. **Rules and edge cases.** Two active devices per driver (Q-8, provisional) [RM §4; identity §3.2 as cited in P4 §1]. Refresh token 90 days, device-bound; access token 15 minutes [DRV §7.2]. A 30 s refresh-reuse grace is proposed (Q-23, provisional). The cash PIN verifier lives on the device and is deleted on revocation [DRV §5.3]. The app reads no hardware identifier [DRV §7.1]. KSA and GCC: no rule in the sources read.
4. **Data.** `del_driver_devices`: `device_id` (1–200), `platform` (ios or android), `app_version`, `push_token` (≤4096), `revoked_at`, `last_seen_at`, `version`; unique `(account_id, driver_id, device_id)` [DA §2.2]. The staff view omits `device_id` and `push_token` [P4 §8.2 #18, #41]. Refresh rows carry the device row id [P4 §8.2 #17]. Retention: push token cleared on archive, revocation or an invalid push [DA §10].
5. **Surfaces.** Devices list in WEB-6 (wave 1). API `listDriverDevices` and `revokeDriverDevice` [OAPI]. Driver app: sign-in and `driverUpdatePushToken` [DRV §7.1].
6. **Permissions, roles, audit.** List through `delivery.drivers.read`; revoke through `delivery.drivers.manage` [ROLES]. Audit `delivery.driver_device.registered` and `revoked`, never the app device id or the token [P4 §2.13; §8.2 #17].
7. **Dependencies.** Expo push tokens [DRV §8.2]; secure storage [DRV §7.2]. No MDM vendor and no company-phone rule in any source.
8. **Metrics.** Live devices per driver; revocations per month; refused third-device sign-ins. None defined.
9. **Market and chosen shape.** Market: Bringg offers SSO and device-bound login [FDF S1]. Safee's device commands are for hardware trackers [TSF §2.1], which the teardown rejects for us [TSF §5]. MDM was not researched [FDF Module 2]. Chosen (repo): app-level binding and revocation only, no MDM [P4 §2.5; DRV §7].
10. **Roadmap mapping.** Covered for binding and revocation (DEL-4, merged). MDM missing and not ordered. Owner question 8 (company or personal phones).

## 4. Shift planning and start

1. **Definition and user goal.** A dispatcher plans a shift for a driver at a site with a vehicle. The driver starts it from the app, or starts an ad hoc shift. A live shift turns on position reporting and makes the driver eligible for offers.
2. **Workflow.** States `planned → active` (driver starts with a vehicle) and `planned → cancelled` (dispatcher) [DM §3.17]. `planShift`: `planned_start < planned_end`, at most 16 h, at most 14 days ahead, no overlap with the driver's other shifts [P5 §2.3]. `driverStartShift` checks eligibility with typed reasons: `driver_suspended`, `cash_blocked`, `vehicle_inactive`, `vehicle_unknown`, `shift_live`, `shift_not_planned`, `outside_window` (no more than 60 min before start, not after `planned_end`) [P5 §2.4]. Ad hoc: home site, `planned_end` = now + 12 h [P5 §7 #2]. Actors: dispatcher plans and cancels; driver starts.
3. **Rules and edge cases.** One live shift per driver (partial unique index) [DA §2.2]. A start needs an active driver, an active vehicle and no cash block [P5 §2.4; D-11, D-12]. Labour: the 16 h planned window and 12 h ad hoc window exceed the Saudi 8-hour day. Secondary sources give 8 hours a day and 48 a week (Art. 98), 150 % overtime (Art. 107), and 6 hours a day in Ramadan for Muslim workers [WL1, WL3, unverified]. DEL-5 and DEL-13 model none of this.
4. **Data.** `del_driver_shifts`: `driver_id`, `site_id`, `vehicle_id`, `planned_start`, `planned_end`, `started_at`, `ended_at`, `status` (CHECK §3.17), `version`; index `(account_id, site_id, planned_start)`; partial unique `(driver_id)` where status is active or paused [DA §2.2]. Retention is not listed in DA §10.
5. **Surfaces.** Staff: shift planning in WEB-9 (wave 2, not built) [RM]. Driver app: shift start, planned or ad hoc [DRV §6.1]. API: `planShift`, `listShifts`, `getShift` (staff); `driverListShifts`, `driverStartShift` (driver) [OAPI; P5 §2.4]. Event `delivery.shift.started` [DM §6.3].
6. **Permissions, roles, audit.** `delivery.shifts.manage` (owner, admin, dispatcher) [ROLES]; the driver holds `delivery.driver.work`. Audit `delivery.shift.planned`; a driver start is audited with actor `driver` [P5 §2.9].
7. **Dependencies.** DEL-4 drivers and vehicles; the cash block that the start checks (set by DEL-11, see 14) [P5 §2.4; RM]; the outbox. No external system.
8. **Metrics.** Planned versus started shifts; ad hoc share; refusals by reason. DM §7 defines only "active shifts".
9. **Market and chosen shape.** Market: Bringg starts and ends shifts by swipe [FDF S1]; Shipday schedules drivers [FDF S7]; Safee has static drivers and dynamic multi-vehicle drivers [TSF §2.3]. Chosen (repo): planned and ad hoc shifts, one live shift per driver, typed refusals [P5 §2a]. Multi-vehicle dynamic shifts not chosen.
10. **Roadmap mapping.** Covered in DEL-5 leg 1 (building, #137). Conflict: DEL-5 (wave 1) builds `planShift`; OAPI marks `planShift` wave 2; DEL-10 and WEB-9 (wave 2) list planned shifts again [RM; OAPI]. Owner question 2.

## 5. Shift end paths: pause, resume, end, no-show, planned-end auto-close, suspension cascade

1. **Definition and user goal.** Every way a live shift stops. A live shift keeps positions flowing and keeps the driver eligible for offers, so no shift should stay live without a recorded reason.
2. **Workflow.** `active ⇄ paused` by the driver; `active → ended` by driver or dispatcher; `paused → ended` by dispatcher; `planned → no_show` by the system after a 30-minute grace; `active | paused → ended` by the system when the account is suspended [DM §3.17; P5 §2.5; P5 §7 #1]. Pause, resume and end go through the outbox and replay by key [DRV §6.1; P5 §2.4].
3. **Rules and edge cases.** Planned-end auto-close is not defined. No arrow in §3.17 ends a shift at `planned_end`, and the sweeper handles only no-show and stale checks [DM §3.17; P5 §2.5]. An active shift past `planned_end` stays live: it keeps position reporting and offer eligibility until someone ends it. The 12 h cap on ad hoc shifts sets only a `planned_end` value. The stale alert does not end the shift [P5 §2.8]. On suspension the driver's session becomes read-only behind a banner, and the system ends the shift [DRV §7.3; P5 §2.5].
4. **Data.** Same `del_driver_shifts` row. The end reason sits in the audit row and in the event payload as `ended_by` [P5 §2.3, §2.9]. The shift row stores no pause timestamps [DA §2.2].
5. **Surfaces.** Driver app: pause, resume and end, with ending blocked during an open stop [DRV §6.1]. Dispatcher end in WEB-9 (wave 2). Event `delivery.shift.ended` for the board [P5 §2.9]. No dispatcher alert on no-show; the sweeper emits no event [P5 §2.5].
6. **Permissions, roles, audit.** Dispatcher `delivery.shifts.manage`; driver `delivery.driver.work`; the sweeper and the suspension consumer run on the cross-tenant worker role [DA §4.4]. Audit `delivery.shift.no_show` and `ended`, with notes [P5 §2.9].
7. **Dependencies.** Event `core.account.suspended` [DM §6.3]; BullMQ workers and single-leader locks [ADR-0036]; Redis for pings.
8. **Metrics.** No-show count, from the audit rows [P5 §2.5]. Shifts ended by the system and shifts left open past `planned_end`: neither is defined.
9. **Market and chosen shape.** Market: Bringg ends shifts by swipe [FDF S1]; Safee confirms trip start and end [TSF §2.2]. No source read describes an automatic close at a planned end time. Chosen (repo): explicit end by driver or dispatcher, plus no-show and suspension. Planned-end auto-close is not chosen.
10. **Roadmap mapping.** Covered in DEL-5 leg 2: pause, resume, end, no-show, suspension cascade. Missing: planned-end auto-close (not in the DEL-5 row, RM §1.2). Owner question 1.

## 6. Location pings, the ring and latest positions

1. **Definition and user goal.** While a shift is live the phone reports its position. Dispatchers see each driver's latest point on a map; during a delivery a recipient sees only their own driver.
2. **Workflow.** The app batches up to 20 points every 15 s while moving and every 2–3 min while parked [DRV §6.2; ADR-0039]. `driverPostLocations` returns 202 only for the live shift; `409 shift_not_active` stops the app's task; the budget is 12 requests a minute per driver [P5 §2.6]. Staff read `listLatestDriverPositions` and the dispatch SSE stream [OAPI; DM §7]. Actors: driver writes; dispatcher and viewer read.
3. **Rules and edge cases.** Points older than the head's last client timestamp are dropped; points more than 5 min in the future are refused; accuracy must be 0–10,000 m [P5 §2.6]. A lost point is a gap on a map, not an outbox case [ADR-0028]. Positions stay out of logs and events [P5 §5]. KSA and GCC: no PDPL basis or consent text in the repo beyond the on-shift prompt [DRV §6.3]; a PDPL statement is proposed (PDPL-1) [FCOV §2 item 4]. Wasl shows real-time driver location with no retention or consent statement [TWS §4.4], a gap in a competitor, not a standard.
4. **Data.** `del_driver_locations`: ring keyed by `(driver_id, slot)`, slot 0–239, fill factor 70. `del_driver_location_heads`: last point and sequence. Redis `elx:loc:latest:{account}:{driver}`, TTL 600 s [DA §2.2, §6]. Points also carry battery percentage, charging and power-saver flags [ADR-0039; DA §6].
5. **Surfaces.** Driver app: tracker and permission setup [DRV §6.2–6.3]. Maps in WEB-6 and WEB-7 (wave 1) [RM]. SSE stream `telemetry.driver_location` on the dispatch stream [P5 §1]. Recipient page: own driver only, while `out_for_delivery` [DM §7].
6. **Permissions, roles, audit.** Write `delivery.driver.locations`; read `delivery.locations.read` (owner, admin, dispatcher, viewer) [ROLES]. No site restriction applies to these readers (see 9). Position reads are not audited in any document.
7. **Dependencies.** Redis pub/sub and latest key; the Postgres ring; OS location services and a foreground service [DRV §6.3]. No telematics hardware: ADR-0002 scopes delivery and WMS only [TSF §5].
8. **Metrics.** Pings accepted and rejected per minute; ping lag; gaps over 2 minutes; battery per hour against a 4 % per hour budget [DM §7; ADR-0039 point 9; Q-39].
9. **Market and chosen shape.** Market: Safee shows second-by-second updates on a web map and turns the phone into a tracker [TSF §2.1]. Chosen (repo): own adaptive tracker on the phone, bounded ring, Redis fan-out, no outbox [ADR-0039, ADR-0028, ADR-0009]. Hardware telematics not chosen [ADR-0002].
10. **Roadmap mapping.** Covered in build: DEL-5 (ingest, ring, latest), DRV-3 (tracker), WEB-6 and WEB-7 (maps). Q-39 (battery budget) and Q-40 (SQLCipher) are ruled. Q-26 (start without background location; default: allowed, with a warning to dispatch) is open.

## 7. Trails and retention

1. **Definition and user goal.** One simplified line per driver per business day, so a dispute or a pay check can show where a driver was at a given time.
2. **Workflow.** Every 5 minutes the trail appender adds new ring points to the day's row, simplified to about 5 m with M = Unix seconds; a segment crossing midnight Asia/Riyadh is split [DA §6; P5 §2.8]. Staff read it with `getDriverTrail` [OAPI]. A daily job at 03:00 deletes trails older than 90 days [P5 §2.8].
3. **Rules and edge cases.** 90 days is provisional (Q-5). Open: whether 90 days suffices for disputes and pay checks, or trails should follow the two-year proof retention [DM §9 Q5]. Safee states it keeps live web data at least six months [TSF §4, vendor statement]. No source read states a labour-record period for shift or position data.
4. **Data.** `del_driver_trails`: `driver_id`, `business_date`, `path` (LineStringM, 4326), `point_count`, first and last times; unique `(account_id, driver_id, business_date)`; GiST index [DA §2.2]. Ring and heads of archived drivers are deleted [DA §6]. Retention 90 days [DA §10].
5. **Surfaces.** Trail view in WEB-6 (wave 1) [RM]; API `getDriverTrail` [OAPI]. No driver-side view. No export; exports belong to DEL-17 (wave 4).
6. **Permissions, roles, audit.** Read through `delivery.locations.read`. No audit row is specified for trail reads [P5 §2.9; DA §10].
7. **Dependencies.** PostGIS [ADR-0019]; the single-leader lock `elx:lock:trail-appender` [DA §6].
8. **Metrics.** Trail rows live: about 40 MB for one merchant at the first-customer profile [DA §12]. No product metric.
9. **Market and chosen shape.** Market: Safee offers route history, trip reports and scheduled Excel or PDF exports [TSF §2.1, §2.6]. Wasal ties data history to plan tiers and calls it a privacy decision [TWS §5]. Chosen (repo): 90 days, simplified line, read-only, no export [DA §6, §10]. Exports not chosen.
10. **Roadmap mapping.** Covered in build (DEL-5 leg 1) and WEB-6. Owner question 11 (retention length).

## 8. Stale-tracking alert

1. **Definition and user goal.** When an active shift sends no location for 5 minutes, the driver gets a push and the dispatch board is flagged, so a silent driver is noticed.
2. **Workflow.** The sweeper runs every 5 minutes. For each active shift with no point in 5 minutes (or none since the start), and no alert in the last 15 minutes, it enqueues one `push` row (template `stale_tracking`, in Arabic and English) and emits `delivery.shift.tracking_stale` [P5 §2.8]. The app's own watchdog restarts the task or posts a local notification [DRV §6.2; ADR-0039 point 6]. Paused shifts are excluded [P5 §2.10].
3. **Rules and edge cases.** Threshold 5 minutes; cadence 15 minutes, recorded on the shift as `stale_alerted_at`; no dispatcher push [P5 §2a, §7 #3]. A tunnel, power-saver mode and a dead phone look the same to the server; the app's battery diagnostics are the only way to tell them apart [ADR-0039]. KSA and GCC: none in the sources.
4. **Data.** `stale_alerted_at` on the shift; a `push` outbox row; the event carries ids and times, never a position [P5 §2.8–2.9].
5. **Surfaces.** Driver: push and local notification [DRV §8.2]. Dispatch board: event in WEB-7 (wave 1) [RM]. No SMS [ADR-0037].
6. **Permissions, roles, audit.** Written by the system job. The alert has no audit row in P5 §2.9.
7. **Dependencies.** Expo push through the `push` outbox kind [INT §4.1]; the push text namespace in Arabic and English [P5 §1].
8. **Metrics.** Stale alerts per shift per day; time from alert to next point. None defined.
9. **Market and chosen shape.** Market: Safee runs more than 50 alarm types [TSF §2.1], which the teardown rejects for us [TSF §5]; Bringg sends alerts by severity over in-app, SMS, email and webhook [FDF S2]. Chosen (repo): one alert, a push to the driver and a board event; no SMS and no dispatcher push. Own shape.
10. **Roadmap mapping.** Defined in DEL-5, with no delivery channel for staff. The notification centre is proposed (DEL-21 in FCOV §3). Owner question 12.

## 9. Driver groups and site scoping

1. **Definition and user goal.** Grouping drivers so that a manager sees and assigns only the drivers of their client, team or site. Chosen today: the home site and the membership's site list. No group entity exists.
2. **Workflow.** None for groups. Offers match a driver by coverage of the order's zone and by an active shift [DM §3.18 D-12]. A staff member's site scope comes from the membership's `site_ids` [DM §2.2].
3. **Rules and edge cases.** `site_staff`, `warehouse_staff` and `cashier` hold no driver, shift or location permission [ROLES]. The two plans disagree on position doors:

| Source | Statement |
|---|---|
| P4 §8.2 #14 | No door is `@SiteScoped()`, because no role with `delivery.drivers.*` is site-scoped |
| P5 §2.7 | Both position doors are `@SiteScoped()`; site members see their sites' drivers |
| ROLES | `delivery.locations.read` is held by owner, admin, dispatcher and viewer; none is site-scoped |

Safee: each client account owns its driver groups, gated by a "Manage Driver Groups" permission, and only that account's drivers can be assigned [TSF §2.3, S17]. Its proposal A3 scopes groups to the account or the site [TSF §6]. KSA: no requirement found.
4. **Data.** `del_drivers.home_site_id` only; `core_memberships.site_ids` with a GIN index [DA §2.1–2.2]. No group table.
5. **Surfaces.** WEB-6 driver list filtered by home site (`site_id` on `listDrivers`) [OAPI]. No driver-side group.
6. **Permissions, roles, audit.** None for groups. The site-scope conflict must be settled in `roles.yaml` or in P5 §2.7.
7. **Dependencies.** PLAT-10 roles; ADR-0018 site kinds (K-4: a driver's home site is `branch` or `both`) [DM §2.3].
8. **Metrics.** None defined for scope.
9. **Market and chosen shape.** Market: Safee groups per client account [TSF §2.3]; Wasal has depots with per-driver overrides and a distributor role whose permissions are not documented [TWS §2.1, §2.6]. Chosen (repo): sites scope staff (ADR-0018, PLAT-10); no groups. Groups are proposal A3, not chosen.
10. **Roadmap mapping.** Partial: home site (DEL-4) and site roles (PLAT-10). No group order. The scope conflict is unresolved. Owner question 3 (site managers) and question 4 (groups).

## 10. Driver and vehicle compliance documents, expiry and gating

1. **Definition and user goal.** Record each driver's and vehicle's documents (identity or Iqama, driving licence, vehicle registration, insurance, operating card), with expiry dates, reminders, and an offer block after expiry if ruled.
2. **Workflow.** None built. The census proposes upload from the app, reminders at fixed lead times and an offer gate by ruling [FDF Module 2; FCOV §3 DEL-22]. Safee proposes an assignment block with a logged staff override [TSF §6 A5].
3. **Rules and edge cases.** Regulator (secondary): the TGA's first-phase decisions tie non-Saudi delivery drivers to licensed companies, uniforms and operating cards [FDF S19]. A freeze on new motorcycle delivery licences was reported in October 2024 [FDF S20, excerpt]. Arabic press search results, read 2026-11-02, list conditions for delivery-app companies (a commercial register with delivery activity, GOSI and zakat certificates, a link to the TGA platform, identity verification, and Nafath checks for Saudi drivers) and for goods transport by motorcycle (licence, commercial register, driver and motorcycle registration on the TGA platform, fleet monitoring) [WL4, unverified, dates unclear]. Iqama validity on Absher appears in a low-quality source that is not used [FDF S32]. No Absher, Tamm, Naql, Wasl or CST integration appears in any order or ADR. Wasl has a motorcycle delivery guide [TSF §2.7].
4. **Data.** None. A document entity would need type, number, expiry, storage key and verification status. ID photos already live in proofs (`id_check`) with two-year retention [DM §3.10; DA §10]; that is not a driver document. The PDPL basis for identity and Iqama numbers is unresolved [FDF Unanswered 2].
5. **Surfaces.** None in `staff-delivery.yaml` or `driver.yaml`. Would need an upload in the driver app and a view in WEB-6.
6. **Permissions, roles, audit.** None defined in `roles.yaml` or `permissions.yaml`.
7. **Dependencies.** Object storage with signed URLs [DM §3.10]; reminders as WhatsApp utility templates [ADR-0037] or push. No government check is planned.
8. **Metrics.** Documents expiring within 30 days; drivers blocked by expiry. None defined.
9. **Market and chosen shape.** Market: Samsara sends expiry alerts to admins and drivers and supports self-service upload [FDF S17]; Fleetio sends renewal reminders [FDF S18, excerpt]; Safee's expiries explorer raises alarms on licence and document expiry [TSF §2.6]. Chosen (repo): none. DEL-22 (wave 2 in FCOV; wave 1 or 2 in FDF) and DOC-1 (A5) are not chosen. Block or warn is the owner's call.
10. **Roadmap mapping.** Missing; not in RM. Owner question 5. RES-1 (research on Wasl and CST before DRV-3 ships) is also open [TSF §6 A8].

## 11. Onboarding, training and pre-shift checks

1. **Definition and user goal.** Steps a new driver completes before the first shift (sign-in, permissions, training, a vehicle check), and checks before each shift.
2. **Workflow.** Built: create, invitation, code sign-in, cash PIN setup, permissions, then shift start [P4 §2.7–2.9; DRV §7.1, §6.3]. No training step and no checklist. Proposed DRV-9: an onboarding checklist and a pre-shift vehicle check, with the owner deciding whether it gates offers [FCOV §3].
3. **Rules and edge cases.** Permission requests come with an in-app reason; refusing background location is allowed with a warning to dispatch (Q-26, provisional) [DRV §6.3]. KSA: no training requirement found in the TGA rules read [FDF Unanswered 11]. Labour: whether induction time counts as working time is not addressed in any source (inference; counsel to check).
4. **Data.** None. A checklist-completion record would be new.
5. **Surfaces.** Driver app setup screens (DRV-3). No web view.
6. **Permissions, roles, audit.** None defined.
7. **Dependencies.** DRV-3 setup screens. No learning system.
8. **Metrics.** None.
9. **Market and chosen shape.** Market: Bringg pre- and post-shift forms, including vehicle checks [FDF S1]; Careem registers Captains in a portal and then trains them [FDF S22, excerpt]; DeTrack runs a pre-route safety checklist [FDF S15]. Chosen (repo): none beyond sign-in and permissions. DRV-9 is proposed, not chosen.
10. **Roadmap mapping.** Missing. Owner questions 9 (required by merchant or regulator) and whether the checklist gates offers (FCOV §3, DRV-9).

## 12. Performance scorecards

1. **Definition and user goal.** Per-driver on-time, delivered, failed and attempt figures over a period, for dispatchers and managers.
2. **Workflow.** DEL-17 (wave 4) builds reports over the reporting views. No workflow. A scheduled export is proposed (A7) [TSF §6].
3. **Rules and edge cases.** Q-32 (provisional): read-only reports over existing ledgers and events, with no new ledger [RM Q-32]. The source view `rpt_driver_day` covers orders delivered and attempted, cash held, liability and shift hours per driver and date; live figures come from the view and history from `rpt_daily_kpis` [DA §9]. The census found no KSA evidence on which metrics matter [FDF Module 2]. Ranking drivers is a personal-data use with no PDPL assessment in the repo. A driving score from device motion is out of plan [TSF §5; ADR-0039].
4. **Data.** Plain view `rpt_driver_day` (security invoker) and table `rpt_daily_kpis` with `account_id` and the tenancy policy [DA §9]. No scorecard table.
5. **Surfaces.** WEB-18 planner and scorecards (wave 4) [RM]. No driver-side view.
6. **Permissions, roles, audit.** No scorecard permission exists in `roles.yaml` or `permissions.yaml`. The reporting module reads under the reader's RLS [DA §9].
7. **Dependencies.** Field events (DEL-7), cash (DEL-12), the reporting module [DA §9].
8. **Metrics.** Market set: on-time rate, proof completeness and COD variance per driver (A7) [TSF §6]; failure reasons and driver breakdowns [TWS §5]. None is in the repo.
9. **Market and chosen shape.** Market: Routific publishes end-of-day performance reports [FDF S16]; Safee has RAG and best-driver reports [TSF §2.6]; Wasal's performance analytics are on the Premium tier [TWS §2.8]. Chosen (repo): read-only reports over the views, wave 4. Driver-visible metrics not chosen.
10. **Roadmap mapping.** Partial: DEL-17 and WEB-18 in wave 4, reports only. Owner questions 10 (Q-32 and timing; driver-visible metrics).

## 13. Pay statements and incentives

1. **Definition and user goal.** A statement per driver per period of what is owed, and rules that add pay for on-time or high-volume work.
2. **Workflow.** Statements: DEL-13 (wave 2), read-only, built from ledgers (Q-32) [RM]. Liability entries from DEL-11 can reduce a statement [DM §3.11]. Incentives: none.
3. **Rules and edge cases.** No pay rate, commission, payout method or deduction order is defined in any repo document. Liability entries are append-only and signed [ADR-0007; D-20]. KSA: secondary sources put overtime at 150 % under Art. 107 [WL1, unverified]; wage-payment rules were not researched. A commission figure reported for Careem is unverified [FDF S22].
4. **Data.** No pay table. Inputs: `del_driver_cash_positions`, liability entries, shift times [DA §2.2; DM §3.11]. Statement records are not modelled.
5. **Surfaces.** Driver cash and liability in WEB-10 (wave 2) [RM]. Driver-app earnings view: not decided [FDF Unanswered 12].
6. **Permissions, roles, audit.** No pay permission exists in `roles.yaml` or `permissions.yaml`. Cash is readable through `delivery.cash.read`.
7. **Dependencies.** DEL-7 and DEL-11 (RM DEL-13 row). Payment gateways are gated by ADR-0017. No payroll or bank integration.
8. **Metrics.** None defined.
9. **Market and chosen shape.** Market: Careem Captain shows daily earnings and payouts, and bonus programmes [FDF S22, excerpt]; Shipsy lists rider payout and incentive in its knowledge base, titles only [TSH §2.7]. Chosen (repo): statements read from the ledgers, read-only (Q-32). Incentive rules not chosen.
10. **Roadmap mapping.** Partial: statements (DEL-13, wave 2); incentives missing. Owner questions 10 (pay policy, incentives, driver-visible earnings).

## 14. Cash block

1. **Definition and user goal.** A driver who holds collected cash from an earlier business day cannot receive new offers or assignments until a supervisor clears the block, so custody stays in line with the ledger.
2. **Workflow.** Set when a cash collection from a previous Asia/Riyadh day is still `collected` (D-11). The dispatcher alert `delivery.driver.cash_blocked` fires [DM §6.3]. The driver sees a banner; a stale offer that is accepted returns `422 driver_cash_blocked` [DRV §5.5]. Clearing: `clearDriverCashBlock` with a note, audited (wave 2) [OAPI]. Notice `cash_block_notice` to home-site dispatchers who opted in (wave 2) [INT §5.1].
3. **Rules and edge cases.** The block stops new offers and assignments, not open work [DRV §5.5]. Offline, the app predicts the block and marks it "expected" [DRV §5.5]. `clearDriverCashBlock` has no separation-of-duties rule, unlike a liability entry, which needs an approver who is not the handover's cashier [OAPI]. Market evidence for the block itself is weak: PCMP says ADR-0007's Logestechs COD settlement report and deficit ledger do not appear on its public pages; it does not check the block claim [PCMP §1].
4. **Data.** `del_drivers.cash_blocked_at` and `cash_blocked_reason`; `del_driver_cash_positions` (`oldest_collected_date`, `cash_in_hand`), with an index for the D-11 sweep [DA §2.2].
5. **Surfaces.** Driver banner [DRV §5.5]; WEB-10 cash desk with a clear action (wave 2) [RM]; dispatcher notice [INT §5.1].
6. **Permissions, roles, audit.** Clear through `delivery.drivers.clear_cash_block`, held by owner and admin; dispatcher does not hold it [ROLES]. Read through `delivery.cash.read`. Clearance writes an audit row [D-11].
7. **Dependencies.** DEL-7 collections; DEL-11 handovers; the site cashier [ROLES]; WhatsApp notice [INT §5.1].
8. **Metrics.** Cash-blocked drivers and held amount since date [DM §6.3, §7].
9. **Market and chosen shape.** Market: ADR-0007 cites Logestechs for blocking drivers who hold previous days' cash [ADR-0007; PCMP §1 caveat]. Chosen (repo): the ADR-0007 custody model with a calendar-day block (D-11).
10. **Roadmap mapping.** Covered in DEL-11 (wave 2). Plans P4 §6 and P5 §2.4 cite DEL-8, which RM gives to recipient tracking. INT-7 lists `cash_block_notice` as a recipient message, but INT §5.1 sends it to dispatchers [FCOV §1]. Lead to correct the plan references and the INT-7 row.

## 15. Attendance

1. **Definition and user goal.** A record of when each driver was on shift, with late starts, absences and hours, for labour checks and pay.
2. **Workflow.** Shift start and end times are recorded [DM §3.17; DA §2.2]. No attendance report, lateness rule or absence rule exists [FDF Module 2].
3. **Rules and edge cases.** Lateness can be inferred against `planned_start` but is not classified. No hour cap, rest break or overtime rule is enforced (see 4). Secondary sources give a rest of at least 30 minutes after five consecutive hours of work [WL2, unverified; check the official text]. Attendance is personal data; its retention is not in DA §10.
4. **Data.** `del_driver_shifts` holds start, end and status. Pause intervals are not stored: `paused` has no timestamp [DA §2.2]. The `rpt_driver_day` view carries shift hours [DA §9].
5. **Surfaces.** Shift screens in WEB-9 (wave 2). No attendance report or export.
6. **Permissions, roles, audit.** `delivery.drivers.read` or `delivery.shifts.manage` [ROLES]. No attendance permission.
7. **Dependencies.** `rpt_driver_day` [DA §9]; DEL-17 and DEL-13.
8. **Metrics.** Shift hours per driver per day (in the view). Lateness, absence, overtime and break time: not defined.
9. **Market and chosen shape.** Market: Urbi GeoFlow reports shift-level task metrics (reference only) [FDF S33]; Shipday schedules drivers [FDF S7]. Chosen (repo): shift times and hours from the view; no attendance report. Own shape.
10. **Roadmap mapping.** Partial: shift data in DEL-5, hours in the reporting view. Missing: attendance report, lateness, overtime, break accounting; no order. Owner questions 7 and 13.

## Feature index

| Feature | Status | Order | Wave | Owner question (Unanswered #) |
|---|---|---|---|---|
| 1 Driver records | Covered (merged) | DEL-4 | 1 | 4 |
| 2 Vehicles and service tasks | Partial (no service tasks) | DEL-4; VEH-1 proposed | 1; VEH-1 open | 2 |
| 3 Devices, revocation, MDM | Partial (no MDM) | DEL-4 | 1 | 8 |
| 4 Shift planning and start | Covered in build; wave conflict | DEL-5; DEL-10, WEB-9 duplicate | 1 vs 2 | 2 |
| 5 Shift end paths | Partial (no planned-end close) | DEL-5 | 1 | 1 |
| 6 Location pings, ring, latest | Covered in build | DEL-5, DRV-3, WEB-6 | 1 | (Q-26 open) |
| 7 Trails and retention | Covered in build | DEL-5 | 1 | 11 |
| 8 Stale-tracking alert | Defined; no channel | DEL-5; DEL-21 proposed | 1 | 12 |
| 9 Driver groups and site scope | Missing groups; scope conflict | none; A3 proposed | open | 3, 4 |
| 10 Compliance documents | Missing | DEL-22 proposed | 2 (FCOV) or 1 (FDF) | 5, 6 |
| 11 Onboarding, training, pre-shift check | Missing | DRV-9 proposed | after DRV-3 | 9 |
| 12 Performance scorecards | Partial (reports only) | DEL-17, WEB-18 | 4 | 10 |
| 13 Pay statements and incentives | Partial (no incentives) | DEL-13 | 2 | 10 |
| 14 Cash block | Covered; plan references stale | DEL-11 | 2 | 15 |
| 15 Attendance | Partial (no rules or report) | DEL-5 data; no order | open | 7, 13 |

## Unanswered

1. Should an active shift end at `planned_end`, and after what grace? DM §3.17 is silent; P5 §7 covers only the no-show grace. Owner.
2. Which wave owns `planShift`: DEL-5 leg 1 (wave 1) or the contract and DEL-10 (wave 2)? Lead.
3. Do site managers see and assign only their site's drivers? P4 §8.2 #14 and P5 §2.7 conflict, and `roles.yaml` gives no site role a driver permission. Owner and lead.
4. Are driver groups needed beyond the home site (proposal A3)? Owner.
5. Compliance documents: block or warn on expiry; which document types apply to own-fleet motorcycles and vans; the retention and PDPL basis for identity and Iqama numbers [FCOV Q8; FDF Unanswered 1–2]. Owner and counsel.
6. Do TGA or Wasl registration, or CST tracking-service rules, reach own-fleet couriers who use phone trackers [RES-1; TSF Unanswered 8–9]? Research, then owner.
7. Which working-hour, rest and overtime rules apply to planned shifts, and who computes overtime in DEL-13? Counsel to confirm against the official text. Owner and counsel.
8. Are driver phones company-owned (which needs MDM) or personal [FDF Unanswered 10]? Owner.
9. Are onboarding and training required by merchants or by the regulator [FDF Unanswered 11]? Owner.
10. Pay policy, incentive rules and driver-visible earnings [FDF Unanswered 12; Q-32]. Owner.
11. Trail and position retention: 90 days (Q-5) or the two-year proof period [DM §9 Q5]. Owner.
12. Who receives the stale-tracking and cash-block alerts, and after what delay they escalate [FCOV Q9]. Owner.
13. Should pause intervals be stored on the shift, for attendance? Lead.
14. Should trail and position reads be audited? No document specifies it. Lead and owner (PDPL).
15. Plans P4 §6 and P5 §2.4 cite DEL-8 for the cash block; RM gives DEL-8 to recipient tracking. Lead (a plan correction, not an owner question).
16. The Arabic press reports of TGA delivery-platform conditions have no confirmed dates or official text. Check the TGA and Wasl sites before DEL-22 or RES-1 are scoped. Research.

## Sources

Repo (read 2026-11-02 at `origin/main` b58760d):

- [DM] `docs/architecture/domain-model.md`
- [DA] `docs/architecture/data.md`
- [DRV] `docs/architecture/driver-app.md`
- [INT] `docs/architecture/integrations.md`
- [ADR-n] `adr/000n-*.md`. Read in full: ADR-0005, 0007, 0009, 0028, 0039. Cited by number from other repo documents (titles only, not re-read): ADR-0002, 0008, 0018, 0019, 0023, 0036, 0037, 0041.
- [OAPI] `docs/contracts/openapi/staff-delivery.yaml`
- [P4] `docs/orders/DEL-4/plan.md` (§0–2, §6, §8.2 adversary rulings #8–#41)
- [P5] `docs/orders/DEL-5/plan.md` (§0–2, §2a, §7; §9 has no ruling yet)
- [RM] `docs/roadmap.md` (§0, §1 rows, §4 Q-rows, §5 A-18)
- [ROLES] `docs/contracts/roles.yaml`; [PERM] `docs/contracts/permissions.yaml`

Research notes (remote branches, read 2026-11-02 with `git show`):

- [FDF] `origin/docs/feature-coverage:docs/research/features-driver-fleet-alerts-2026-11.md` (source ids S1–S34 are inside that note)
- [FCOV] `origin/docs/feature-coverage:docs/research/feature-coverage-2026-11.md`
- [PCMP] `origin/docs/platform-teardowns:docs/research/platform-comparison-2026-11.md`
- [TSF] `origin/docs/platform-teardowns:docs/research/teardown-safee-2026-11.md` (source ids S1–S26 inside the note)
- [TWS] `origin/docs/platform-teardowns:docs/research/teardown-wasal-2026-11.md`
- [TSH] `origin/docs/platform-teardowns:docs/research/teardown-shipsy-2026-11.md`

Web (search summaries read 2026-11-02; pages not opened unless stated; treat as secondary):

- [WL1] https://ksaexpats.com/working-hours-and-overtime-per-saudi-labor-law ; https://blog.zenhr.com/en/overtime-calculation-in-saudi-arabia-a-complete-guide-2025-update (Art. 98, 99, 106, 107; Ramadan limit)
- [WL2] https://www.qoyod.com/en/learn/working-hours-weekly-rest-saudi-labor-law/ ; https://www.rivermate.com/guides/saudi-arabia/working-hours (rest break after five hours; 30 minutes; not confirmed against the official text)
- [WL3] Saudi Labour Law Art. 98 and Art. 107 as summarised in WL1; official text (Royal Decree M/51) not opened.
- [WL4] Arabic press search summary, 2026-11-02: https://www.aleqt.com/2024/10/14/article_2751380.html ; https://www.okaz.com.sa/economy/na/2253890 ; https://www.alwatan.com.sa/article/1144057. Each claim is not attributed to one link; dates unclear; TGA text not opened.

Gaps in the sources (also in Unanswered 16): no Absher, Tamm, Naql or Wasl integration documentation was found; the TGA's delivery-platform regulation was not opened; no MDM vendor was researched.
