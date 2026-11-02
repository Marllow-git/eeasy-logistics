# Feature book 14 · Analytics, alerts, compliance and security

Date: 2026-11-02. Status: research input for the lead; no decision taken. Scope: operations analytics and reports, merchant and dispatcher alerts, privacy and sector duties (PDPL, residency, messaging rules, ZATCA cross-reference), and the security programme for eeasy-logistics (Saudi Arabia and the GCC). Sources were read on 2026-11-02 unless the source list gives another date. Not legal advice: regulatory rows say what the sources state and flag what counsel must read.

## Summary for the lead

1. Analytics: the report data model exists (data §9 views and `rpt_daily_kpis`) and DEL-17, DEL-12 and WEB-10 read it. No order builds KPI tiles, exports, scheduled reports or BI access. RPT-1 (proposed, RN3) splits them into wave 2 (exports, tiles) and wave 4 (scheduled reports); that split is new.
2. Alerts: PLAT-14 (merged) ships 30 alert rules as `observability/alerts.yaml`, but no rule has a channel until OPS-1 (owner go, Q-10, Q-12). The merchant and dispatcher notification centre is in no order; RN3 proposes DEL-21 for wave 2, RN2 proposes DEL-20 for wave 1.
3. Low-stock alerts (WMS-13, wave 3 proposed) and the status page with incident communication (SEC-1, proposed) are in no order.
4. PDPL: no order covers records of processing, data subject requests, breach notification or transfers. RN3 proposes PDPL-1 as a wave 1 exit item before real recipient data. The official text was not readable (SDAIA site rejected on 2026-11-02, RN1), so the duties below are secondary-source readings.
5. Draft amendments (consultation 6 October to 5 November 2026; in force 60 days after Gazette publication) would add an in-Kingdom storage duty for controllers (Art 23, G1). ADR-0022 and Q-10's default allow a Bahraini region. If adopted as summarised, a Bahraini primary or a non-Saudi backup region would not fit. Reopen Q-10 before OPS-1 goes.
6. Breach: OPS-2 lists no breach runbook. The 72-hour SDAIA clock appears in both the current secondary reading and the draft; the harm threshold is disputed between sources (G1 to G3).
7. Security: no order covers the NCA CCC-2:2024 gap assessment, ISO 27001, SOC 2 or penetration testing. Whether Eeasy is a cloud service provider or a tenant under CCC-2 is unknown (U-12). RN3 gates a penetration test before INT-9 (wave 4).
8. Items to settle before the pilot: U-1 controller or processor; U-2 hosting region against the draft; U-3 breach clock and runbook; U-4 recipient retention (Q-37, Q-38); U-5 lawful basis; U-6 transfer register; U-7 driver document scans if DEL-22 is ruled in.
9. Numbering: DEL-19 to DEL-21 mean different things in RN2 and RN3. This chapter uses RN3 ids; the next roadmap amendment must pick one set.
10. ADR-0036 (outbox kinds, storage lifecycle, deletion audit) and ADR-0037 (templates only) are still proposed and are wave 0 exit items (roadmap §0). Retention jobs and messaging rules depend on them.

## Method and source keys

- Repo inputs are cited by path and section. Research notes and teardowns are cited by key (RN1 to RN4, TD-A, TD-S, TD-Sh, TD-SH, TD-W, TD-L); the key list is at the end.
- Labels: [S] stated by the source read; [I] inferred by the researcher; [U] unverified (secondary, search excerpt or vendor claim); "Not found" means no source settled it.
- Each aspect is one numbered paragraph. "Shape on the table" in aspect 9 is for the lead to decide; it is not a recommendation of this chapter.

## Part A · Analytics and reporting

## 1 Operations dashboard and KPI tiles

1. **Definition and user goal.** A dispatcher or site owner sees the day's state at a glance: open, assigned, out for delivery, delivered, attempted and failed counts, COD held, proofs pending and drivers on shift, per site and business date [RN3 §3; WEB-7]. Onfleet keeps dashboards 90 days on Launch and to lifetime on Enterprise [RN1 S14].
2. **Workflow.** Open the board (WEB-7). Tiles read the "today" views (`rpt_site_day`, `rpt_driver_day`); the board updates from the event stream with polling fallback (ADR-0009). Exceptions: no site in scope (empty state); stream drop (polling); a day not yet closed is labelled open.
3. **Business rules and edge cases.** "Today" is the Asia/Riyadh business date; the history job fills `rpt_daily_kpis` at 02:00 Asia/Riyadh for the previous day [R2 §9]. Live figures come from plain views, never from materialised views, because PostgreSQL does not apply RLS to them [R2 §9]. Arabic and English labels; Western digits; Gregorian dates [AGENTS.md].
4. **Data.** Plain views `rpt_site_day` and `rpt_driver_day` created `WITH (security_invoker = true)` over orders, attempts, cash and shifts; no table is written for live tiles. History is the table `rpt_daily_kpis` (account id, policy, index) [R2 §9].
5. **Surfaces.** Merchant web dispatch board (WEB-7, wave 1) and owner "today" view. No mail or WhatsApp surface. No API tile endpoint: INT-9 covers orders and tracking only [RN1 §2].
6. **Permissions, roles and audit.** Tiles follow the caller's roles and site scope (PLAT-10 `site_ids`); the account comes from the token (ADR-0025). Reads are not audited: synchronous audit covers admin and ledger-adjacent actions [R5 §7]. A platform reader crossing accounts uses the cross-tenant door, which audits (PLAT-13).
7. **Dependencies and integrations.** Postgres views; Redis fan-out (data §6); PostHog may count tile opens with ids only (PLAT-14 plan 2.8). The outbox is not involved.
8. **Metrics and reporting.** The tiles are the metrics. None of the 30 rules in `observability/alerts.yaml` watches the 02:00 reporting fill [R11]; a missed fill shows only as a gap in `rpt_daily_kpis`.
9. **How the market builds it; shape on the table.** Anchanto's control tower shows KPI panels with week-on-week and month-on-month change for live parcels and missed SLA [TD-A §3.4, A7]. Shipsy lists "Shipsy BI, Advanced" as one knowledge article; depth not read [TD-Sh §2.6]. Shape on the table: borrow the KPI panel with week-on-week change over closed-day history (adapt: history is `rpt_daily_kpis`). Own: reads go through the reporting module only (ADR-0026, data §9).
10. **Roadmap mapping.** Partial. WEB-7 (wave 1) carries the board; no order builds KPI tiles or change over time. RPT-1 proposes tiles in wave 2 [RN3 §3]. Owner questions: U-10 (report scope); Q-32 limits aggregates to read-only reports over existing ledgers and events [roadmap §4].

## 2 SLA and on-time report

1. **Definition and user goal.** The share of orders delivered inside the promised window, cut by site, zone, driver and day. Merchants and carriers use on-time as a contract term [RN1 §3, I]. Anchanto reports missed-SLA counts with week-on-week change [TD-A §3.4].
2. **Workflow.** Not specified in any source read. Open: which promise is compared (first, last or the one agreed with the merchant), and when a missed window is counted (at window close or at terminal state). The report reads the views (DEL-17, wave 4).
3. **Business rules and edge cases.** No KSA source defines on-time. Re-slotted orders and failed-then-returned orders have no rule. Asia/Riyadh applies to the window [roadmap §1 DEL-9 slots].
4. **Data.** No on-time field is named in the data or domain-model sections read. Inputs: order status history (`del_order_events`), slot or window fields (DEL-9) and terminal times [R2 §9].
5. **Surfaces.** Scorecard screens (WEB-18, wave 4). No export, mail or API surface.
6. **Permissions, roles and audit.** Site-scoped read for staff with delivery reporting permission; reads not audited [R5 §7].
7. **Dependencies.** DEL-7 events, DEL-9 slots, Q-32. No external integration.
8. **Metrics and reporting.** On-time rate and missed count per site and carrier-style cut; week-on-week change [TD-A §3.4]. Not defined in any order.
9. **How the market builds it; shape on the table.** Anchanto: missed-SLA reports and alerts for delayed parcels, cut by carrier, country and retailer [TD-A §3.4]. Shipsy: missed-SLA rules with reason catalogues that reschedule, return or alert [RN4 §2]. Shape on the table: report first (DEL-17), alerts later (see B2); the on-time definition as a per-account setting (adapt).
10. **Roadmap mapping.** Covered at row level (DEL-17, WEB-18, wave 4; Q-32). Definition missing; missed-SLA alert missing until DEL-21. Owner questions: U-11 (definition); U-8 (who is alerted).

## 3 Driver scorecards

1. **Definition and user goal.** Per-driver orders delivered and attempted, failed reasons, cash held, liability and shift hours over a period, for performance review and pay checks [R2 §9; RN2 Module 2]. Routific produces end-of-day performance reports, which need Live Tracking [RN2 S16].
2. **Workflow.** Staff select a period; the scorecard reads `rpt_driver_day`; a supervisor reviews. No source defines an automatic action from a scorecard. Exceptions: driver archived mid-period (kept, flagged); shift hours only where a shift exists (DEL-5).
3. **Business rules and edge cases.** Q-32: read-only reports over existing ledgers, no new ledger [roadmap §4]. Cash held comes from custody entries (ADR-0007). Ranking and pay links are not decided; KSA labour-law limits were not sourced [RN2 unanswered 11].
4. **Data.** No new table; view `rpt_driver_day` over `del_drivers`, orders, custody and shifts. Retention follows the driver membership (data §10: life of membership).
5. **Surfaces.** Staff scorecard screen (WEB-18). Driver app shows no performance; driver-visible metrics are an owner decision (RN2 unanswered 12).
6. **Permissions, roles and audit.** Staff with delivery reporting permission and site scope. Pay-linked views (DEL-13) need stricter roles [roadmap §4 Q-32]. Reads not audited.
7. **Dependencies.** DEL-7 events, DEL-11 custody, DEL-5 shifts, DEL-13 statements.
8. **Metrics and reporting.** Proposed metric set: on-time rate, proof completeness and COD variance per driver [TD-S §6 A7].
9. **How the market builds it; shape on the table.** Routific end-of-day reports [RN2 S16]; Shipday performance monitoring [RN2 S7]; Safee proposes on-time, proof completeness and COD variance per driver [TD-S §6 A7]. Shape on the table: adopt Safee's metric set (adapt); no driver ranking in product until the owner rules (U-21).
10. **Roadmap mapping.** Covered at row level (DEL-17 and WEB-18, wave 4). Earlier delivery is an owner ruling [RN2]. Owner questions: U-21; Q-32.

## 4 Cash and COD reports

1. **Definition and user goal.** The cash report per site and business date: COD collected by method, handovers, deposits, deficits and blocked drivers, so the cash desk can close a day [ADR-0007; RN1 §3].
2. **Workflow.** Handover with PIN (DEL-11, ADR-0034) writes custody entries; the cash report closes per site and business date (DEL-12); nightly assertions recompute from the ledger [R2 §3.4]; OPS-5 (wave 2) writes the close-cash-day runbook. Exceptions: a late entry on a closed day is a new entry, never an edit (append-only).
3. **Business rules and edge cases.** Custody is append-only (ADR-0007). A driver holding cash from a previous Asia/Riyadh business day is cash-blocked until a supervisor clears it, with an audit row (D-11 [R4 §3]). COD amounts must sum exactly to the order's COD (D-7 [R4 §3]). The merchant COD statement and reversal rules are not in the roadmap (DEL-23 proposed, RN3).
4. **Data.** `rpt_site_day` (COD by method, deposits); custody and liability entries from DEL-11; `rpt_daily_kpis` history. The cash-record retention period is not set in data §10.
5. **Surfaces.** Cash desk (WEB-10, wave 2); driver cash tab (DRV-7). No export (see A6).
6. **Permissions, roles and audit.** Site cash roles; PIN at handover; supervisor clears blocks; audit rows on blocks and clears [R4 D-11].
7. **Dependencies.** DEL-7 COD collections; INT-1 storage for deposit slips; alerts for blocks (B2).
8. **Metrics and reporting.** COD collected against handed over; deposit lag; open blocks; deficit count. The ledger rule in `alerts.yaml` names the stock and ledger assertion [R11]; no rule names the cash assertion.
9. **How the market builds it; shape on the table.** Logestechs' COD settlement and deficit ledger, credited in ADR-0007, do not appear on its public pages [RN4 §1 correction]. Wasal shows expected, collected and pending COD totals [TD-W]. Shipsy, Torod and Fulfillor use a collected, handed-over, reconciled ladder [RN4 §2]. Shape on the table: borrow the four-state merchant view (adapt); keep the ledger (ADR-0007, ADR-0034).
10. **Roadmap mapping.** Covered: DEL-11, DEL-12, WEB-10, OPS-5 (wave 2). Missing: merchant COD statement and reversals (DEL-23 proposed). Owner questions: U-22 (COD reversal, refund and damage-cost rules).

## 5 Stock accuracy and drift reports

1. **Definition and user goal.** Stock accuracy (counted against system, per location and SKU) and drift (projections against the ledger, and channel publication against stock). The stock team sees where the books and the shelf disagree [R2 §3.4; R3 §10].
2. **Workflow.** Count sessions post variances (WMS-5; event `wms.count_session.posted`, domain §6). Nightly assertions recompute projections from the ledger and alert on difference [R2 §3.4]. Drift is fixed by rebuilding projections from the ledger, not by editing rows [R2 §3.5].
3. **Business rules and edge cases.** Adjustments above the separation-of-duties threshold need a second person (Q-17, per-account, set in WMS-5). Ledger rows are never updated. A drift alert never rewrites the ledger.
4. **Data.** `rpt_stock_position` (plain view over `wms_stock_summaries` with open fulfilment demand and pending channel publications) [R2 §9]; `wms_channel_publications` statuses pending, sent, failed, dead, superseded [R4 §4]. No accuracy table exists.
5. **Surfaces.** Stock screens (WMS chapter). No merchant export or API read.
6. **Permissions, roles and audit.** Count and adjust permissions; separation-of-duties hook (PLAT-10); adjustments audited (PLAT-7).
7. **Dependencies.** WMS-3 ledger and nightly assertion; PLAT-8 outbox for channel publications; INT-12 drift reconcile (roadmap). Alert `ledger_assertion_not_green` pending WMS-3 [R11].
8. **Metrics and reporting.** Count variances per session; projection drift; `channel_publication_drift{connection}` [R3 §10]. Count accuracy percentage is not defined.
9. **How the market builds it; shape on the table.** Anchanto proposes per-SKU count frequency with variances posted as adjustments under a threshold [TD-A §6 P6]. ShipHero uses count types and holds [TD-SH §1]. Shape on the table: borrow per-SKU frequency (WMS-14, proposed); keep drift as rebuild, not edit (ADR-0011).
10. **Roadmap mapping.** Partial. WMS-3 and WMS-5 (wave 3) carry the ledger and counts; OPS-6 (wave 3) writes the drift runbook; WMS-14 proposed. No accuracy report order. Owner questions: Q-17; U-10.

## 6 Exports (CSV and Excel)

1. **Definition and user goal.** Download of orders, events, cash rows, stock and audit rows for operators who work in spreadsheets [RN1 §3]. RN3 names CSV and Excel for finance exports (DEL-23 proposed).
2. **Workflow.** Request; the worker writes the file to `exports/{export_id}` under the account prefix; a signed read URL lasts 5 minutes for staff [R3 §2.6]. The `exports/` prefix is deleted after 7 days [R3 §2.6]. Candidate pattern for long jobs: the DEL-3 import (202 and progress stream) [roadmap DEL-3].
3. **Business rules and edge cases.** Exports carry only fields the role may read (site scope). The platform per-account archive is CSV per table plus proof files, signed URL valid 24 hours [R2 §10]. No source specifies Excel; it appears only in RN3.
4. **Data.** Object prefix `exports/` under `acc/{account_id}/` [R3 §2.6]; no export-job table is defined.
5. **Surfaces.** Orders list has CSV import, not export (WEB-5). WEB-4 leaves audit CSV export out of scope [WEB-4 plan §6]. No export operation exists in the contracts (grep of `docs/contracts/openapi`, 2026-11-02).
6. **Permissions, roles and audit.** Role with the read permission. Platform export writes an audit row on request and on download [R2 §10]. Staff audit export is open (A6 and D6).
7. **Dependencies.** ObjectStorage port (INT-1); worker queue (PLAT-8); signed URLs (ADR-0015).
8. **Metrics and reporting.** Export count and size per account; none defined.
9. **How the market builds it; shape on the table.** ShipHero exports Parquet with FULL and DELTA runs, and signed URLs expire after 24 hours [TD-SH §1.9]. Anchanto exports parcel data [TD-A §3.4]. Shape on the table: CSV first, matching the DEL-3 import; Excel only if the owner rules finance needs it; delta exports are a later question for A8.
10. **Roadmap mapping.** Partial. PLAT-7 platform audit export (wave 1, platform tool only as proposed in PLAT-7 plan open question 1); DEL-3 import. No order exports orders or cash; RPT-1 proposes it for wave 2. Owner questions: U-10; U-17.

## 7 Scheduled reports

1. **Definition and user goal.** A report sent on a schedule to a list of staff, email first, so owners need not log in [RN1 §3].
2. **Workflow.** Not specified. Proposed: owner creates a schedule; a job renders the export (A6) and sends it through the mail adapter; failed sends retry; the schedule carries an owner.
3. **Business rules and edge cases.** WhatsApp carries approved templates only (ADR-0037), so no scheduled report can go by WhatsApp without a template that does not exist [R3 §5.1]. Mail is the only channel. Recipients must be staff of the account.
4. **Data.** No schedule or delivery-log table is defined. Report files follow the 7-day `exports/` rule [R3 §2.6].
5. **Surfaces.** Email (mail adapter, PLAT-9, used today for invitations and resets). Settings screen not planned.
6. **Permissions, roles and audit.** Creation is an admin action, so synchronous audit applies by analogy [R5 §7]. Not stated in any source.
7. **Dependencies.** PLAT-9 mail adapter. An external email send is a side effect, so it must go through the outbox (AGENTS.md; ADR-0024). Mail is not among the outbox kinds named in ADR-0036 as read [ADR-0036].
8. **Metrics and reporting.** Runs, failures and bounces; none defined.
9. **How the market builds it; shape on the table.** Market evidence is thin: no teardown read shows a scheduled email report. Anchanto and Safee propose scheduled exports [TD-A §3.4; TD-S §6 A7]. Shape on the table: one channel (mail), reusing the A6 export pipeline, after U-10.
10. **Roadmap mapping.** Missing. RPT-1 proposes it in wave 4 [RN3 §3]. Owner questions: U-10.

## 8 BI connectors and reporting views

1. **Definition and user goal.** Read access for a merchant's analytics tool or warehouse so orders can be joined with the merchant's own data [RN1 §3, BI connectors row].
2. **Workflow.** Today the only read surface is the reporting module inside the API (`apps/api/src/modules/reporting/`) plus the views [R2 §9]. A BI tool would need a database login or an API route; neither is designed.
3. **Business rules and edge cases.** Views use `security_invoker` so RLS applies [R2 §9]. A direct database login for a merchant would bypass the API tenancy path (ADR-0025, ADR-0031) [I].
4. **Data.** Plain views `rpt_order_fulfilment`, `rpt_site_day`, `rpt_driver_day`, `rpt_stock_position`; table `rpt_daily_kpis`; the `rpt_` prefix is reserved to the reporting job [R2 §9].
5. **Surfaces.** None for merchants. Public API (INT-9) covers orders and tracking only [RN1 §2].
6. **Permissions, roles and audit.** Any connector credential would be an API key with scopes, per-key usage and revocation (INT-9) [roadmap INT-9]; reads not designed for reporting.
7. **Dependencies.** INT-9 keys; Q-13 (static `X-API-Key`, provisional); Q-14 (WMS paths after the pilot).
8. **Metrics and reporting.** Per-key usage (INT-9); none for report reads.
9. **How the market builds it; shape on the table.** ShipHero: Parquet exports, FULL and DELTA by module, with a paid tier of 30-minute deltas [TD-SH §1.9]. Shipsy: BI as one knowledge article [TD-Sh §2.6]. Shape on the table: a delta export job (A6) before any live database login (adapt); the API keeps the tenancy rule (own).
10. **Roadmap mapping.** Partial. The views are defined (data §9) but no order builds the reporting module; RPT-1 places BI "later" [RN3 §3]. Owner questions: U-10; Q-13, Q-14.

## Part B · Alerts and notifications

## 9 Merchant alerts and the notification centre

1. **Definition and user goal.** Staff are told about events that need a person (a failed order, a cash block, a budget threshold, a dead channel publication) in one list with severity, read state and links, and by mail when unread [RN2 Module 3; RN3 DEL-21].
2. **Workflow.** Domain events of §6 map to alert rules with a severity; each alert is written once and fanned out by channel per user setting; acknowledgement closes it; escalation re-notifies a second recipient after a delay if unacknowledged (proposal; Bringg documents no time-based escalation [RN2 S2]).
3. **Business rules and edge cases.** In-app and mail first [RN3 §2]. WhatsApp staff alerts wait for the number ruling (ADR-0041 question) and an approved template; SMS is excluded before wave 3 (ADR-0037). The 80 % budget notice needs this centre [R3 §5.6]. Quiet hours cover recipient messages only [R3 §5.4]; no rule for staff alerts is set.
4. **Data.** No alert or notification table is defined in the data or domain sections read. Each alert row would carry account id, recipient, severity, channel status and acknowledgement time (proposal). Alert text carries first names and amounts, not phone numbers [R3 §11 redaction].
5. **Surfaces.** Web notification list (none planned; WEB-3 home shows modules only [RN2 Module 3]); mail; WhatsApp staff template (future); no API.
6. **Permissions, roles and audit.** Per role and site (PLAT-10). Acknowledgement and channel-setting changes are administrative; synchronous audit applies by analogy with PLAT-7 [R5 §7] [I].
7. **Dependencies and integrations.** PLAT-10 roles; PLAT-9 mail adapter (invitations and resets only today); INT-3 budget counter; PLAT-8 outbox for each mail or WhatsApp send (ADR-0024); push (INT-4) if used on mobile.
8. **Metrics and reporting.** Alerts raised per kind, time to acknowledge, escalations, undelivered mail. None defined; `messages_skipped_total` exists for recipient messages [R3 §10].
9. **How the market builds it; shape on the table.** Bringg: severity levels, in-platform, SMS, email and webhook alerts; no time-based escalation documented [RN2 S2]. Shipday: real-time alerts when a delivery completes [RN2 S7]. Shape on the table: severity and in-app plus mail channels (adapt); escalation timing is an owner decision (U-8); alerts derive from the domain event catalogue (ADR-0027), not a second rule engine (own).
10. **Roadmap mapping.** Missing. Proposed as DEL-21 (RN3, wave 2) or DEL-20 (RN2, wave 1). INT-7 lists `cash_block_notice` as a recipient message, which conflicts with integrations §5.1 (RN2 point 9). Owner questions: U-8, U-9.

## 10 Dispatcher alerts for field exceptions

1. **Definition and user goal.** Dispatchers are told at once when a field fact needs action: a failed order (`delivery.order.failed`), a driver cash block (`delivery.driver.cash_blocked`), a proof still pending 24 hours after delivery (D-17), stale tracking (no point for 5 minutes on an active shift, DEL-5), and an offline conflict (D-23) [R4 §3, §6; roadmap DEL-5].
2. **Workflow.** Each event alerts the home-site dispatchers; the dispatcher acts (reassign, clear block, chase proof, call driver); the alert closes when the resolving event arrives, such as proof stored clearing D-17 (proposal). Exception: no dispatcher online, which escalation (U-8) must cover.
3. **Business rules and edge cases.** D-17: alert, never reverse the delivery [R4 §3]. D-11: block until a supervisor clears it. D-23: field facts win and the dispatcher is alerted [R4 §3]. The 5-minute stale threshold is roadmap DEL-5.
4. **Data.** Alerts derive from events and the outbox (data §5); proof rows with `upload_status = pending_upload` [R4 §3]; driver location heads for the stale check (data §6). No alert table.
5. **Surfaces.** Dispatch board shows status only (WEB-7, RN2); no alert list. WhatsApp `cash_block_notice` to opted-in home-site dispatchers is designed for wave 2 [R3 §5.1].
6. **Permissions, roles and audit.** Dispatcher role with site scope; cash-block alerts may go to supervisors (owner decision).
7. **Dependencies and integrations.** DEL-5 (stale), DEL-7 (proofs), DEL-11 (blocks); the WhatsApp template goes through the `message` outbox kind (ADR-0036).
8. **Metrics and reporting.** Open alerts by kind and site; time to resolve. These are business alerts, separate from platform alerts (B12).
9. **How the market builds it; shape on the table.** Onfleet sends a Task Failed notification and webhook [RN2 S4]; Bringg alerts on failed and cash events [RN2 S2]; Shipsy and Safee gate proof per reason [RN4 §2; TD-S §6 A1]. Shape on the table: failure alerts plus server-side required-proof checks (adapt); the cash block rules come from ADR-0007, which no source matches (own).
10. **Roadmap mapping.** Partial: events and sinks defined (domain §6), DEL-5 and DEL-11 define the conditions, no channel. DEL-21 proposed (RN3). Fix the INT-7 wording before planning. Owner questions: U-8.

## 11 Low-stock alerts

1. **Definition and user goal.** A product or option's available quantity falls below a threshold and staff are told before a sale fails. RN3 calls it the cheapest KSA expectation to miss, because Salla has it natively [RN3 §3, WMS-13; U, not checked on a Salla page].
2. **Workflow.** Threshold set per product and option (WMS-9); `wms.stock.available_changed` carries product, available and on-hand (domain §6); the alert fires once on crossing and re-arms after recovery (proposal).
3. **Business rules and edge cases.** Available quantity comes from the stock projections, not from one movement [R4 §4]. No alert for products without a threshold. Alert values must match the channel publication buffer (INT-12).
4. **Data.** A threshold field on the product is not defined in data §2 as read. Event payload per domain §6.
5. **Surfaces.** Stock screen warning; alert list (B9) once built.
6. **Permissions, roles and audit.** WMS stock read; threshold change is an administrative change and is audited (PLAT-7 pattern) [I].
7. **Dependencies.** WMS-3 projections; PLAT-8 outbox for any mail or WhatsApp send; DEL-21 centre.
8. **Metrics and reporting.** Products below threshold per account; days of cover (not defined in any source).
9. **How the market builds it; shape on the table.** Logestechs names low-stock alerts without a mechanism [TD-L, WMS row, claim only]. Shape on the table: a per-product threshold and option thresholds, derived from the ledger projections (adapt the claim into a mechanism; own).
10. **Roadmap mapping.** Missing. WMS-13 proposed for wave 3 after WMS-3, PLAT-8 and DEL-21 [RN3 §3]. Owner questions: U-16.

## 12 Platform alerts and the alert rules file

1. **Definition and user goal.** On-call alerts for the running system: `/ready` failing, API p95 above 800 ms for 5 minutes, the oldest due outbox row per kind, dead letters, the nightly ledger assertion not green, an OTP failure spike, disk and backup job failures [R1 §7].
2. **Workflow.** Each rule is a metric or log condition evaluated by the host's alerting (OPS-1). Severity `page` wakes the owner; `warn` waits for the next working hour. Each rule names a runbook [R11 header].
3. **Business rules and edge cases.** Per-kind outbox thresholds: OTP 30 s, other messages 2 min, push 1 min, carrier call 2 min [R11]. ADR-0036 alerts on dead `webhook` and `channel_publish` rows by rate, not per row, to avoid paging on merchant endpoints [ADR-0036]. Rules with no emitting code yet stay `pending` until their order lands.
4. **Data.** No personal data in alerts or logs; redactor removes tokens, OTP codes and phone numbers except the last four digits [R3 §11].
5. **Surfaces.** Host alerting console (OPS-1) and the owner's channel [R1 §7]. Not merchant-facing.
6. **Permissions, roles and audit.** Platform operators on the host; Sentry and PostHog receive ids only (PLAT-14 plan 2.5 to 2.8).
7. **Dependencies and integrations.** OpenTelemetry; Sentry with release tags; PostHog; Redis single-leader locks; OPS-1 for routing (waits on Q-10 and Q-12).
8. **Metrics and reporting.** `ready_checks`, `http_request_duration_ms`, `outbox_due_oldest_age_seconds`, `outbox_dead_total`, `otp_failures_total`, `ledger_assertion_drift` [R11; R3 §10].
9. **How the market builds it; shape on the table.** ShipHero publishes endpoint health states (HEALTHY, WARNING, UNHEALTHY) for webhooks [TD-SH §3.6]. No platform read publishes its alert thresholds. Shape on the table: own thresholds (ADR-0036); borrow ShipHero's health states for merchant webhooks (INT-10).
10. **Roadmap mapping.** Partial. The rules merged in PLAT-14 (wave 0, 2026-10-31 to 2026-11-01); routing and host alerting wait for OPS-1. ADR-0036 is still proposed. Owner questions: Q-10, Q-12.

## 13 Status page and incident communication

1. **Definition and user goal.** A status page for the API, web, driver app and messaging, and a written note to affected merchants when an incident touches them. ShipHero runs a status page for WMS, mobile and API [TD-SH §1.11]. RN3 lists it under SEC-1 [RN3 §4].
2. **Workflow.** Detect (B12 rules or a report) → update status → notify merchants (mail; console banner) → resolve → review. No incident runbook exists: the OPS-2 runbook list has none [R1 §9, roadmap OPS-2].
3. **Business rules and edge cases.** No source gives a response-time target. The status page must carry no personal data or ids. Notices in Arabic and English (ADR-0016). A WhatsApp merchant notice needs an approved utility template, and none exists for incidents (ADR-0037) [I].
4. **Data.** No incident or status-history record is defined.
5. **Surfaces.** Public status page (none); console banner (WEB-4 banner exists for support, not incidents); mail.
6. **Permissions, roles and audit.** A named incident lead (platform admin); each status change audited (platform action, PLAT-7) [I].
7. **Dependencies and integrations.** PLAT-14 alerts; OPS-1 for hosting the page; Cloudflare in front (R1 §8). A third-party status host would be a processor (C19).
8. **Metrics and reporting.** Time to detect, to first notice and to resolve; none defined.
9. **How the market builds it; shape on the table.** ShipHero: status page [TD-SH §1.11]. Shipsy, Anchanto and Salla status pages were not read. Shape on the table: a minimal page on the host with mail notices first (adapt; own copy).
10. **Roadmap mapping.** Missing. Proposed inside SEC-1 (RN1, wave 1 gap items; RN3 wave 3 to 4) and as an OPS-2 addition (RN1 §4). Owner questions: U-15.

## Part C · Privacy, residency and sector duties

## 14 Records of processing

1. **Legal duty and who it binds.** A register of processing activities under the PDPL: purpose, data categories, recipients, retention and transfers. The current minimum contents come from secondary sources only [RN1 §4, U]; the draft would remove the minimum list (Clyde & Co, article not stated) [G1]. It binds the controller.
2. **Workflow and clocks.** Keep the register per account and per processing activity. A PR that adds a personal-data column updates the inventory, the schema test and the staging anonymiser together [R2 §10]. No clock; the register is shown on request (inferred).
3. **Business rules and edge cases.** The repo inventory is the seed: recipient, driver, staff, supplier and any-actor rows [R2 §10]. Purpose and legal basis are not in the inventory.
4. **Data.** Column comments `pii:<actor>` (schema test, PLAT-5) and the inventory table [R2 §10]. No register table exists. A register adds purpose, basis (U-5), recipients (U-6) and transfers (C19).
5. **Surfaces.** Internal document (data §10). No console view planned.
6. **Permissions, roles and audit.** Platform staff; no audit defined.
7. **Dependencies and integrations.** PLAT-5 schema test; staging anonymiser; processor list (C19).
8. **Metrics and reporting.** Count of personal-data columns with a retention rule; not checked by any test (a schema-test extension is a proposal).
9. **How the regulator or market builds it; shape on the table.** Shipsy claims GDPR-readiness and an EU residency option [TD-Sh §2.8, vendor claim]; that is not a PDPL register. Shape on the table: extend the data §10 table into the register (adapt; the inventory exists).
10. **Roadmap mapping.** Partial: data §10 and the PLAT-5 test. PDPL-1 proposed for wave 1 exit before real recipient data [RN1 §4; RN3 §2]. Owner questions: U-1, U-5.

## 15 Lawful basis and consent

1. **Legal duty and who it binds.** Each processing purpose needs a lawful basis under the PDPL. No official text was read; the bases are not confirmed for this chapter [RN1 §4, U].
2. **Workflow and clocks.** Decide the basis per data category (recipient delivery, driver contract, staff account); record consent where it is the basis (recipient ratings, DEL-29, need consent handling [RN3 §3]); withdrawal runs through the opt-out path (R3 §5.5).
3. **Business rules and edge cases.** Opt-out stops recipient messages per (account, phone) but never OTP to drivers or staff [R3 §5.5]. A delivery already in progress is never delayed [R3 §5.4]. No marketing template exists in the wave list [R3 §5.1].
4. **Data.** Opt-out list `(account_id, phone)` [R3 §5.5]. Consent records are not defined.
5. **Surfaces.** Quick-reply button; the words STOP, START, إيقاف, اشتراك, الغاء [R3 §5.5]; the merchant sees "messages off".
6. **Permissions, roles and audit.** System-driven; audit not stated.
7. **Dependencies and integrations.** PLAT-9; INT-3 templates; ADR-0037.
8. **Metrics and reporting.** Opt-outs per account; `messages_skipped_total{reason="opted_out"}` [R3 §10].
9. **How the regulator or market builds it; shape on the table.** One SAR SMS summary says marketing SMS needs prior opt-in [G7, U]. A 2026 vendor blog says an SDAIA consultation on marketing consent runs to 5 November 2026 [G7, U, weak]. Shape on the table: keep recipient messages to delivery notices (ADR-0037); whether a delivery notice needs more than the delivery relationship is for counsel (U-5).
10. **Roadmap mapping.** Partial: opt-out designed (INT-3, INT-7); lawful basis missing; PDPL-1 proposed. Owner questions: U-5.

## 16 Data subject requests and the 30-day clock

1. **Legal duty and who it binds.** A data subject may ask for access, correction, deletion and a copy. Secondary sources give 30 days, extendable under stated conditions [G4, U]. The draft Art 3 makes a missed period a deemed rejection and adds a complaint route to SDAIA [G1]. A draft Art 36 (20 business days for SDAIA requests) is a regulator-request clock, not a data-subject clock [G1].
2. **Workflow and clocks (proposed).** Intake (staff, merchant or recipient via the tracking link); verify; locate records across the inventory; decide; respond. The clock starts at receipt. An extension needs reasons given in advance [G4, U]. No source gives a request form.
3. **Business rules and edge cases.** A single recipient's erasure redacts mutable recipient columns in place; ledger rows hold no names [R2 §10]. A per-account export is served by the platform tool [R2 §10]. Extension criteria in the draft are not described [G1].
4. **Data.** No request table. Proposed fields: subject type, account id, received_at, due_at (received plus 30 days), status, response, audit ids. Retention of the request record is unset.
5. **Surfaces.** Platform admin tool (data §10; no order); recipient or merchant intake (none).
6. **Permissions, roles and audit.** Platform admin with `X-Support-Reason` for cross-account work (PLAT-13); each record touched and the decision audited (PLAT-7).
7. **Dependencies and integrations.** Retention jobs (C17); backups expire at 35 days, so deletion completes within 35 days [R2 §10].
8. **Metrics and reporting.** Open requests, days to respond, overdue count; none defined. A due-date alert would be a B-type rule (proposal).
9. **How the regulator or market builds it; shape on the table.** No teardown read covers DSR tooling. Shape on the table: build the workflow here (own), reusing the redaction and export rules already in data §10; the 30-day clock is the regulator's.
10. **Roadmap mapping.** Missing as an order; the rules exist in data §10. PDPL-1 proposed for wave 1 exit [RN3 §2]. Owner questions: U-4.

## 17 Retention and deletion

1. **Legal duty and who it binds.** Set a retention period per category and delete or anonymise at the end; the PDPL duty is secondary-sourced [G4, U]. Eeasy's own periods are in data §10 and platform §6.
2. **Workflow and clocks.** Proofs two years after terminal state; trails 90 days; invitations 7 days; OTP 1 hour after expiry; inbound payloads 30 days; outbox done rows 7 days and dead rows 30 days; closed accounts export then delete (Q-38, 90 days, provisional) [R2 §10; roadmap Q-38]. Deletions run as `storage_lifecycle` rows so each is audited [ADR-0036].
3. **Business rules and edge cases.** Ledgers are append-only, so removal is by partition drop or account deletion [R2 §3.1]. Audit rows keep two years by monthly partitions [R5 §7]. Recipient data is kept for account life (Q-37, provisional) [roadmap Q-37].
4. **Data.** Retention table data §10; `core_audit_log` partitions; `storage_lifecycle` kind (ADR-0036); object lifecycle rules for `imports/` (30 days), `exports/` (7 days) and noncurrent versions (30 days) [R3 §2.6].
5. **Surfaces.** None for merchants. Per-account deletion tool on `elx_maintenance`, a wave 1 data order [PLAT-5 plan].
6. **Permissions, roles and audit.** Platform only; deletions audited; the audit rows kept carry ids, no personal data [R2 §10].
7. **Dependencies and integrations.** PLAT-8 outbox and queues; ObjectStorage (INT-1); backups (OPS-2).
8. **Metrics and reporting.** Rows and objects deleted per job; `backup_job_failed` rule exists [R11]; no deletion-job alert.
9. **How the market builds it; shape on the table.** Wasal sets data-history tiers of 30 days, 1 year and 5 years by plan [TD-W]; that is a product tier, not a legal clock. Shape on the table: per-category clocks in configuration, with queue-based deletion (ADR-0036 chose this over provider lifecycle rules, which cannot write an audit row per deletion).
10. **Roadmap mapping.** Partial: PLAT-8 pruning, PLAT-7 partitions, the deletion tool (wave 1). ADR-0036 is proposed. Q-37 and Q-38 are provisional. Owner questions: U-4.

## 18 Breach notification

1. **Legal duty and who it binds.** Notify SDAIA within 72 hours of awareness of a breach that may harm data or rights; notify affected people without undue delay where harm is likely [G4, U]. The draft would remove the harm threshold for the SDAIA notice and keep the damage test for individuals [G1, G3].
2. **Workflow and clocks (proposed; no runbook exists).** Detect (alert, report or processor notice) → contain (revoke sessions, rotate keys, pause messaging) → assess scope, data categories and harm → notify SDAIA within 72 hours through its portal → notify individuals if harm is likely → log and review. Partial information may follow with the reason for delay [G4, U].
3. **Business rules and edge cases.** The sources disagree on the threshold. G2 says the breach definition is deleted but the term stays in Art 24; G3 says the wording appears to remove the current threshold; G1 says the draft removes it. The current Implementing Regulation's harm condition applies until the amendment is in force [G2, G1].
4. **Data.** No incident record. Response steps go to the audit log (PLAT-7). The notice must carry no personal data.
5. **Surfaces.** SDAIA portal (external); console notice; recipient notice (no approved template).
6. **Permissions, roles and audit.** Named incident lead (platform admin) and counsel; each step audited [I].
7. **Dependencies and integrations.** Alerts (B12; none for breach); the OPS-2 runbook list; processors' breach duties in contracts (U-6); backups for recovery.
8. **Metrics and reporting.** Time from awareness to SDAIA notice; time to contain; none defined.
9. **How the regulator or market builds it; shape on the table.** No tooling was read. Shape on the table: a written runbook first (an OPS-2 addition), then process; no product feature is implied.
10. **Roadmap mapping.** Missing. OPS-2 lists five runbooks and no breach runbook [roadmap OPS-2]. PDPL-1 proposed. Owner questions: U-3.

## 19 Cross-border transfer

1. **Legal duty and who it binds.** Transfers outside KSA are allowed under conditions [G4, U]. The draft Art 34 makes registration with the National Register of Controllers mandatory for any transfer or disclosure outside KSA, and for public entities, core-activity processors and sensitive-data controllers [G1].
2. **Workflow and clocks (proposed).** List each transfer (processor, country, categories) in the register; check conditions; register if the draft is adopted; review on each new processor.
3. **Business rules and edge cases.** Processors that may receive personal data [I from the docs]: Sentry (exceptions, PLAT-14); PostHog (ids only); Cloudflare (edge, TLS, WAF) [R1 §8]; Expo push (ids only, INT-4); the WhatsApp provider (phone and template parameters) [R3 §11]; Hudhud (address text or coordinates); Eeasy shipping (name, phone, address, COD); VROOM (self-hosted, coordinates and ids). Processing locations are not stated in the docs read.
4. **Data.** No transfer register. Minimisation rules are the design inputs [R3 §11].
5. **Surfaces.** Internal register; merchant agreements (not in repo).
6. **Permissions, roles and audit.** Platform legal owner; no audit defined.
7. **Dependencies and integrations.** Every outbound provider listed above; the WhatsApp provider is to be confirmed (Q-27).
8. **Metrics and reporting.** Processors with personal data; none.
9. **How the regulator or market builds it; shape on the table.** Shipsy claims an EU residency option [TD-Sh §2.8, claim]. Logestechs puts a phone number and a PIN in webhook payloads [RN4 §3, negative example]. Shape on the table: minimise at the port (R3 §11) plus a register (own). A Saudi-hosted stack reduces transfers but does not remove them for processors [I].
10. **Roadmap mapping.** Partial: minimisation designed; no register; PDPL-1 proposed. Owner questions: U-6, U-2.

## 20 Data residency, hosting and the in-Kingdom storage draft

1. **Legal duty and who it binds.** No binding in-Kingdom storage rule is in force for this product. The draft Art 23 would require controllers to store personal data within the Kingdom, with transfers allowed under the PDPL [G1]. NCA CCC-2:2024 says its controls "have been updated to reflect changes related to data localization" [G5, read 2026-11-02]; one source says its localisation subcontrols moved to NDMO [RN1 S2, U]. A CST rule on public-sector data is unverified [RN1 §4].
2. **Workflow and clocks.** Host choice (OPS-1): quote, region, data-processing agreement with the provider, off-host backups in a second region of the same provider [R1 §6]. The draft clock: 60 days after Gazette publication, if approved [G1].
3. **Business rules and edge cases.** ADR-0022 (accepted) allows a Saudi or Bahraini host [R6]. Q-10's default is a Saudi or Bahraini region with managed PostgreSQL (provisional). If Art 23 applies as summarised, a Bahraini primary and a backup region outside KSA would both conflict [I]. Environments never share a database or bucket [R1 §1].
4. **Data.** Every table and bucket sits in the region chosen for the environment; backups 35 days; WAL archive in a second region [R1 §6].
5. **Surfaces.** None for merchants. Region is not shown to users (no source requires it).
6. **Permissions, roles and audit.** Platform operators; provider console access logs (not read).
7. **Dependencies and integrations.** OPS-1 (owner go, Q-10, Q-12); OPS-2 backups; INT-1 bucket; Cloudflare; processors (C19).
8. **Metrics and reporting.** None. A CI check that primary and backup regions are in KSA is a proposal.
9. **How the regulator or market builds it; shape on the table.** Shipsy claims an EU residency option [TD-Sh §2.8, claim]; ShipHero runs on AWS [TD-SH §1.11]. Shape on the table: keep the Gulf host decision (ADR-0022) and decide the country of each store under the draft (own).
10. **Roadmap mapping.** Partial: Q-10 default and ADR-0022 exist; OPS-1 waits for the go; the draft is not in the roadmap. Owner questions: U-2 (reopens Q-10).

## 21 Controller and processor roles

1. **Legal duty and who it binds.** The PDPL separates controllers, who decide purposes and means, from processors, who act on instructions; each carries duties. No source read gives Eeasy's role for each dataset [U; RN3 unanswered 6].
2. **Workflow and clocks (proposed).** Map each dataset to a role: merchant records; recipient data for delivery; driver and staff accounts; telemetry. Record the role in each merchant agreement.
3. **Business rules and edge cases.** Eeasy as processor or controller for merchant recipient data is open [RN1 unanswered 6]. The role decides who sets retention (Q-37) and who notifies breaches (C18) [I].
4. **Data.** No field records the role. The register (C14) and the request owner (C16) depend on it.
5. **Surfaces.** Merchant agreements and any data-processing agreement (not in repo).
6. **Permissions, roles and audit.** Legal owner; none in product.
7. **Dependencies and integrations.** Merchant contracts; processor agreements (C19).
8. **Metrics and reporting.** None.
9. **How the regulator or market builds it; shape on the table.** Competitor terms were not read. Shape on the table: a data-processing agreement template per merchant, the role stated per dataset (adapt; own).
10. **Roadmap mapping.** Missing; no order. Owner questions: U-1.

## 22 Driver identity and compliance document retention

1. **Legal duty and who it binds.** Driver identity and licence data are personal data. The retention and lawful basis for ID or Iqama numbers and licence scans are unverified [RN2 unanswered 2; RN2 S31]. TGA rules tie non-Saudi delivery drivers to licensed companies and operating cards [RN2 S19, Al Riyadh Daily, 2024-04-02; S21 date unconfirmed].
2. **Workflow and clocks (proposed; DOC-1 or DEL-22).** Upload licence, registration, insurance and ID or Iqama with expiry; reminders at fixed lead times; block or warn on expiry by ruling [RN3 §3; RN2 Module 2].
3. **Business rules and edge cases.** Today the driver record holds name, phone, cash PIN hash, device id and push token, with no document fields [R2 §10]. Expiry-based blocks are an owner decision (RN2 unanswered 1). A full ID number should not be stored without a lawful basis (U-7).
4. **Data.** None yet. Proposed: document type, a masked or hashed number, expiry, file key and status; scans in storage under the account prefix with a retention rule [I].
5. **Surfaces.** Driver app upload (proposal); dispatcher driver list (WEB-6); reminders by mail (proposal).
6. **Permissions, roles and audit.** Driver-management staff; drivers see their own documents; audit each view of an identity scan [I].
7. **Dependencies and integrations.** ObjectStorage (INT-1); DEL-4 driver entity; PLAT-9 for reminders.
8. **Metrics and reporting.** Documents expiring in 30 days; drivers blocked by expiry (proposal).
9. **How the regulator or market builds it; shape on the table.** Samsara sends expiry alerts and supports driver self-service upload [RN2 S17]; Fleetio sends renewal reminders [RN2 S18, old post]. Onfleet checks age against government ID in its market [RN2 S3]; RN2 found no KSA demand for that. Shape on the table: expiry alerts and self-service upload (adapt Samsara); no ID check at the door (not sourced for KSA).
10. **Roadmap mapping.** Missing. DEL-22 proposed for wave 2 [RN3 §3]; RN2 puts the equivalent DEL-19 in wave 1. Owner questions: U-7.

## 23 Messaging rules (CST SMS and WhatsApp templates)

1. **Legal duty and who it binds.** SMS in KSA is governed by CST rules: registered sender IDs, prior opt-in for marketing, opt-out and sending hours. The sources are vendor summaries; the CST text was not read [G7, U]. One 2026 vendor blog says CST SMS rules are best practice, not law, for WhatsApp [G7, U, weak].
2. **Workflow and clocks.** Current: WhatsApp approved templates only; no SMS before wave 3 [ADR-0037]. Templates go through Meta under eeasynew's verified business on a new number [R3 §5.2; Q-27]. Opt-out keywords as in B9 and C15.
3. **Business rules and edge cases.** Sources state: marketing needs prior opt-in; promotional sender IDs carry a suffix (one source says -AD); opt-outs honoured within 24 hours (one source); sending hours conflict (10 pm to 7 am; 10 pm to 9 am; 8 am to 10 pm) [G7, U]. The integrations rule is quiet hours 22:00 to 08:00 Asia/Riyadh for messages a person did not trigger [R3 §5.4], which matches one reading only.
4. **Data.** Template keys, languages and approval status [R3 §5.1]; opt-out list [R3 §5.5]; sender-ID registry is not defined.
5. **Surfaces.** WhatsApp templates; SMS none; mail for staff alerts.
6. **Permissions, roles and audit.** Platform admin for template changes; audit proposed.
7. **Dependencies and integrations.** Meta template review (up to 24 hours, R3 §5.2); the eeasynew provider; PLAT-9; ADR-0041 engine (proposed).
8. **Metrics and reporting.** `messages_sent_total`, `messages_skipped_total`, `message_budget_used_ratio` [R3 §10].
9. **How the regulator or market builds it; shape on the table.** Torod sends SMS at each delivery stage [RN2 S11]; Wasal sends SMS, email and WhatsApp [TD-W]. Shape on the table: keep WhatsApp templates now (ADR-0037); the CST rules bite at the ADR-0037 wave 3 SMS decision; the hours rule bites now for reschedule and address-pin requests [R3 §5.4].
10. **Roadmap mapping.** Partial: quiet hours and opt-out designed (INT-3, INT-7); CST text unverified. Owner questions: U-18.

## 24 ZATCA touchpoints (cross-reference to chapter 12)

1. **Legal duty and who it binds.** E-invoicing phase 2 applies by wave; ZATCA notifies a wave six months ahead; applicability to Eeasy is unknown [RN1 S1, read 2026-11-02; the wave table is an image]. Vendor guides disagree on wave dates [RN1 S23, U].
2. **Workflow and clocks.** Chapter 12 owns invoice generation and clearance. This chapter's touchpoints are archive retention (a six-year archive is claimed, unverified [RN1 §1]) and the signing keys, which are secrets (D4).
3. **Business rules and edge cases.** Signing keys rotate under the secrets runbook (D4). Archive length follows the rule once confirmed.
4. **Data.** Invoices are not in data.md as read; billing has no roadmap order.
5. **Surfaces.** Chapter 12.
6. **Permissions, roles and audit.** Finance role (chapter 12).
7. **Dependencies and integrations.** BILL-1 and BILL-2 (RN1 §5 proposals).
8. **Metrics and reporting.** Chapter 12.
9. **How the regulator or market builds it; shape on the table.** ZATCA roll-out page [RN1 S1]. Shape: as chapter 12 decides.
10. **Roadmap mapping.** Missing: BILL-2 proposed; OPS-8 research proposed [RN4 §4]. Owner questions: U-20.

## Part D · Security programme

## 25 NCA CCC-2:2024 gap assessment

1. **Legal duty and who it binds.** CCC-2:2024 sets minimum cybersecurity requirements for cloud service providers (CSP) and cloud service tenants (CST) [G5, read 2026-11-02]. Per RN1 S2 (local PDF extract): CSP 4 domains, 37 main and 94 subcontrols; CST 18 main and 26 subcontrols. Scope per a secondary summary: a provider is in scope if it serves an in-scope tenant, wherever it is incorporated; a tenant is in scope if it is a government body or a CNI owner that uses cloud [G6, U]. Eeasy's role is open (U-12).
2. **Workflow and clocks (proposed).** Decide the role; assess against that role's controls; remediation plan; evidence register. RN1 wants the assessment early (wave 1); RN3 places SEC-1 in wave 3 to 4.
3. **Business rules and edge cases.** A tenant's attestation covers its own configuration, not the provider's controls [G6, U]. The control IDs encode the role (provider and tenant IDs differ) [G6, U].
4. **Data.** No evidence register or control mapping.
5. **Surfaces.** None for merchants; evidence for buyers.
6. **Permissions, roles and audit.** Security lead (none named in the roadmap).
7. **Dependencies and integrations.** OPS-1 (private network, host); OPS-2 backups; PLAT-4 secrets; PLAT-7 audit; PLAT-14 alerts; the host's own CCC position (not read).
8. **Metrics and reporting.** Control coverage per domain; none defined.
9. **How the regulator or market builds it; shape on the table.** Aramco requires a Cybersecurity Compliance Certificate from IT vendors; SABIC CyberTrust applies to its suppliers [RN1 S27, search 2026-11-02]. No source read names a certificate called "Cybersecurity Essentials" [RN1, not found]. Shape on the table: assess first, then the owner decides on certification (own).
10. **Roadmap mapping.** Missing. SEC-1 proposed (RN1 wave 1 gap items; RN3 wave 3 to 4 gate). Owner questions: U-12, U-13.

## 26 ISO/IEC 27001 and SOC 2 as buyer asks

1. **Legal duty and who it binds.** Not law. ISO/IEC 27001 is a certified information-security management system. SOC 2 Type I reports on design at a date; Type II covers an operating window [RN1 §4]. CCC-2 names ISO 27001 as a mapped standard [RN1 S2].
2. **Workflow and clocks.** Choose scope and standard; readiness; external auditor; Type I, then Type II. Vendor estimates: Type I eight to 22 weeks; Type II window three to 12 months [RN1 S24, U]. ISO's own site was not readable (403) [RN1].
3. **Business rules and edge cases.** Competitor claims are vendor claims: Shipsy claims SOC 2 Type II and ISO 27001 [TD-Sh §2.8]; ShipHero claims SOC 2 Type 2 [TD-SH §1.11]. A third-party listing claims Bringg SOC 2 at low confidence [RN1 §1, U].
4. **Data.** Evidence (policies, access reviews, change logs) is not held in any form.
5. **Surfaces.** Trust page (none planned); buyer questionnaires.
6. **Permissions, roles and audit.** Security owner; the audit log (PLAT-7) is an evidence source.
7. **Dependencies and integrations.** D1, D4 to D6 as evidence.
8. **Metrics and reporting.** Control test pass rate; none.
9. **How the market builds it; shape on the table.** Vendors claim these certifications [TD-Sh, TD-SH]. Shape on the table: gap assessment first (D1); certify only when a named buyer asks (owner choice, RN1 §4) (own).
10. **Roadmap mapping.** Missing; SEC-1 proposed (wave 4) [RN1 §4]. Owner questions: U-13.

## 27 Penetration testing

1. **Legal duty and who it binds.** Not a named legal duty in the sources read. RN1 treats an independent test of the public surface as a gate before INT-9 opens to integrators [RN1 §4]. Frequency: not found.
2. **Workflow and clocks (proposed).** Scope; test; fix by severity; retest critical and high findings. The per-PR adversary review in the roadmap (Adv. column) is a design review, not a penetration test [roadmap §1].
3. **Business rules and edge cases.** Scope must cover sign-in and OTP (PLAT-11), the cross-tenant door (PLAT-6), the merchant-URL SSRF guard (ADR-0040), tracking tokens (DEL-8) and signed uploads (ADR-0015). Testing runs on staging, an anonymised copy [R1 §1]; no production action without owner instruction (AGENTS.md).
4. **Data.** Findings register; none.
5. **Surfaces.** Public hostnames (web, admin, API, webhook intake) [R1 §8].
6. **Permissions, roles and audit.** Tester access to staging only; no production data.
7. **Dependencies and integrations.** Staging (OPS-1); Cloudflare WAF [R1 §8].
8. **Metrics and reporting.** Findings by severity; time to fix; none.
9. **How the market builds it; shape on the table.** No teardown read reports its test cadence. Shape on the table: an external test after the gap assessment and before INT-9 (own).
10. **Roadmap mapping.** Missing; SEC-1 gate before INT-9 (wave 4) [RN1 §4; RN3 §3]. Owner questions: U-14.

## 28 Secrets and key rotation runbooks

1. **Legal duty and who it binds.** Not a legal duty; a platform rule. Secrets never sit in code, images or the repo; gitleaks runs in CI and as a pre-commit hook [R1 §3, §4].
2. **Workflow and clocks.** Runbooks in platform §9 and OPS-2: rotate the token signing key; rotate the credentials key (re-encrypt in the background while both keys decrypt) [R3 §11]; rotate a channel token; rotate an account's Eeasy shipping key; rotate webhook secrets (ADR-0040); rotate platform secrets by redeploy with overlap where the provider allows two (Hudhud, WhatsApp, Expo) [R3 §11].
3. **Business rules and edge cases.** Credentials are AES-256-GCM with a key id; rotation adds a key, re-encrypts by key id, then retires the old key, so no credential is unreadable mid-rotation [R2 §10]. Secrets are never logged or put in outbox payloads [R3 §11].
4. **Data.** `credentials_ciphertext`, `webhook_secret_ciphertext`, `secret_ciphertext`, `previous_secret_ciphertext`, `totp_secret_ciphertext`, each with its key id [R2 §10].
5. **Surfaces.** Runbook documents; reconnect a store from the console (WEB-17, wave 4).
6. **Permissions, roles and audit.** Platform operators; rotations audited (platform actions) [I].
7. **Dependencies and integrations.** Host secret store (OPS-1); PLAT-4 configuration module (merged); gitleaks (PLAT-3).
8. **Metrics and reporting.** Key age and rotation dates; no rule in `alerts.yaml` watches key age.
9. **How the market builds it; shape on the table.** ShipHero bearer tokens expire every 28 days [TD-SH §3.2]; Salla access tokens last 14 days [RN1 S6]. Shape on the table: the key-id scheme as it is (own); borrow the overlap window where a provider permits two secrets.
10. **Roadmap mapping.** Partial: PLAT-4 encryption (merged); runbooks partly in OPS-2 (wave 0, waits OPS-1). Owner questions: Q-10, Q-12 (host).

## 29 Backups and restore drills

1. **Legal duty and who it binds.** Not a named legal duty. Platform rule: daily full backups and continuous WAL archiving to a second region of the same provider; 35-day retention; a restore drill into staging each month, recorded in the ops log [R1 §6].
2. **Workflow and clocks.** Daily backup and WAL; monthly restore into staging; restore runbook (OPS-2); a failed backup job pages (`backup_job_failed`, severity page) [R11].
3. **Business rules and edge cases.** Deletions reach backups within 35 days [R2 §10]. The second region must satisfy the residency answer (C20). The first restore drill is a wave 0 exit item [roadmap §0].
4. **Data.** Backup catalogue and ops log (not defined). Object versions kept 30 days after becoming noncurrent [R3 §2.6].
5. **Surfaces.** Host console; no merchant surface.
6. **Permissions, roles and audit.** The maintenance role and the owner role (ADR-0031); drill results recorded in the ops log.
7. **Dependencies and integrations.** OPS-1 host; OPS-2 (waits OPS-1); provider managed PostgreSQL (Q-10).
8. **Metrics and reporting.** Last successful backup age; restore duration (recovery time) and the drill result. Only job failure is alerted [R11].
9. **How the market builds it; shape on the table.** No teardown read describes backups. Shape on the table: the platform §6 design (own), using provider backups and WAL.
10. **Roadmap mapping.** Partial: OPS-2 (wave 0) and the wave 0 restore-drill exit; OPS-1 waits for Q-10 and Q-12. Owner questions: Q-10.

## 30 Audit log export

1. **Definition and user goal.** An append-only log of admin and ledger-adjacent actions and of cross-tenant reads, kept two years and exportable per account [R5 §7]. PLAT-7 is merged.
2. **Workflow.** Written inside the business transaction for admin and ledger-adjacent actions; asynchronously through the outbox for high-volume audited reads [R5 §7]. Staff list endpoint `listAuditLog`; platform `platformListAccountAudit` [PLAT-7 plan]. Export: the per-account archive by platform tool [R2 §10]. Staff CSV export is open (PLAT-7 plan open question 1; proposal: platform only in wave 1).
3. **Business rules and edge cases.** `redactForAudit` removes keys matching password, secret, token, pin, otp, api key, ciphertext, authorization and cookie; caps strings at 2,000 characters and documents at 32 KB [PLAT-7 plan 2.5]. Monthly partitions; only partitions older than two years are dropped; runtime roles are revoked from partitions [PLAT-5 plan M-4].
4. **Data.** `core_audit_log`, monthly range partitions on `occurred_at`; actor, IP and user agent (personal data, two years) [R2 §10].
5. **Surfaces.** Merchant settings audit log (WEB-3); platform audit (WEB-4). Export screen not in WEB-4 (out of scope, WEB-4 plan §6). API: `listAuditLog`.
6. **Permissions, roles and audit.** Read permission per role; cross-account reads need `X-Support-Reason` (400 `reason_required` otherwise) [PLAT-7 plan]; each export or download writes an audit row [R2 §10].
7. **Dependencies and integrations.** PLAT-6 request ids; PLAT-8 outbox for asynchronous audit; PLAT-14 logs with redaction; the platform export tool (wave 1 data order).
8. **Metrics and reporting.** Rows per month; partitions created ahead (`core_ensure_audit_partitions`); exports per account; none alerted.
9. **How the market builds it; shape on the table.** Shipsy claims complete audit trails and logged agent decisions [TD-Sh §2.8, claim]. Shape on the table: no new build (own, already merged); the open choice is the staff export format (U-17).
10. **Roadmap mapping.** Covered for write and list (PLAT-7 merged; WEB-3 and WEB-4 screens). Export partial: platform tool in wave 1; staff CSV open. Owner questions: U-17.

## Unanswered

The questions no source settled. Owner or counsel decides; the lead turns them into owner questions.

- U-1. Is Eeasy controller or processor for merchant recipient data, and for driver and staff accounts? (14, 21, 16)
- U-2. Does the draft in-Kingdom rule (Art 23) apply, and does it exclude a Bahraini host or a backup region outside KSA? Reopen Q-10 if yes. (20, 19)
- U-3. Breach: which threshold applies now and after the amendment, who notifies (controller or processor), and who signs the runbook? (18)
- U-4. Recipient data retention: Q-37 (life of account) against the PDPL retention and erasure duties; Q-38 (90 days after closure). (16, 17)
- U-5. Lawful basis per data category, and whether a delivery notice needs more than the delivery relationship. (14, 15, 23)
- U-6. Transfer register: which processors receive personal data, where each processes, and what contracts say about breach notice. (19, 18)
- U-7. Driver identity and licence scans: stored or not, retention basis, and whether expiry blocks offers. (22)
- U-8. Alert recipients, channels and escalation timing for failed orders, cash blocks, SLA and proof alerts. (9, 10, 2)
- U-9. Which number sends staff WhatsApp alerts: the platform number or a merchant-linked number (ADR-0041 question). (9)
- U-10. Report scope in wave 2: exports, KPI tiles, scheduled reports and BI access (RPT-1). (1, 5, 6, 7, 8)
- U-11. The on-time definition: which promise and which closing rule. (2)
- U-12. Is Eeasy a CSP, a CST or both under CCC-2:2024? (25)
- U-13. Is ISO/IEC 27001 or SOC 2 a named buyer requirement, and by when? Which "Cybersecurity Essentials" is meant, if any? (26, 25)
- U-14. Penetration test: scope, vendor, gate date (before INT-9, or before the pilot holds real data). (27)
- U-15. Status page audience (public or merchant-only) and the incident channels. (13)
- U-16. Low-stock alerts: wave 2 or wave 3, and whether Salla's native alert is a required parity feature. (11)
- U-17. Staff audit export: platform-only (PLAT-7 proposal) or a staff CSV, and its format. (6, 30)
- U-18. CST sending hours and sender-ID rules, from the CST text, not vendor summaries. (23, 15)
- U-19. ADR-0036 does not name mail as an outbox kind. Should mail sends (reports, invitations, alerts) get one? (7)
- U-20. ZATCA phase 2 applicability and wave for Eeasy (chapter 12). (24)
- U-21. Driver-visible scorecards and incentives: keep staff-only, or show drivers their own metrics? (3)
- U-22. COD reversal, refund and damage-cost rules: who records them and who pays. (4)

## Feature index

| Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|
| 1 Operations dashboard and KPI tiles | Partial | WEB-7; RPT-1 (proposed) | 1; 2 | U-10 |
| 2 SLA and on-time report | Partial (row only) | DEL-17, WEB-18 | 4 | U-11, U-8 |
| 3 Driver scorecards | Partial (row only) | DEL-17, WEB-18 | 4 | U-21, Q-32 |
| 4 Cash and COD reports | Covered; COD statement missing | DEL-11, DEL-12, WEB-10; DEL-23 (proposed) | 2 | U-22 |
| 5 Stock accuracy and drift reports | Partial | WMS-3, WMS-5, OPS-6; WMS-14 (proposed) | 3 | Q-17, U-10 |
| 6 Exports (CSV and Excel) | Partial | PLAT-7 platform tool; DEL-3; RPT-1 (proposed) | 1; 2 | U-10, U-17 |
| 7 Scheduled reports | Missing | RPT-1 (proposed) | 4 | U-10, U-19 |
| 8 BI connectors and reporting views | Partial | data §9 views; RPT-1 (later); INT-9 | later | U-10, Q-13 |
| 9 Merchant alerts and notification centre | Missing | DEL-21 (RN3) or DEL-20 (RN2) | 2 or 1 | U-8, U-9 |
| 10 Dispatcher alerts for field exceptions | Partial | DEL-5, DEL-7, DEL-11; DEL-21 (proposed) | 1 to 2 | U-8 |
| 11 Low-stock alerts | Missing | WMS-13 (proposed) | 3 | U-16 |
| 12 Platform alerts and rules file | Partial (rules merged) | PLAT-14; OPS-1 | 0 | Q-10, Q-12 |
| 13 Status page and incident communication | Missing | SEC-1 (proposed); OPS-2 addition | 3 to 4 | U-15 |
| 14 Records of processing | Partial | data §10; PLAT-5; PDPL-1 (proposed) | 1 exit | U-1, U-5 |
| 15 Lawful basis and consent | Missing | PDPL-1 (proposed) | 1 exit | U-5, U-18 |
| 16 Data subject requests and the 30-day clock | Missing (rules partial) | PDPL-1 (proposed) | 1 exit | U-4, U-1 |
| 17 Retention and deletion | Partial | PLAT-7, PLAT-8; deletion tool; ADR-0036 (proposed) | 0 to 1 | U-4, Q-37, Q-38 |
| 18 Breach notification | Missing | OPS-2 addition; PDPL-1 (proposed) | 0; 1 exit | U-3, U-6 |
| 19 Cross-border transfer | Partial | PDPL-1 (proposed) | 1 exit | U-6, U-2 |
| 20 Data residency, hosting and the in-Kingdom draft | Partial | ADR-0022; OPS-1; Q-10 | 0 | U-2 |
| 21 Controller and processor roles | Missing | none | before pilot | U-1 |
| 22 Driver identity and compliance document retention | Missing | DEL-22 (RN3) or DEL-19 (RN2) | 2 or 1 | U-7 |
| 23 Messaging rules (CST SMS, WhatsApp templates) | Partial | INT-3, INT-7; ADR-0037 (proposed) | 1 to 3 | U-18, U-5 |
| 24 ZATCA touchpoints (chapter 12) | Missing | BILL-2 (proposed) | 2 | U-20 |
| 25 NCA CCC-2:2024 gap assessment | Missing | SEC-1 (proposed) | 1 (RN1) or 3 to 4 (RN3) | U-12 |
| 26 ISO/IEC 27001 and SOC 2 | Missing | SEC-1 (proposed) | 4 | U-13 |
| 27 Penetration testing | Missing | SEC-1 gate before INT-9 | 4 | U-14 |
| 28 Secrets and key rotation runbooks | Partial | PLAT-4 (merged); OPS-2 | 0 | Q-10, Q-12 |
| 29 Backups and restore drills | Partial | OPS-2; OPS-1 | 0 | Q-10 |
| 30 Audit log export | Covered (write, list); export partial | PLAT-7 (merged); WEB-3; WEB-4 | 0; 1 | U-17 |

## Sources

Read on 2026-11-02 unless a row gives another date. Repo paths are relative to the repository root at `origin/main` (commit 6ca087e).

Repository (read 2026-11-02):
- [R1] `docs/architecture/platform.md` §1, §3, §4, §6, §7, §8, §9, §10.
- [R2] `docs/architecture/data.md` §3.1, §3.4, §3.5, §5, §6, §9, §10.
- [R3] `docs/architecture/integrations.md` §2.6, §4.5, §5.1 to §5.6, §10, §11.
- [R4] `docs/architecture/domain-model.md` §3 (D-7, D-11, D-14, D-17, D-23), §4, §6 (event sinks).
- [R5] `docs/architecture/identity-and-tenancy.md` §7 (audit log).
- [R6] `adr/0022-containers-on-gulf-region-host.md` (accepted).
- [ADR-0036] `adr/0036-outbox-kinds-and-worker-queues.md` (proposed). [ADR-0037] `adr/0037-messaging-templates-only-no-sms-before-wave-3.md` (proposed). ADR-0041 status from the proposed list of `adr/`.
- [roadmap] `docs/roadmap.md` §0, §1 (PLAT-4, PLAT-5, PLAT-7, PLAT-8, PLAT-9, PLAT-13, PLAT-14, OPS-1, OPS-2, OPS-5, OPS-6, DEL-3, DEL-4, DEL-5, DEL-17, WEB-3, WEB-4, WEB-7, WEB-18, WMS-3, WMS-5, INT-3, INT-7, INT-9, INT-12), §2, §4 (Q-10, Q-12, Q-13, Q-14, Q-17, Q-27, Q-32, Q-33, Q-37, Q-38), §5.
- [R11] `observability/alerts.yaml` (30 rules, PLAT-14).
- [PLAT-5, PLAT-7, PLAT-13, PLAT-14, WEB-4] `docs/orders/<ID>/plan.md`.
- [R12] `docs/contracts/openapi/components.yaml` (CashReport schema); grep of `docs/contracts/openapi` for export or report operations, 2026-11-02.

Research notes (origin branches, read 2026-11-02):
- [RN1] `docs/research/features-platform-integrations-compliance-2026-11.md`, `origin/docs/feature-coverage` at 7396dcc.
- [RN2] `docs/research/features-driver-fleet-alerts-2026-11.md`, same branch.
- [RN3] `docs/research/feature-coverage-2026-11.md`, same branch.
- [RN4] `docs/research/platform-comparison-2026-11.md`, `origin/docs/platform-teardowns` at d75ed6f.
- [TD-A] `teardown-anchanto-2026-11.md`; [TD-S] `teardown-safee-2026-11.md`; [TD-Sh] `teardown-shipsy-2026-11.md`; [TD-SH] `shiphero-teardown-2026-11.md` (same branch).
- [TD-W] `docs/research/teardown-wasal-2026-11.md` and [TD-L] `docs/research/teardown-logestechs-2026-11.md` (on `main`).

Regulatory and vendor (read 2026-11-02; secondary unless stated):
- [G1] Clyde & Co, SDAIA draft amendments to the PDPL Implementing Regulation (WebFetch, 2026-11-02): https://www.clydeco.com/en/insights/2026/10/sdaia-publishes-draft-amendments-to-the-pdpl
- [G2] Reed Smith, SDAIA consultation (search excerpt, 2026-11-02): https://www.reedsmith.com/our-insights/blogs/viewpoints/102o5at/sdaia-consults-on-extensive-amendments-to-the-saudi-pdpl-implementing-regulation/
- [G3] Pinsent Masons, Saudi consultation proposes data protection reform (search excerpt, 2026-11-02): https://www.pinsentmasons.com/out-law/analysis/saudi-consultation-proposes-data-protection-reform
- [G4] governancedocs.com, Saudi PDPL breach notification, 72-hour guide (search excerpt, 2026-11-02): https://governancedocs.com/saudi-pdpl-breach-notification/
- [G5] NCA, Cloud Cybersecurity Controls page (WebFetch, 2026-11-02; page shows CCC-2:2024, last update 24/06/2026): https://nca.gov.sa/en/regulatory-documents/controls-list/ccc/
- [G6] CCC scope summaries (search excerpts, 2026-11-02): https://governancedocs.com/cloud-cybersecurity-controls/ and https://sumrite.com/blog/nca-ccc-cloud-cybersecurity-controls-testing
- [G7] CST SMS rules, vendor summaries (search excerpts, 2026-11-02): https://suresms.com/en/resources/country-specific-rules-and-restrictions/saudi-arabia/ ; https://quickwa.com/blog/whatsapp-marketing-rules-saudi-arabia
- SDAIA site and the PDPL text: rejected on 2026-11-02 (RN1 access limits); not retried for this chapter.
