# Feature book 07: Returns, exchange and claims

Date: 2026-11-02. Branch `docs/feature-book-07-returns` from `origin/main` at `6ca087e`. Author: researcher agent for the lead. Status: research input; no decisions taken. Each "Chosen shape" is a proposal for the lead to rule.

Method. Repo facts are read from `origin/main` at `6ca087e` on 2026-11-02 and cited by path and section. Market facts come from the research notes on `origin/docs/feature-coverage` and `origin/docs/platform-teardowns`, read 2026-11-02, cited by note and source ID (registry in the last section). Two live reads by this researcher on 2026-11-02: the Salla returns help page (W1, fetched) and Saudi and UAE e-commerce law summaries (W2, W3, search only). Grades: F fetched, S search summary only. "(inferred)" marks my inference, not a source statement.

## Summary for the lead

1. Returns sit in four rows: DEL-18 (return pickup and exchange, wave 4), WMS-8 (dispositions, wave 4), DEL-14 (void attempt, wave 2) and a wave-1 check-in API with no screen. Claims, disputes, COD reversal, refund triggers and goods liability have no roadmap row.
2. Exchange has one money field (`cod_amount`). Logestechs SWAP and BRING carry two (collect from receiver, pay to receiver). Our shape adds the second field, which needs a D-4 amendment and a cash rule for money paid out at the door.
3. COD reversal conflicts with D-18 and D-19 (custody moves forward only, entries are never changed). It needs a new custody state and a new ADR that supersedes ADR-0007 clauses. The ADR-0007 citation of Logestechs is itself unverified.
4. Void attempt is specified as open to voided only. A recorded failure, the case that needs correcting, cannot be voided. Proposed: failed to voided by a dispatcher, with audit and a stated effect on `attempt_count`.
5. Claims: proof kinds have no damage kind, and proofs are deleted two years after `terminal_at` while a claim may stay open longer. Proposed: a claim aggregate with its own evidence and a hold on proof deletion.
6. A recipient return request cannot run on the 48-hour token purposes. The consumer return window (7 days from receipt, secondary sources) needs its own purpose and expiry. This pulls part of DEL-18 forward.
7. Refund trigger: `delivery.order.returned` carries no amount. Proposed: a separate money-bearing event at the same transition; ShipHero treats the status change as a finance event, not a status write.
8. Roadmap defects: DEL-27 (claims, wave 3) depends on DEL-18 (wave 4); WMS-8 cites W-7 where the returns invariant is W-17; `delivery_return` is missing from the WMS `createReturn` source enum.
9. Not covered by any order or kind: return to supplier (`pickup_request` is inbound only), and the "allocation held until receipt" rule, which is ambiguous for a one-stop exchange.
10. Eleven owner questions are proposed as CH7-Q1 to CH7-Q11 at the end. Q-4 and Q-6 stay provisional defaults; Q-36 mislabels the returns order.

---

## F-01 Return pickup order

Roadmap: DEL-18 (wave 4, depends on DEL-7 and Q-4). Kind `return_pickup` exists in the domain (R domain-model 3.1).

1. **Definition and user goal.** An order that collects goods from the recipient and ends at the site, so the merchant gets returned stock back without a third party. (R domain-model 3.1.)
2. **Workflow.** Created by a dispatcher; collected by a driver; uses the common state machine (R domain-model 3.13). The sequence collect-then-bring is not written: `picked_up` is a driver scan and `delivered` means handed over at the kind's destination (R domain-model 3.1), which for this kind is the site (inferred). Recipient absent: `attempted`, then reschedule or `failed`, as for delivery (inferred). Driver app shows the kind as "collect" (R driver-app.md, order detail).
3. **Business rules and edge cases.** `cod_amount` must be zero; error `cod_not_allowed` (R domain-model D-4; R errors.md section 3). Items carry `direction in`; items are immutable after `picked_up` (R domain-model 3.2). KSA: the consumer may withdraw within 7 days of receipt if unused, per Article 13 of the e-commerce law as quoted by Salla (W1, fetched 2026-11-02; W2, search, secondary). Salla says the store usually pays return cost for defective goods and may charge return shipping for change of mind (W1). UAE: sources conflict between 7 and 14 days (W3, search only). Arabic reason catalogue: per-account list in `AccountSettings.reason codes` (R data.md, core_accounts row); no seed catalogue exists in the repo.
4. **Data.** `del_orders.kind`; events in `del_order_events` (append-only, D-15); items with `direction`. No parent link to the original delivery order exists (R domain-model 3.1). Proofs for pickup are not defined; proof policy is per account (R data.md, core_accounts row). Retention: proofs two years after `terminal_at` (R data.md section 10; R platform.md section 6).
5. **Surfaces.** API order create with `kind` enum (R components.yaml Order); driver app order detail; WEB-5 order detail (R roadmap WEB-5). No recipient surface. Webhook `delivery.order.*` payloads do not name kind (R webhooks.md payload table).
6. **Permissions, roles and audit.** Create: `delivery.orders.create` (dispatcher); field events: `delivery.driver.work` (driver). Every transition audited through `del_order_events` (R contracts README permissions; R domain-model 3.3).
7. **Dependencies and integrations.** DEL-2 orders, DEL-6 dispatch, DEL-7 field events and proofs, WMS-8 receipt at the site, INT-3 messages (no return template exists, R integrations.md 5.1).
8. **Metrics and reporting.** Return rate (return orders created / orders delivered, per period); pickup success (picked up without attempt / pickups scheduled). Both derivable from `del_order_events` (inferred).
9. **How the market builds it.** Torod: reverse pickup and returns portal, returned leg keeps the original order number (P3 row 12; T1, T27). OTO: home pickup, locker and in-store returns (C S9). Logestechs: courier pick-up for returns (P4 L8, claim only). ShipHero: `return_create` with a self-return label (P2 D13).
   - Chosen shape: our own kind on the existing order model, plus a `parent_order_id` link so the return leg reads as part of the original delivery. Reason: Torod keeps the parent id (P3) and the roadmap has no link. The link is a domain amendment (R domain-model 3.1); ADR needed only if the lead treats it as a decision change (rule 7 of AGENTS.md).
   - Differs from the roadmap: yes (parent link, collect-then-bring sequence).
10. **Roadmap mapping.** Partial: kind covered by DEL-18; missing parent link, collect-then-bring sequence, pickup proof policy and return cost rule. Owner: Q-4 (exchange shape, see F-02), CH7-Q3 (return window and return cost).

## F-02 Exchange in one stop (out and in items, two money fields)

Roadmap: DEL-18 (wave 4); Q-4 provisional default is one order of kind `exchange` (R roadmap section 4).

1. **Definition and user goal.** One visit: the replacement goes out and the original comes back. Goal: no second trip for the recipient or the driver.
2. **Workflow.** One order, kind `exchange`, items `out` and `in` (R domain-model 3.1, 3.2). Partial outcome (out delivered, in refused) is possible; the domain note says two linked orders would make it easier to report (R domain-model section 9, question 4). Same state machine as F-01.
3. **Business rules and edge cases.** D-4 allows non-zero `cod_amount` on `delivery` and `exchange` only (R domain-model D-4). There is one money field, meaning amount to collect; nothing carries an amount to pay the recipient. Logestechs `SWAP` and `BRING` take `toCollectFromReceiver` and `toPayToReceiver` (P4 D5). ShipHero puts exchange lines inside the return call (P2 D13). Loop and Happy Returns offer exchanges (C S21, S22; fetched).
4. **Data.** `cod_amount` (halalas, non-negative). Proposed second field `amount_to_recipient` (halalas, non-negative), with a rule for net settlement (owner choice). A payout to the recipient at the door is a cash outflow; no custody entry type covers it, and D-19 bars the driver from recording custody moves (R domain-model D-19). Retention as orders.
5. **Surfaces.** Driver app shows out and in items (R driver-app.md); API order create; recipient exchange request is not built (F-05). Webhooks have no item direction.
6. **Permissions, roles and audit.** Create: dispatcher. Cash payout: the cashier records the custody entry (inferred from D-19); `delivery.cash.receive` (R contracts README).
7. **Dependencies.** WMS reservation of the out item (R domain-model 4.10), WMS receipt of the in item (F-04), cash custody (F-09).
8. **Metrics.** Exchange rate; partial-outcome rate (out delivered, in refused); net cash paid out per day (inferred).
9. **How the market builds it.** Logestechs: two money fields on `SWAP` and `BRING` (P4 D5). ShipHero: `exchange_items` inside `return_create` (P2 D13). Loop: steers shoppers from refunds to exchanges (C S21, fetched). Market sources do not show how the payout is settled in cash.
   - Chosen shape: borrow the two-field shape from Logestechs inside one order (keeps Q-4's default). Reason: the single-field domain cannot express a net exchange with cash moving both ways. Needs a D-4 amendment and an ADR for the cash payout rule.
   - Differs from the roadmap: yes (second field and payout rule); Q-4 default unchanged.
10. **Roadmap mapping.** Partial. Missing: second money field, payout custody, out-item allocation (F-08). Owner: Q-4 confirm; CH7-Q1 (who pays and how a net amount settles).

## F-03 Return to origin after failed attempts, and site check-in

Roadmap: failed to returned is in the state machine (R domain-model 3.13); `checkInReturn` is x-wave 1 (R staff-delivery.yaml); no check-in screen appears in WEB-5 scope (R roadmap WEB-5).

1. **Definition and user goal.** A parcel that could not be delivered goes back to a site and is received into the system, so the merchant knows where it is.
2. **Workflow.** `attempted` (reason code recorded) leads to `out_for_delivery` (retry in the same run), to `accepted` (dispatcher reschedules), or to `failed` (system, at max attempts) (R domain-model 3.13, D-14). `failed` leads to `returned` by site staff through `checkInReturn` (R staff-delivery.yaml, operation `checkInReturn`), which emits `delivery.order.returned` (R webhooks.md payload table). Cancel after pickup runs through `failed` then `returned` (R domain-model 3.13; Q-6 default).
3. **Business rules and edge cases.** Max attempts 3 per account (D-14; Q-3). Attempt reason comes from the account list (R domain-model 3.10). Check-in request carries a note only (`NoteRequest`). Error `invalid_transition` on a wrong state (R errors.md section 1). Arabic labels for reason codes are required (ADR-0016); no catalogue exists yet.
4. **Data.** Order status; attempts (`number`, `reason_code`, `note`, `point`, `client_ts`; R data.md `del_attempts`). Check-in records no quantity or condition. The returned event carries `items` as sku and quantity only (R public.yaml `DeliveryOrderReturned`).
5. **Surfaces.** API `checkInReturn`; driver app attempt screen (R driver-app.md); staff order detail (WEB-5) has no check-in action per roadmap text; webhooks `delivery.order.attempted` (with `reason_code`) and `delivery.order.returned`. Recipient message `order_attempted` exists in wave 1 (R integrations.md 5.1).
6. **Permissions, roles and audit.** `delivery.orders.receive` (site staff role) for check-in; `delivery.orders.dispatch` for failed and rescheduled moves (R contracts README role table). Audit via `del_order_events`.
7. **Dependencies.** WMS `returns` location (R domain-model 4.1 location types) and the WMS receipt that consumes `delivery.order.returned` (WMS-8, wave 4). Until then the parcel has no stock record (inferred).
8. **Metrics.** First-attempt success; attempts per order; failed-to-returned lag (time from `failed` to check-in), which is the aged-parcel metric (inferred).
9. **How the market builds it.** Logestechs: returns and failed deliveries from one screen with live notifications (C S8, search; P4 L6, claim only). OTO: reverse shipment from the order (C S9). Torod: returned shipment keeps the order number (P3 row 12).
   - Chosen shape: keep the state path as it stands. Add an optional count and condition per line to check-in in wave 1, and a check-in action in WEB-5. Reason: today the first record of condition is the wave-4 receipt (WMS-8), and ShipHero separates receive from restock with quantities (P2 D13). This is a wave-1 scope change.
   - Differs from the roadmap: yes (wave-1 check-in detail and screen).
10. **Roadmap mapping.** Partial. Covered: state and API (DEL-2, wave 1). Missing: check-in screen, condition capture. Owner: Q-3 (per-order override), Q-6 (is a door refusal an attempt?).

## F-04 Return dispositions into stock (WMS-8)

Roadmap: WMS-8 (wave 4, depends on WMS-3, DEL-18, Q-36). Domain rule W-17 (R domain-model 4.16).

1. **Definition and user goal.** Returned lines are received into the warehouse and each is restocked, quarantined or scrapped, with stock updated only by movements.
2. **Workflow.** Return expected (created by event, or `createReturn` for walk-in and carrier returns) then `receiveReturn` (`expected` to `received`, movement CUSTOMER to `returns`) then `dispositionReturn` (`received` to `dispositioned`, one movement per line, `restock`, `quarantine` or `scrap`) (R staff-wms.yaml, R domain-model 4.8, W-17). Errors `insufficient_stock` on disposition (R errors.md section 4).
3. **Business rules and edge cases.** Scrap posts an ADJUSTMENT movement (W-17). Movement reasons include `return` and `adjustment` (R domain-model 4.4). Receive without restock does not raise on-hand (P2 D13, ShipHero). Restock on a store return is the merchant's choice; Salla makes it optional and manual (C2 S4, fetched). Scrap approval threshold is not stated (inferred gap).
4. **Data.** `wms_returns`, `wms_return_lines` with `source`, `status`, lines with `condition` and `disposition` (R data.md, wms_returns row). Source enum conflict: domain 4.8 and data.md list `delivery_return`; the `createReturn` request enum lists only `carrier_return` and `walk_in` (R staff-wms.yaml `CreateReturnRequest`). Movements are append-only (R domain-model 4.4).
5. **Surfaces.** WMS API (`listReturns`, `createReturn`, `receiveReturn`, `dispositionReturn`); WEB-17 (wave 4); no handheld (WEB-15 is the pick and pack bench, wave 3).
6. **Permissions, roles and audit.** `wms.returns.write` (warehouse staff); `wms.stock.read`. Approvals for scrap adjustments: `wms.adjustments.approve` if the threshold applies (R contracts README; threshold unanswered).
7. **Dependencies.** WMS-3 ledger (R domain-model 4.5); DEL-18 event; channel stock publication after restock (INT-12, W-18).
8. **Metrics.** Restock rate (restocked / received quantity); scrap rate; receipt lag (returned to received); count of received lines with no disposition after 48 hours (inferred).
9. **How the market builds it.** Odoo return routes for assessment, refurbish, restock, disposal (C2 S16, fetched). Shipsy restock, reject and write-off routing (C2 S8, fetched). ShipHero: receive and restock are separate incremental quantities with a bin on restock (P2 D13).
   - Chosen shape: keep W-17 (three dispositions, movements only). Borrow ShipHero's split of receive and restock into two steps, which the API already has. Fix the references (see Summary item 8).
   - Differs from the roadmap: no for shape; yes for references and for the `delivery_return` source in the request.
10. **Roadmap mapping.** Covered (WMS-8). Defects: WMS-8 cites W-7 (the StockLevel invariant, R domain-model 4.16); Q-36 names "WMS-W7" as returns, while the returns row is WMS-8 and WMS-7 is packing. Owner: Q-36 (label), CH7-Q8 (walk-in and supplier scope).

## F-05 Recipient-initiated return request from the tracking page

Roadmap: not in any row. C3 proposes DEL-28 (wave 4, unless ruled earlier). Recipient tracking is DEL-8 and WEB-8 (wave 1); recipient reschedule and pin are DEL-14 and WEB-11 (wave 2).

1. **Definition and user goal.** The recipient opens the tracking link, asks to return or exchange, gives a reason and books a pickup. Goal: fewer calls and messages to the merchant, and a record of the request.
2. **Workflow.** Not in our docs. Our tokens cover `track`, `reschedule` and `address_pin` only (R domain-model 3.12; R staff-delivery.yaml, `purpose` enum). No approval state exists for a return request. Competitor flow: request by SMS link or dashboard, then approve or reject (C S9, S10, fetched or search).
3. **Business rules and edge cases.** Token expiry: `reschedule` and `address_pin` are 48 hours; `track` is order close plus 30 days (R staff-delivery.yaml `purpose` description; R integrations.md 5.1). A 7-day return window measured from receipt cannot run on 48 hours (inferred). KSA: 7-day withdrawal right from receipt, unless used (W1 fetched, quoting Article 13; W2 search). Refund and return cost rules differ (W1).
4. **Data.** New `purpose` value (contract change on the token enum); a return request entity (reason from the account list, status, approver, linked return order id); no entity exists in R domain-model section 3.
5. **Surfaces.** Recipient page (new return page; WEB-11 covers reschedule and pin only); staff approval view (none); template for the request confirmation (none in R integrations.md 5.1; approval per ADR-0037).
6. **Permissions, roles and audit.** Recipient token permissions are `delivery.tracking.view`, `reschedule`, `pin_address` (R contracts README); a new `return` permission and a staff approval permission are needed (inferred). Audit through `del_order_events`.
7. **Dependencies.** DEL-8 token, DEL-18 return order (F-01), INT-3 and INT-7 templates, quiet hours (R integrations.md 5.4). D-24 limits what the public view shows; a return page must not expose more.
8. **Metrics.** Requests per 100 delivered orders; approve and reject rate; request-to-pickup time.
9. **How the market builds it.** OTO: return request by SMS link or dashboard, approve or reject, branded portal (C S9, S10). Torod: self-serve returns portal with reverse label and merchant-set conditions (P3 row 12; T1, T32). Happy Returns and AfterShip list portals with reasons (C S22, S23, fetched or search). Loop lists approvals and fraud flags (C S21).
   - Chosen shape: a `return` purpose on the token with its own expiry set by the account's return window; a request entity with an approval state (requested, approved, rejected); on approval a `return_pickup` order (F-01). Reason: Torod keeps the parent order (P3) and OTO approves (C S9). This pulls part of DEL-18 forward and needs the template in INT-7.
   - Differs from the roadmap: yes (wave, token purpose, approval state).
10. **Roadmap mapping.** Missing. Owner: CH7-Q4 (wave, approval default, and token window).

## F-06 Walk-in store returns

Roadmap: WMS `createReturn` accepts source `walk_in` (WMS-8 API). No Delivery kind and no UI in roadmap text.

1. **Definition and user goal.** A customer returns goods at the merchant's store; the return is recorded in the warehouse.
2. **Workflow.** Expected return with source `walk_in` (`createReturn`), then receive, then disposition (F-04). No pickup and no Delivery order (R staff-wms.yaml; inferred for the no-order part).
3. **Business rules and edge cases.** No KSA rule on store returns was found in the sources read (inferred gap). Refund at the store is the merchant's point-of-sale matter and is outside the product (inferred). Salla handles store returns from the order page and asks to restock (C S2, fetched; C2 S4).
4. **Data.** Return with `source` `walk_in` and `source_ref` (free string, no link to the customer or order). No store or customer link (R domain-model 4.8).
5. **Surfaces.** WMS API; WEB-17 screen (wave 4).
6. **Permissions.** `wms.returns.write`.
7. **Dependencies.** WMS-8; channel order reference if the merchant uses a channel (INT-11, inferred).
8. **Metrics.** Walk-in returns per store per month; restock rate.
9. **How the market builds it.** Happy Returns: return in store (C S22, fetched). Logestechs: buy online, return in store (P4 L8, claim only). Salla: store returns from the order page (C S2).
   - Chosen shape: WMS-only record with `walk_in` source; no refund and no customer link in our system. Reason: the sources show store returns as a point-of-sale function, and the domain has no customer entity to link to.
   - Differs from the roadmap: no; the scope is unconfirmed (owner question).
10. **Roadmap mapping.** Partial: API present in WMS-8, no UI, scope not ruled. Owner: CH7-Q8 (C3 owner question 10 in the census).

## F-07 Return to supplier

Roadmap: no row. Suppliers and purchase orders exist (WMS-4, R domain-model 4.3).

1. **Definition and user goal.** A merchant sends faulty or unwanted stock back from a site to its supplier.
2. **Workflow.** Not defined. `pickup_request` collects from a third party to the site, the inbound direction only (R domain-model 3.1).
3. **Business rules and edge cases.** Movement reasons are a closed list `receipt, putaway, pick, pack, handover, delivery, return, adjustment, count, consumption, transfer` (R domain-model 4.4); no supplier-return reason exists. Open question in the census (C2 Q-U14).
4. **Data.** None defined.
5. **Surfaces.** None.
6. **Permissions.** None defined.
7. **Dependencies.** WMS-4 purchase orders and suppliers; DEL-2 for an outbound order (inferred).
8. **Metrics.** Supplier return rate by supplier (inferred).
9. **How the market builds it.** No source read named return to supplier. Teardown notes do not cover it (inferred from P1 and P2 coverage).
   - Chosen shape: not chosen. It needs an owner ruling first. If ruled in: an outbound kind (site to supplier) and one new movement reason, both domain changes.
   - Differs from the roadmap: missing.
10. **Roadmap mapping.** Missing. Owner: CH7-Q8.

## F-08 Exchange allocation held until receipt

Roadmap: no row. ShipHero proposal DEL-18a in P2 (section 6, item 8).

1. **Definition and user goal.** The replacement is not allocated (reserved) from stock until the original is received, so stock is not committed twice.
2. **Workflow.** Not defined. Allocation reserves stock on pickable locations and picking moves it (R domain-model 4.10). ShipHero holds exchange allocation until return release, which is a flag set on the order (P2 D8, D13).
3. **Business rules and edge cases.** In a one-stop exchange the out and in items move in the same visit (R domain-model 3.1). The gate therefore has two readings: the driver's door scan of the in item, or the site receipt after the visit. The sources do not settle which (see CH7-Q2). Partial outcome applies (F-02).
4. **Data.** Reservation rows (R domain-model 4.5); a link from the reservation to the return. Not defined.
5. **Surfaces.** WMS fulfilment screens (WEB-15 for pick and pack, wave 3); driver app scan (door scan variant only).
6. **Permissions.** `wms.fulfilment.manage` (inferred).
7. **Dependencies.** WMS-6 reservations (R roadmap WMS-6); WMS-8; DEL-18.
8. **Metrics.** Double-ship count (must be zero); allocation hold time (inferred).
9. **How the market builds it.** ShipHero: `dont_allocate_exchange_until_return_release` (Aug 2026) (P2 D8, D13); the teardown marks it as "borrow" (P2 section 5, item 19).
   - Chosen shape: borrow the concept (hold the out-item allocation until a named gate). The gate is an owner choice (CH7-Q2). Reason: a one-stop exchange has no separate receipt step as ShipHero does.
   - Differs from the roadmap: yes (new rule).
10. **Roadmap mapping.** Missing. Owner: CH7-Q2.

## F-09 COD reversal on return

Roadmap: no row. C3 proposes the entry type in DEL-23 (wave 2) and the return path after DEL-18 (wave 4).

1. **Definition and user goal.** When a parcel comes back after cash was collected (or an order is cancelled after collection), the collected amount is reversed so the driver, the cash report and the merchant's view stop counting it as owed.
2. **Workflow.** Not defined. Custody runs `collected` to `with_cashier` to `with_bank`, forward only (R domain-model 3.16). No state reverses a collection. A reversal needs a new state or a reversing entry.
3. **Business rules and edge cases.** D-19: custody moves forward only, entries are never updated or deleted (R domain-model D-19). D-18: card, mada and wallet start and stay `not_held` (R domain-model D-18), so only cash reversals touch custody. Refund practice (W1 fetched, 2026-11-02): card refunds go to the same card, with deposit time set by the issuing bank; no mada window is stated on the page. The census states Salla's mada window as 30 days and Visa or Mastercard as about 14 days (C S2); the re-read did not confirm either figure. Salla refunds to the store wallet or the original gateway (C S2). Geidea partial refunds on card, capped cumulatively (C S27, fetched).
4. **Data.** New custody state `reversed`, or a reversing collection row. Both change D-19 or 3.16 (R domain-model). A cashier-side payout to the recipient is a new cash outflow entry (inferred).
5. **Surfaces.** Cash desk (WEB-10, wave 2); driver cash tab (wave 2 fields); no merchant view; webhook `delivery.cod.collected` exists but has no reversed counterpart (R domain-model 6.3).
6. **Permissions.** Cashier records the payout (`delivery.cash.receive`); a dispatcher cannot (R contracts README role table).
7. **Dependencies.** DEL-11 custody; DEL-18; F-12 refund trigger; ADR-0007 (R adr/0007).
8. **Metrics.** Reversed amount per day; reversal lag (return to reversal); cash-report difference after reversals (inferred).
9. **How the market builds it.** Salla refunds to wallet or gateway (C S2). Torod's COD statuses run under review, collected, transferred; no reversal step is described (P3 row 13). Fulfillor's expected COD follows the delivery outcome, with seven difference classes (P5 F14, fetched). The market sources do not show a custody-level reversal. The ADR-0007 claim that Logestechs has a deficit ledger and mass COD report is not on the public pages (P4 section 7, item 1).
   - Chosen shape: our own. A custody state `reversed` reachable only from `collected` (cash still with the driver) or `with_cashier` (before deposit), with a separate cashier payout entry when money goes back to the recipient. Reason: D-19 already forbids edits, and a terminal branch keeps the moves forward. Needs a new ADR that supersedes the forward-only clause of ADR-0007.
   - Differs from the roadmap: yes (new state and an ADR).
10. **Roadmap mapping.** Missing. Owner: CH7-Q1, CH7-Q7, CH7-Q11.

## F-10 Damage and loss claims with evidence and status

Roadmap: no row. C3 proposes DEL-27 (claims and disputes) in wave 3, after DEL-7, DEL-11 and DEL-18.

1. **Definition and user goal.** A record of goods damaged or lost in our custody (driver, site or warehouse), with evidence, a value, a status and a decision. Goal: a merchant claim can be answered from the record.
2. **Workflow.** Not defined. Proposed: a claim is opened against an order by a dispatcher or site staff member, evidence is attached, a decision is recorded, and the outcome is a liability entry (F-13) or a write-off. Competitor practice: DHL UK requires proof of receipt, photos of parcel and contents, proof of value, and damage recorded on the proof of delivery, within a set time (C S37, search, UK policy, not KSA).
3. **Business rules and edge cases.** Claim value uses declared value in halalas (R domain-model 3.2). No KSA claim time limit was found (inferred gap). Damage must be recorded at delivery for a carrier claim (C S37); for our own fleet the same rule is a proposal, not a source fact.
4. **Data.** No aggregate (R domain-model sections 3 and 4). Proof kinds are `photo`, `signature`, `recipient_otp`, `id_check`; no damage kind (R domain-model 3.10). Proofs are deleted two years after `terminal_at` (R data.md section 10), which can be earlier than a claim's close (inferred). Storage through signed URLs (R domain-model 3.10; ADR-0015).
5. **Surfaces.** None in roadmap. Driver deliver flow has photo proof only (DRV-4). Staff screen not planned.
6. **Permissions.** None defined. A liability outcome needs `delivery.liability.record`, which only the owner role holds by default (R contracts README role table).
7. **Dependencies.** DEL-7 proofs; DEL-11 liability; DEL-18 and WMS-8 condition at receipt; storage; staff notification (DEL-21 in C3, wave 2).
8. **Metrics.** Claim ageing (days open by status); claims per 1,000 delivered; claim value; approval rate; time to decision.
9. **How the market builds it.** DHL UK and Packlink for DPD list evidence per claim (C S37, S38; search). ShipHero and Logestechs: no claim object found in the sources read (inferred).
   - Chosen shape: our own claim aggregate: order id, kind (`damage`, `loss`, `wrong_item`), value, status (`open`, `evidence_requested`, `decided` with approved or rejected, `settled`), and a link to a liability entry or a write-off. Evidence is either a new proof kind (`damage_photo`) or claim evidence rows pointing at the same storage. Proofs linked to an open claim are not deleted by the retention job. Reason: the order's proofs expire before a claim closes, and no market source gives a KSA rule.
   - Differs from the roadmap: yes. The C3 wave 3 placement conflicts with its dependency on DEL-18 (wave 4); the lead must move one of them.
10. **Roadmap mapping.** Missing. Owner: CH7-Q5, CH7-Q6, CH7-Q10.

## F-11 Customer disputes linked to proofs

Roadmap: no row. C1 proposes a dispute record in wave 2 or 3; C3 includes disputes in DEL-27 (wave 3).

1. **Definition and user goal.** A recipient says a parcel was not received, or disputes the amount. The record holds the statement, the linked proofs, the events and the outcome.
2. **Workflow.** Not defined. Proposed: opened by merchant or support against a delivered order; proofs and events attached by id; investigation; outcome upheld or rejected; an upheld dispute drives a refund trigger (F-12) or a liability entry (F-13).
3. **Business rules and edge cases.** `delivered` needs the account's required proofs (D-7). Proof rows are written with the status change even if upload lags (D-17). Events are append-only (D-15). The public view exposes status, ETA, driver first name and last position only (D-24); proofs are not public (R domain-model 3.18). `recipient_otp` is a proof kind but has no template and no driver capture step (C1, module 1; R integrations.md 5.1; C3 DRV-8). DHL UK uses a written recipient statement and an investigation (C S37, search).
4. **Data.** Proofs (`del_proofs`: kind, storage key, sha256, `upload_status`) and events. A dispute entity is not defined. Retention: proofs two years after `terminal_at` (R data.md section 10), which can end before a dispute does (inferred). Recipient personal data (Q-37 keeps it for the life of the account).
5. **Surfaces.** WEB-5 proofs tab (read); no dispute screen; no recipient statement form.
6. **Permissions.** `delivery.proofs.read` (dispatcher, site staff). A dispute write permission is not defined (inferred).
7. **Dependencies.** DEL-7, DEL-8, INT-3 messages, F-12, F-13.
8. **Metrics.** Disputes per 1,000 delivered; upheld rate; open age; share of COD orders in disputes (inferred).
9. **How the market builds it.** Onfleet and Tookan show proof photo and signature on the tracking page (C S15 fetched, S18 search). DHL UK: written statement and investigation (C S37).
   - Chosen shape: adapt. Link disputes by id to proofs and events, not free-text copies; keep proofs off the public page (D-24); outcome drives F-12 or F-13. Reason: the domain already has append-only events and proof ids; a dispute record reuses them.
   - Differs from the roadmap: yes (new entity; the wave is open).
10. **Roadmap mapping.** Partial (proofs in DEL-7). Missing: dispute entity, the `recipient_otp` capture step. Owner: CH7-Q10 and the OTP question in C3 section 4, item 7.

## F-12 Refund triggers

Roadmap: `delivery.order.returned` exists (R domain-model 6.3; wave 4 webhooks INT-10). No refund event.

1. **Definition and user goal.** A signal that goods came back or were not delivered, so the merchant's system (or a money action) can refund. Goal: no manual refund chase.
2. **Workflow.** Today the only signal is `delivery.order.returned` at `failed` to `returned`. It carries `order`, `returned_at` and `items` as sku and quantity (R public.yaml `DeliveryOrderReturned`; R webhooks.md payload table). Refund itself is outside the product; payment processing is gated by ADR-0017.
3. **Business rules and edge cases.** KSA: a refund within 14 days after a withdrawal or cancellation is stated in a Ministry amendment notice, read via search and secondary summaries only (W2; the notice itself was not opened). Late delivery over 15 days allows cancellation with full refund (W2, search, Arab News). Tabby refunds within 180 days of creation (C S35, search). Geidea partial refunds on card only (C S27).
4. **Data.** Payload has no amount, no reason and no kind; COD amount is not in the payload (R public.yaml). Prepaid or COD status of the order is not visible to Delivery (inferred; channel orders carry COD, R domain-model 6.3 `core.channel_order.received`).
5. **Surfaces.** Merchant webhooks (INT-10, wave 4); no refund screen.
6. **Permissions.** Webhook subscriptions: `core.webhooks.manage` (R contracts README).
7. **Dependencies.** INT-10 and ADR-0040 signing; ADR-0024 outbox; F-09 reversal; F-02 second field.
8. **Metrics.** Refund lag (goods received at site to trigger sent); triggers per return; triggers for orders that were then delivered (should be zero).
9. **How the market builds it.** ShipHero: a return's status "Complete" triggers the refund; the teardown's borrow note says a refund is a finance event, not a status write (P2 D13, section 5 item 17). Salla: refund to wallet or gateway (C S2). Tabby: refund endpoint and window (C S35).
   - Chosen shape: our own event `delivery.refund.due` emitted at the same transition as the return receipt at the site, with `amount` in halalas, a `method` hint and the order and return ids; the existing `delivery.order.returned` stays. Reason: ShipHero's split (status and refund) and the domain's rule that corrections are entries, not status writes (R domain-model D-8). Event catalogue change under ADR-0027.
   - Differs from the roadmap: yes (new event).
10. **Roadmap mapping.** Partial. Owner: CH7-Q7 (who refunds, store credit) and CH7-Q11 (refund windows verified with the acquirer).

## F-13 Liability charged to drivers (goods)

Roadmap: DEL-11 liability entries exist for cash (R domain-model 3.11, D-20). Goods reasons are absent.

1. **Definition and user goal.** A driver owes money for goods lost or damaged on a run, recorded as a liability entry, which may affect the driver's balance.
2. **Workflow.** Not defined. Proposed: claim decided (F-10) then liability entry for the driver, optionally cleared by a supervisor (reason `clearance`).
3. **Business rules and edge cases.** `DriverLiabilityEntry.reason` is a closed enum: `handover_deficit`, `handover_surplus`, `clearance`, `write_off`, `correction` (R components.yaml `DriverLiabilityEntry`). No goods reason exists. The cash block (D-11) is for cash only. D-20 ties entries to handovers; the goods case has no handover (R domain-model D-20). Whether damage costs go to drivers is an HR and legal question (C1 unanswered 11; C3 owner question 10).
4. **Data.** Entries are append-only (R domain-model section 8, append-only triggers). `handover_id` or `reference` required (R staff-delivery.yaml `LiabilityEntryRequest`). A claim id reference would be new.
5. **Surfaces.** Driver app cash tab lists liability (`driverListLiability`, wave 2; R driver.yaml); staff `recordDriverLiability` (R staff-delivery.yaml).
6. **Permissions.** `delivery.liability.record`: owner only by default; dispatcher and cashier do not hold it; driver reads own entries (R contracts README).
7. **Dependencies.** F-10 claims; DEL-11; DEL-13 driver pay statements (wave 2; pay effect not defined).
8. **Metrics.** Liability balance per driver; write-off amount; share of claims charged to drivers (inferred).
9. **How the market builds it.** Detrack and Shipsy hold cash shortages per driver (C S19, S20; search and fetched). No market source read charges goods loss to a driver.
   - Chosen shape: adapt the existing entry table with new reasons `goods_damage` and `goods_loss`, only after the owner rules that drivers can be charged. Keep the cash block for cash only. Reason: a goods liability is not a cash difference, and the closed enum is a contract change. Needs a contract change and, given the HR and legal angle, an owner decision before any build.
   - Differs from the roadmap: yes (not in roadmap; a contract enum change).
10. **Roadmap mapping.** Partial (cash only). Owner: CH7-Q5.

## F-14 Void attempt

Roadmap: DEL-14 (wave 2, with reschedule and pin), `voidAttempt` x-wave 2.

1. **Definition and user goal.** A dispatcher corrects an attempt recorded in error (wrong reason, wrong driver tap), so it no longer counts toward max attempts and the record stays honest.
2. **Workflow.** `POST /orders/{id}/attempts/{attempt_id}/void` with a reason (R staff-delivery.yaml `voidAttempt`). Transition `open` to `voided`, audited (R domain-model 3.15). `failed` attempts have no void transition in 3.15.
3. **Business rules and edge cases.** `invalid_transition` (409) for any attempt not `open` (R staff-delivery.yaml; R errors.md section 1). A `failed` attempt must have a reason code (R data.md `del_attempts` CHECK). Max attempts (D-14) can move the order to `failed` before a correction happens. Corrections after a terminal state are audited notes and entries, not status changes (D-8). Dispatcher override of max attempts is open (Q-3).
4. **Data.** `del_attempts.status`; audit row in `core_audit_log`; the void reason in `ReasonRequest` (R staff-delivery.yaml).
5. **Surfaces.** API; WEB-5 attempts list (read); no void action in WEB-11 (reschedule and pin dialogs).
6. **Permissions.** `delivery.orders.dispatch` (dispatcher) (R staff-delivery.yaml).
7. **Dependencies.** DEL-14; D-14 attempt count; order status if `failed` already happened.
8. **Metrics.** Voids per dispatcher (abuse signal); void rate per 100 attempts (inferred).
9. **How the market builds it.** Logestechs has `PackageFailure` and `DriverFailFollowUp` schema names; no void behaviour is described (P4 D2, schema names only). No other source read.
   - Chosen shape: our own correction. Add `failed` to `voided` for a dispatcher only, with a reason and an audit row, and a stated effect on `attempt_count`. If the order was already moved to `failed` by D-14, the dispatcher uses the reschedule path (F-03), not a silent revert (inferred). Reason: the case that needs correcting is a recorded failure.
   - Differs from the roadmap: yes (state machine change in 3.15 and an effect rule in D-14).
10. **Roadmap mapping.** Partial (DEL-14). Owner: CH7-Q9 and Q-3.

---

## Owner questions proposed by this chapter

These are new ids for the lead to assign; the existing Q-4 and Q-6 are cited where they apply.

| ID | Question | Features | Source of the question |
|---|---|---|---|
| CH7-Q1 | Exchange: add a second money field; who pays the recipient at the door and how a net amount settles | F-02, F-09 | P4 D5; R domain-model D-4, D-19 |
| CH7-Q2 | Exchange: does the out item's allocation release at the door scan of the in item or at site receipt | F-08 | P2 D8; R domain-model 3.1 |
| CH7-Q3 | Return window in days from receipt, and who bears return shipping | F-01, F-05 | W1, W2 (secondary) |
| CH7-Q4 | Recipient return request: wave (pull forward from 4), approval default, token window | F-05 | C3 DEL-28; C1 unanswered 4 |
| CH7-Q5 | May goods damage or loss be charged to drivers, and which reasons | F-10, F-13 | C1 unanswered 11; C3 Q10 |
| CH7-Q6 | Claims: wave (C1 says 3, C3 places it in 3 after wave-4 DEL-18), filing time limit | F-10 | C1 module 3; C3 DEL-27 |
| CH7-Q7 | Refunds: who issues them (merchant from a webhook, or Eeasy), and is store credit in scope | F-09, F-12 | C1 unanswered 9 |
| CH7-Q8 | In scope before wave 4: walk-in store returns, return to supplier | F-06, F-07 | C1 unanswered 10; C2 Q-U14 |
| CH7-Q9 | Void: allow `failed` to `voided` for dispatchers; may a dispatcher exceed max attempts (extends Q-3) | F-14 | R domain-model 3.15, D-14 |
| CH7-Q10 | Evidence retention while a claim or dispute is open, beyond two years after `terminal_at` | F-10, F-11 | R data.md section 10; R domain-model D-7 |
| CH7-Q11 | Refund windows for mada and card, verified with the acquirer or bank, before any refund SLA | F-09, F-12 | W1 (no mada window); C S2 (unconfirmed figures) |

Existing register items touched: Q-3 (max attempts override), Q-4 (exchange one order), Q-6 (door refusal counts as an attempt), Q-36 (WMS-W7 label mismatch), Q-37 (recipient data kept for account life).

## Roadmap and contract defects found while writing

| # | Where | Defect | Proposed fix |
|---|---|---|---|
| D1 | R roadmap WMS-8 row | Cites "W-7"; the returns rule is W-17 (W-7 is the StockLevel invariant) | Change the reference |
| D2 | R roadmap Q-36 | Calls "WMS-W7" returns and "WMS-W8" channel publication; the rows are WMS-8 and INT-12 | Relabel |
| D3 | R staff-wms.yaml `CreateReturnRequest` | Source enum lacks `delivery_return` present in R domain-model 4.8 and R data.md | Add the value |
| D4 | R roadmap DEL-27 (C3) | Wave 3, but depends on DEL-18 (wave 4) | Move the claim order to 4, or split the claim part of DEL-18 |
| D5 | R staff-delivery.yaml `voidAttempt` | Only `open` attempts can be voided, and a dispatcher rarely sees an open attempt | See F-14 |
| D6 | R public.yaml `DeliveryOrderReturned` | No money, no reason, no kind | See F-12 |

## Unanswered

1. Mada and card refund windows: the census figures (30 days and about 14 days, C S2) are not on the 2026-11-02 re-read of the Salla page (W1), which ties card refunds to the issuing bank.
2. The KSA return and refund periods rest on secondary sources (W1 quoting Article 13; W2 quoting a Ministry amendment notice). The statute text and the Ministry notice were not opened (the notice fetch failed on a certificate error). Counsel to confirm.
3. UAE return window: sources conflict between 7 and 14 days (W3, search only).
4. Whether Logestechs runs a per-parcel COD chain and deficit ledger: ADR-0007 cites it, the public pages do not show it (P4 section 7, item 1).
5. Who bears return shipping cost and whether it can be charged to the recipient (W1 says store policy governs).
6. Exchange: how a net amount settles, and who records a payout at the door (D-19 bars the driver).
7. Whether a door refusal is an attempt (Q-6), which changes whether returns start from `failed`.
8. Which stock reason and location the return-to-supplier and exchange-hold flows should use (no source).

## Feature index

| Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|
| F-01 Return pickup order | partial | DEL-18 | 4 | Q-4; CH7-Q3 |
| F-02 Exchange in one stop, two money fields | partial | DEL-18 | 4 | Q-4; CH7-Q1 |
| F-03 Return to origin and site check-in | partial (state and API covered; no check-in screen) | DEL-2, check-in API | 1 | Q-3; Q-6 |
| F-04 Return dispositions into stock | covered; references wrong | WMS-8 | 4 | Q-36 (label) |
| F-05 Recipient-initiated return request | missing | none (DEL-28 in C3) | 4 (proposed 2) | CH7-Q4 |
| F-06 Walk-in store returns | partial | WMS-8 | 4 | CH7-Q8 |
| F-07 Return to supplier | missing | none | none | CH7-Q8 |
| F-08 Exchange allocation held until receipt | missing | DEL-18 (DEL-18a in P2) | 4 | CH7-Q2 |
| F-09 COD reversal on return | missing | DEL-23 (C3 proposal) | 2 (entry), 4 (flow) | CH7-Q1; CH7-Q7; CH7-Q11 |
| F-10 Damage and loss claims | missing | DEL-27 (C3 proposal) | 3, blocked by DEL-18 | CH7-Q5; CH7-Q6; CH7-Q10 |
| F-11 Customer disputes linked to proofs | partial | DEL-27 (C3 proposal) | 2 or 3 | CH7-Q10 |
| F-12 Refund triggers | partial | INT-10 plus proposed event | 4 | CH7-Q7; CH7-Q11 |
| F-13 Liability charged to drivers | partial (cash only) | DEL-11 | 2 | CH7-Q5 |
| F-14 Void attempt | partial | DEL-14 | 2 | Q-3; CH7-Q9 |

## Source registry

Repo sources, read 2026-11-02 from `origin/main` at `6ca087e` (worktree `docs/feature-book-07-returns`):

| ID | Path | Used for |
|---|---|---|
| R domain-model | `docs/architecture/domain-model.md` | 3.1, 3.2, 3.3, 3.10, 3.11, 3.12, 3.13, 3.15, 3.16, 3.18 (D-4, D-7, D-8, D-14, D-15, D-17, D-18, D-19, D-20, D-24), 4.1, 4.3, 4.4, 4.5, 4.8, 4.10, 4.16, 6.3, section 9 |
| R integrations.md | `docs/architecture/integrations.md` | 5.1 templates, 5.4 quiet hours |
| R staff-delivery.yaml | `docs/contracts/openapi/staff-delivery.yaml` | `checkInReturn`, `voidAttempt`, `rescheduleOrder`, attempts, `purpose` enum, `ReasonRequest`, `LiabilityEntryRequest` |
| R staff-wms.yaml | `docs/contracts/openapi/staff-wms.yaml` | returns operations, `CreateReturnRequest`, `ReceiveReturnRequest`, `DispositionRequest` |
| R components.yaml | `docs/contracts/openapi/components.yaml` | `Attempt`, `Return`, `DriverLiabilityEntry`, `Order.kind` |
| R public.yaml | `docs/contracts/openapi/public.yaml` | `DeliveryOrderReturned`, `WmsReturnReceived` |
| R webhooks.md | `docs/contracts/webhooks.md` | webhook rows and payload examples |
| R errors.md | `docs/contracts/errors.md` | error codes |
| R roadmap | `docs/roadmap.md` | DEL-14, DEL-18, WMS-8, WEB-5, WEB-17, INT-7, INT-10, DEL-27 (C3), Q-3, Q-4, Q-6, Q-36, Q-37 |
| R data.md | `docs/architecture/data.md` | `del_attempts`, `del_driver_liability_entries`, `wms_returns`, retention section 10 |
| R driver-app.md | `docs/architecture/driver-app.md` | order detail kinds, attempt reason, cash tab |
| R platform.md | `docs/architecture/platform.md` | proof retention default, section 6 |
| R contracts README | `docs/contracts/README.md` | permission strings and role bundles |
| R ADR | `adr/0007`, `0005`, `0017`, `0037`, `0040`, `0011` | cited decisions |
| C S2, S4, S8, S9, S10, S15, S16, S18, S21, S22, S23, S27, S35, S37, S38 | `origin/docs/feature-coverage:docs/research/features-recipient-cash-returns-2026-11.md` (C1) and `features-wms-2026-11.md` (C2), read 2026-11-02; source URLs are in each note's registry. S37 is the DHL UK claims policy PDF (UK, not KSA). | market facts, grades as in the note |
| C3 | `origin/docs/feature-coverage:docs/research/feature-coverage-2026-11.md` | proposals DEL-23, DEL-27, DEL-28, DEL-29 and the owner questions |
| P2 | `origin/docs/platform-teardowns:docs/research/shiphero-teardown-2026-11.md` | D8, D11, D13, D15 (developer.shiphero.com flows/returns), section 5 items 17 to 19, section 6 item 8 |
| P3 | `origin/docs/platform-teardowns:docs/research/teardown-torod-2026-11.md` | product map rows 12 to 16, section 6 proposals A5 and A6, sources T1, T20, T24, T27, T32 |
| P4 | `origin/docs/platform-teardowns:docs/research/teardown-logestechs-2026-11.md` | D2, D4, D5 (shipment types `SWAP`, `BRING`), L6, L8, section 7 item 1 |
| P5 | `origin/docs/platform-teardowns:docs/research/teardown-fulfillor-2026-11.md` | F14 (https://fulfillor.com/cod-reconciliation-middle-east-3pl), F1, F6, COD settlement classes |
| P1 | `origin/docs/platform-teardowns:docs/research/platform-comparison-2026-11.md` | sections 2 and 4, exchange shape question (section 5 item 4) |
| W1 | https://help.salla.sa/en/article/returns-and-refunds-for-shoppers-en/jfqqyp72i8hfci4riwvxcci3 (fetched 2026-11-02; page dated 2026-09-29) | 7-day withdrawal, card refund, return cost statements |
| W2 | Search 2026-11-02 on the Saudi e-commerce law: https://cms.law/en/sau/legal-updates/Saudi-Arabia-implements-its-new-E-Commerce-Law ; https://tamimi.com/law-update-articles/add-to-cart-new-e-commerce-law-in-saudi-arabia ; https://help.salla.sa/en/article/e-commerce-law/di3p4uro9bna3ezsld2fjznr ; https://arabnews.pk/node/1696931 ; https://mc.gov.sa/en/mediacenter/News/Pages/24-11-20-01.aspx (not opened: certificate error) | 7-day withdrawal, 15-day late-delivery cancel, 14-day refund notice (secondary) |
| W3 | Search 2026-11-02 on UAE consumer and e-commerce law: https://cms.law/en/are/legal-updates/the-uae-s-new-consumer-protection-landscape-implications-and-key-provisions ; https://lylawyers.com/consumer-protection-in-the-uae | UAE window conflict (secondary) |
