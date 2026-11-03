# Feature book against the roadmap · 2026-11-02

**Folded into `docs/roadmap.md` on 2026-11-03 (amendment A-28).** The roadmap is now the authority; this note stays as the record of the comparison.

How `docs/roadmap.md` (as merged at 6ca087e) holds up against the fourteen feature-book chapters. Counts come from the chapters' feature indexes (283 feature rows): **91 covered by a roadmap row as written, 100 partial (a row exists but the shape or scope changes), 92 missing (no row)**. By module the picture is uneven: the driver field loop and the platform console are mostly covered; hubs (9 of 10 missing), WMS inbound (none fully covered), compliance and alerts (13 of 30 missing) and returns (6 of 15 missing) are the thin areas.

## 1. Wave by wave: what the book changes in each roadmap row

Verdicts: **keep** (the row's "Delivers" column stands), **amend** (the same order, with named additions or corrections), **split** (part of the row moves), **new** (a row the roadmap lacks).

### Wave 0 (21 orders, 20 merged)

| Row | Verdict | What the book adds or corrects |
|---|---|---|
| PLAT-7 audit | amend | the row says "list and export" but PLAT-7 deferred the export; an export door is owed (chapter 12) |
| PLAT-12 accounts | amend | the per-site stock summary and reservation scope are design facts to fix before WMS-3 (chapter 08, 10); the read-only trial state is distinct from `suspended` (chapter 12) |
| PLAT-13 provisioning | keep | the provisioning trio is now DEL-1's; the console follow-ups are in the ledger |
| PLAT-14 observability | amend | a status page and incident communication have no row (chapter 14) |
| WEB-4 console | keep | the follow-ups listed at its close |
| OPS-1 host | amend | Q-10's Bahrain default must be reread against the PDPL draft's in-Kingdom storage duty before any deploy (chapters 12, 14) |
| OPS-2 backups and runbooks | amend | a breach runbook with the notification clock, a key-rotation drill, DR targets (chapter 14) |
| everything else | keep | |

### Wave 1 (25 orders; DEL-1, DEL-4, INT-2, INT-4, WEB-3, WEB-4 merged)

| Row | Verdict | What the book adds or corrects |
|---|---|---|
| INT-1 storage | keep | blocked on OPS-1; DEL-3 and DEL-7 wait on it |
| INT-2 geocoder | keep | chain per country later (ADR-A) |
| INT-3 recipient messages | amend | the row assumes Meta approval while ADR-0041 sends text through the engine: the plan, integrations §2.4 and §5 and the wave exit box must agree; the 3,000-a-month default budget is two days at the §5.6 profile; opt-out quick replies do not exist on the engine and inbound callbacks have no owner; `order_out_for_delivery` promises an ETA window wave 1 cannot produce; the recipient OTP template is missing (chapter 05) |
| INT-4 push | keep | a `run_changed` template for transfers later (chapter 02) |
| DEL-1 zones | keep | official boundary source still open (chapter 02) |
| DEL-2 orders | amend | "auto-override" reads "auto-accept"; `awaiting_review` is set by nothing (an approval state is owed, ADR-C); holds and tags (DEL-31) hang off it; a parcel-count field; the own-fleet label door `getOrderLabel` is in the contract at wave 1 but no row builds it (DEL-20) (chapter 01) |
| DEL-3 CSV import | keep | |
| DEL-4 drivers | amend | `['dispatcher','driver']` and `delivery.cash.read` conflict with the driver-role rule; the PIN window text in Q-15 and the plan cites DEL-8 and 120 s while the contract uses the H1 signal (chapters 04, 06) |
| DEL-5 shifts | amend | `planShift` is wave 2 in the contract, DEL-10 and WEB-9 but wave 1 here; site roles hold no location permission while the position doors are site-scoped; the planned-end auto-close is now in the adversary fix (chapter 04) |
| DEL-6 dispatch | amend | an assignment gap setting; transfer as an assignment change; the un-assign arrow reserved (chapter 02; already in the DEL-6 plan) |
| DEL-7 field events | amend | COD prefilled from the order with confirmation; a required-proof set per reason validated at the door; a `scan` proof kind; the cash block from a PIN replay has no clearing door until DEL-11 (chapters 03, 06) |
| DEL-8 tracking | amend | display modes and a queue-position notice after INT-6; never lookup by phone; the 48-hour purpose tokens cannot cover a 7-day return window (chapters 05, 07) |
| PLAT-16 RLS on | keep | |
| DRV-1 shell | keep | driver-app §5.3, §7.1, §12.4 are stale against the contract (chapter 03) |
| DRV-2 outbox | keep | |
| DRV-3 location | amend | RES-1 (Wasl and CST applicability) before it ships (chapter 04) |
| DRV-4 field loop | amend | proof capture for recipient OTP, ID check and scan (DRV-8); navigation hand-off; a geofenced drop warning (DEL-26) (chapter 03) |
| DRV-5 push | keep | |
| DRV-6 Maestro and EAS | keep | |
| WEB-5 orders screens | amend | bulk actions with per-row results; labels (chapter 01) |
| WEB-6 zones and drivers | keep | its plan already carries the map and the gate |
| WEB-7 board | amend | the exception list (DEL-33) and the alert surface (DEL-21) land here |
| WEB-8 tracking page | amend | logo in wave 1 or branded tracking later (WEB-20): an owner ruling |
| OPS-3, OPS-4 | keep | |

### Wave 2 (16 orders)

| Row | Verdict | What the book adds or corrects |
|---|---|---|
| DEL-9 slots | amend | service levels with cutoffs and service days belong beside it (DEL-32) |
| DEL-10 auto-dispatch | amend | preview then confirm (pulled from DEL-16), the assignment gap, a bounded wave rule; `planShift` arrives here per the contract |
| DEL-11 handovers | amend | the cash-block clearing door may need to move to wave 1; liability for goods needs a reason enum ruling (chapters 06, 07) |
| DEL-12 deposits and reports | amend | the contract's deposit-reversal path moves custody backward and breaks a CHECK: fix the contract, not the ledger; `DepositRequest` requires a slip link on every deposit (chapter 06) |
| DEL-13 pay statements | keep | no incentive or hours rule exists; labour-law touchpoints are owner questions (chapter 04) |
| DEL-14 reschedule and pin | amend | delivery instructions (DEL-19) and the return request (DEL-28) touch its tokens |
| DEL-15 diagnose | keep | |
| INT-5, INT-6 routing | keep | time windows and the delay alert (DEL-25) follow INT-6 |
| INT-7 messages wave 2 | amend | `cash_block_notice` is a dispatcher message, not a recipient one: move it to DEL-21 |
| DRV-7 cash screens | keep | |
| WEB-9, WEB-10, WEB-11, WEB-12 | keep | WEB-10 gains the merchant cash view (DEL-23) |
| OPS-5 cash runbooks | keep | |

### Wave 3 (12 orders)

| Row | Verdict | What the book adds or corrects |
|---|---|---|
| WMS-1 locations | amend | inter-site stock transfers (WMS-15) and location and tote labels; a per-site summary (WMS-19) is a precondition (chapter 08) |
| WMS-2 catalog | amend | variants (WMS-9) before WEB-13; expiry exclusion from available; GS1 and SASO fields by ruling |
| WMS-3 ledger | amend | **design fix first**: the summary is keyed by account and product; `on_hand` counts totes, docks and transit; the reservation guard is account-wide (WMS-19) |
| WMS-4 inbound | amend | quality hold as a quarantine movement, a locked put-away list, the over-receipt tolerance stored somewhere, receipt timestamps, SFDA and SASO fields, supplier returns (chapter 09) |
| WMS-5 counts | amend | count types with recount-until-agree, per-SKU schedules (WMS-14) |
| WMS-6 picking | amend | ordered allocation rules with a default, partial fulfilment with backorder lines, tote per order (one tote per task today), pick strategies and FEFO (WMS-10), short-pick and quarantine reasons, pick lines carrying the fulfilment-line id (chapter 10) |
| WMS-7 packing | amend | item verification scan, box catalogue, packing slip (WMS-11); COD on the package, not the order; the own-fleet label defined; handoff scan; pack-time carrier and label rules (INT-16) |
| INT-8 carriers | amend | the carrier-event harmonisation table with AWB sync back; carrier choice by rules over `quote`; carrier COD settlement (INT-17) in wave 4 |
| WEB-13, WEB-14, WEB-15 | amend | WEB-15 is web-only while the market runs on handhelds: the ADR-F decision (WMS-18) |
| OPS-6 | keep | |

### Wave 4 (12 orders)

| Row | Verdict | What the book adds or corrects |
|---|---|---|
| INT-9 public API | amend | the resource split orders, shipments, warehouses; a key-issue screen; a read surface for routes and stops; the pen test gate (SEC-1) before it |
| INT-10 webhooks | amend | health states, no silent discard, an updated-since read; the no-PII payload test (INT-18) |
| INT-11 channels | amend | the mapping gate before the first sync, a failed-log view; never a merchant password; Zid's secret in Basic Auth and Salla's unsigned-timestamp signature shape the replay defence (chapter 13) |
| INT-12 stock publish | amend | per-channel buffer; tracking push-back; replenishment later (INT-13) |
| DEL-16 rungs 2 and 3 | split | preview-then-confirm and re-solve may move earlier (owner decision) |
| DEL-17 scorecards | amend | cuts by carrier, zone, city and driver; missed-SLA counts; scheduled exports (RPT-1) |
| DEL-18 returns and exchange | amend | exchange with two money fields (DEL-34), the check-in capture count and condition earlier, the recipient return request (DEL-28), COD reversal (ADR-D), claims (DEL-27) |
| WMS-8 WMS returns | amend | the row cites W-7 instead of W-17; `delivery_return` is missing from the `createReturn` enum |
| WEB-16, WEB-17, WEB-18 | keep | |
| OPS-7 integrator docs | keep | the sandbox model is an open question |

## 2. New rows the roadmap lacks (from the index's registry)

| Wave | New rows | Count |
|---|---|---|
| now (decisions) | ADR-A country and currency, ADR-B driver languages, ADR-C holds and approval, ADR-D custody reversal, ADR-E hub kind, ADR-F handheld app, ADR-G billing; OPS-8 ZATCA research; RES-1 Wasl and CST | 9 |
| 1 exit | PDPL-1 | 1 |
| 2 | DEL-19 intake hardening, DEL-20 labels and bulk, DEL-21 notification centre and dispatcher alerts, DEL-22 compliance documents, DEL-23 merchant cash view, DEL-24 batching, DEL-25 time windows, DEL-26 geofence warning, DEL-31 holds and tags, DEL-32 service levels and templates, DRV-8 proof capture, DRV-9 pre-shift check, DRV-11 languages, DRV-12 SOS, BILL-1 to BILL-3, RPT-1 exports, VEH-1 | 18 |
| 3 | WMS-9 to WMS-15, WMS-18 handheld app, WMS-19 per-site summary (before WMS-3), DEL-27 claims, DEL-29 ratings, INT-16 pack-time rules, SEC-1 | 13 |
| 4 and later | DEL-28 return request (or 2), DEL-30 partial delivery, DEL-33 exception rules (or 2), DEL-34 exchange money fields, WMS-16, WMS-17, HUB-1 to HUB-3, INT-13, INT-14, INT-15, INT-17, INT-18, WEB-20, CARR-1, DRV-10 | 17 |

Sizing effect at the roadmap's cadence (§3): wave 2 grows from 16 to about 34 orders, wave 3 from 12 to 25, wave 4 from 12 to about 29. Waves 2 and 3 as written cannot hold the additions at four and six weeks; either the additions split into a wave 2b and 3b, or the owner cuts by ruling (the scope questions in the index §4 remove whole groups: hubs, 3PL, carrier aggregation, partial delivery, B2B).

## 3. Roadmap text defects to fix in the next amendment (no design decision needed)

- DEL-2 "auto-override" should read "auto-accept".
- INT-7 lists `cash_block_notice` as a recipient message; it goes to dispatchers.
- WMS-8 cites W-7; the WMS returns item is W-17.
- DEL-5's `planShift` wave disagrees with the contract, DEL-10 and WEB-9.
- Q-15 and the DEL-4 plan cite DEL-8 for the cash block and a 120-second window; the block is DEL-11's and the contract uses the H1 signal.
- The wave 0 and wave 1 exit boxes assume WhatsApp template approval that ADR-0041 removed.
- The registry's A-25 marks integrations §2.4 and §5 amended while the text still describes the Meta model.
- ADR-0007's Logestechs citation and ADR-0011's "no WMS" statement are unverified against today's public pages.
- ADR-0031 and ADR-0033 still read "proposed" while merged orders are bound by them.

## 4. Where the roadmap is right and the book changes nothing

The critical path (DEL-1 → DEL-2 → DEL-6 → DEL-7 → DRV-4 → DRV-5 → UAT-2 → DEL-11 → DEL-12) survives every chapter; no new row sits on it except WMS-19 before WMS-3 on the WMS path. The ledger discipline, the outbox, the token tenancy, Standard Webhooks and the offline driver loop are the parts every teardown found stronger than the market. The additions are breadth (holds, alerts, documents, billing, compliance, the handheld floor, hubs), not a change of spine.

## 5. Suggested amendment order

1. Rulings on the index §1 (ten decisions) and the scope questions; each "no" removes rows from §2.
2. The seven ADRs, drafted by the lead after the rulings.
3. One roadmap amendment PR: the text defects of §3, the amended rows of §1 with new "Delivers" text, the new rows of §2 placed in waves 2b and 3b if the owner keeps them, the register rows for the new questions, and the sizing table.
4. Plans for the wave 1 amendments first (INT-3's messaging model, DEL-7's proof gating and COD confirmation, DEL-8's token purposes), since those orders are next to build.
