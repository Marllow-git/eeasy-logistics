# Platform teardowns: ShipHero and eight KSA-operating platforms · 2026-11-02

Consolidated by the architecture lead from `ksa-platform-census-2026-11.md`, `shiphero-teardown-2026-11.md` and the eight `teardown-<platform>-2026-11.md` notes (all read on 2026-11-02; every fact below is cited inside those notes, with confidence marks). It extends `feature-coverage-2026-11.md`: that note maps the market's feature lists against the roadmap; this one maps how nine specific products build those features and what to borrow. Proposals only; the roadmap changes after owner rulings through amendment rows.

## 1. The nine platforms at a glance

| Platform | Category | KSA evidence | Public API | Arabic UI | Pricing | Teardown verdict |
|---|---|---|---|---|---|---|
| ShipHero | WMS and fulfilment network (US) | none | GraphQL, credits and rate caps, HMAC webhooks with health | no | unpublished | the deepest WMS reference: allocation rules, holds, automation rules, lots |
| Logestechs | last-mile and fulfilment SaaS | Riyadh HQ, Arabic site, Salla and Zid connectors named | REST with one admin-issued key; webhooks unsigned, no retries, carry phone and PIN | yes | pay as you go, no figures | the closest regional comparable; its API is a negative example for ours |
| Shipsy | dispatch, hubs and linehaul, WMS (enterprise) | 2023 Riyadh HQ, Monsha'at MoU, Zajil testimonial | private, sales-gated | unknown | unpublished | the hub network reference |
| Wasal | last-mile SaaS for own fleets | Arabic-only site, SAR plans | REST and webhooks (docs and live host disagree) | yes | 469 and 750 SAR per month published, two models conflict | the closest to our own-fleet model and the only SAR pricing |
| Safee | fleet telematics with a last-mile module | Wasl (TGA), Madinati (Jeddah), CST approval | none public (release notes only) | partial | unpublished | the Saudi compliance reference, not a product comparable |
| Omniful | OMS, WMS, TMS, POS suite | Riyadh HQ, Arabic-primary site, Zid and noon connectors | docs unreadable; `seller_code` in the path | yes | conflicting | the closest regional WMS and OMS suite |
| Anchanto | OMS, WMS, control tower (Singapore) | Riyadh office, PPTCO, MR DIY, Naqel connection | password-gated | no | unpublished | site routing rules and carrier-event harmonisation |
| Fulfillor | multi-client 3PL WMS (US entity, Gulf sales) | regional landing page, Salla and ASYAD connectors | none public | 17 languages, RTL unstated | unpublished | lots and FEFO, COD settlement classes |
| Torod | shipping aggregator with fulfilment | Riyadh, Salla and Zid, 240+ carriers | reference exists, operations did not load | yes | SAR, no figures | aggregator model; automation rules and the COD ladder |

Census corrections recorded by the teardowns: Shipsy has a 2023 Riyadh HQ and a dated MoU; Fulfillor is Gulf-wide, not Saudi-only; Safee's Madinati covers Jeddah only and its docs site holds release notes; Omniful's site is Arabic-primary; Torod's API reference exists but is unverified. Two of our own citations need rechecking: ADR-0007 credits Logestechs with a COD settlement report and deficit ledger that its public pages do not show, and ADR-0011 says Logestechs has no WMS while its site now sells one.

## 2. Patterns the market converges on (seen in three or more teardowns)

| Pattern | Seen in | What it is | Where it lands for us |
|---|---|---|---|
| Handheld warehouse app, offline | ShipHero, Anchanto, Fulfillor, Omniful, Shipsy | receive, put-away, pick, pack, count on Android or iOS scanners; the web is the office | a new app order on the DRV-2 outbox pattern (needs an ADR beside ADR-0021); our WEB-15 bench is web-only |
| Ordered first-match rule lists | ShipHero (allocation, automation), Anchanto (site routing), Omniful (carrier choice), Torod (pack-time rules) | conditions and actions evaluated in order with a default rule, dry run, and the chosen rule logged | WMS-6 allocation, INT-8 carrier choice at pack, a bounded rule engine behind the allowlist (ADR-0006), never pricing |
| Order holds as flags with reasons | ShipHero, Omniful, Logestechs (approval states) | a hold blocks offers and allocation, never rewrites events; set and release audited | DEL-2 amendment and WMS-4 |
| Inter-site transfer orders | Anchanto, Omniful, Fulfillor, Shipsy, Logestechs | a transfer document with its own movements through `transit`, two receipts, approval | WMS-15 in `feature-coverage` (stock) and HUB-1 (parcels) |
| Lot capture and FEFO | ShipHero, Fulfillor, Anchanto, Shipsy | expiry-aware allocation, the lot actually picked written at pick time, expiry alerts | WMS-10 in `feature-coverage` |
| Proof gating per reason, POD policy | Shipsy, Wasal, Safee | the Deliver action is server-validated against a required-proof set; a workspace policy with per-stop override; scan proof with a handoff record | DEL-7 and DRV-4 amendments |
| COD from the order, statement and settlement ladder | Shipsy, Torod, Fulfillor, Wasal | the driver confirms rather than types the amount; a merchant view with under review, collected, handed over, reconciled; settlement matched from the order with difference classes | DEL-7 amendment; DEL-23 in `feature-coverage`; a carrier-settlement order beside INT-8 |
| Exceptions and missed-SLA rules | Shipsy, Anchanto, Safee, Torod | reason catalogues with rules that reschedule, return or alert; KPI panels with week-on-week change | DEL-21 and DEL-17 amendments |
| Connector mapping before sync, failed-log view | Omniful, Anchanto, Logestechs | a connection maps statuses and warehouses before the first sync, with a failed log and manual re-sync | INT-11 amendment on PLAT-8's dead letters |
| Webhook health and reconciliation | ShipHero (health states), Wasal, Logestechs (as the negative example) | health per endpoint, alerts, an updated-since read to reconcile missed events | INT-10 amendment; our Standard Webhooks signing stays |
| Preview then confirm for auto-dispatch | Wasal, Shipsy | select drivers, preview the distribution with ETAs, commit | DEL-10 with DEL-16's simulate contract |
| Plans, counters, trial | Wasal, Torod, ShipHero | base stops or orders per month, overage, a read-only trial | the BILL track in `feature-coverage` |

## 3. Where our design is stronger (consistent across the nine)

The append-only stock ledger with database-enforced invariants (ADR-0011), the append-only cash custody with a PIN at handover and cash-blocked drivers (ADR-0007, ADR-0034), the idempotent offline outbox with replay rules (ADR-0008), tenancy from the token (ADR-0025; Omniful puts the seller code in the path), Standard Webhooks signing (ADR-0040; Logestechs sends a static password in headers and a PIN in the payload, Wasal signs the raw body only), token-only recipient tracking (Torod looks up by phone), and Arabic-first RTL with a census in both languages (ADR-0016). No platform read publishes a ledger or custody model. These are stated designs, not shipped comparisons, until wave 1 exits.

## 4. Consolidated proposals (ids continue `feature-coverage-2026-11.md` §3; "amend" changes an existing row)

**Amendments to planned orders**
- DEL-2: order holds as flags with reason codes and audit rows; the approval and cancel-before-pickup states named in one table with Q-6.
- DEL-7 and DRV-4: COD amount from the order with driver confirmation; a required-proof set per reason validated at the event door; a `scan` proof kind with a handoff record; a workspace POD policy with per-stop override and PDF export; navigation hand-off to the device's map app.
- DEL-8 and WEB-8: tracking display modes (ETA only, or ETA with queue position) and a "next in queue" notice as an INT-3 template; an account logo setting; never lookup by phone.
- DEL-10: preview then confirm; an assignment gap setting (default 60 s) to stop flapping.
- DEL-17: cuts by carrier, zone, city and driver; week-on-week change; missed-SLA counts; scheduled exports.
- WMS-4: receiving holds (with WMS-12) and a locked draft put-away list.
- WMS-5: count types (location, item, recount until two agree) and per-SKU count frequency (with WMS-14).
- WMS-6: ordered first-match allocation rules per site with a default, whole-order or per-line scope, partial fulfilment with backorder lines; tote per order as the picking unit; short-pick and quarantine exceptions as reasons on hold (with WMS-10 and WMS-11).
- WMS-7: item verification scan at pack and a per-site box catalogue (with WMS-11).
- INT-8: a visible, versioned per-carrier event-harmonisation table with AWB sync back; carrier choice by rules over the existing `quote` port at pack time.
- INT-9: the resource split orders, shipments, warehouses; a key-issue screen (one key per account, one-time reveal, regenerate, disable); a read surface for routes and stops.
- INT-10: webhook health states with alerts through the outbox, no silent discard while disabled, an updated-since reconciliation read; a test that no payload carries a phone, a PIN or a signed link.
- INT-11: mapping of statuses and warehouses before the first sync, a failed-log view with manual re-sync; SKU and stock checks at intake; never a merchant password in a connector.
- INT-12: a per-channel buffer at publish; tracking push-back to the channel after dispatch.

**New orders (beyond `feature-coverage` §3)**
- DEL-31 Order holds and tags: holds as above plus staff labels and bounded conditional tags (origin city, weight, package count); no trigger engine. After DEL-2.
- DEL-32 Service levels and route templates: a named service per site (cutoff, SLA days, service days) feeding intake and reports; route templates and route copy. After DEL-6, DEL-9.
- DEL-33 Exception rules: a per-account reason catalogue with rules that reschedule, return or alert, and an exception list on the board. After DEL-14, DEL-18, DEL-21.
- WMS-18 Warehouse handheld app: receive, put-away, pick, pack, count, Arabic and English, offline on the DRV-2 pattern; needs an ADR beside ADR-0021 and an owner choice between a native app and a web scanner-first bench. Wave 3.
- INT-15 Carrier COD settlement reconciliation: expected COD from the delivery outcome, matching from the order, seven difference classes. After INT-8, DEL-12; wave 4.
- INT-16 Pack-time carrier and label rules: ordered rules on zone, weight band, COD flag and shipment type choosing own fleet or an INT-8 option, auto-print, dry run, behind the allowlist. After WMS-7, INT-8.
- DRV-12 Driver SOS: one action sends the last known position and the active order to dispatch. After DEL-5, DRV-5.
- VEH-1 Vehicle service tasks (date and odometer) with overdue warnings; owner's choice of wave.
- RES-1 Research: whether Wasl (TGA) registration and CST tracking rules reach own-fleet couriers on phone trackers. Before DRV-3 ships.
- OPS-8 Research: ZATCA phase 2 waves, EGS and CSID, and whether our merchants or Eeasy are in scope. Before any BILL order.

## 5. Owner questions the teardowns add (beyond `feature-coverage` §4)

1. A warehouse handheld app (native, offline) or a web scanner-first bench on rugged devices? Five of nine platforms run the floor on handhelds.
2. Multi-client 3PL in scope (Fulfillor, Anchanto, ShipHero bill per client)? ADR-0002 and ADR-0005 say own stock only.
3. Hubs: a new ADR superseding ADR-0018's site kinds (branch, warehouse, both) to add a hub, if the hub network is ruled in.
4. The exchange shape (Q-4): Logestechs's `SWAP` and `BRING` carry two money fields (collect from and pay to the recipient).
5. Does Wasl or CST compliance reach own-fleet motorcycle couriers (RES-1)?
6. Partial fulfilment default on or off, and may one order ship in two packages?
7. Locate the 2026-09-21 research behind ADR-0007's Logestechs claim, or commission a login-gated census, before the ADR is cited again.

## 6. Limits

No logged-in access anywhere; the enterprise APIs of Shipsy, Anchanto and Omniful were unreadable; Torod's and Wasal's live hosts disagree with their docs; pricing is published only by Wasal. Regional customer claims are mostly vendor or search-summary facts and are marked so in the notes.
