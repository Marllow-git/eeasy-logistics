# Feature book 06: cash and COD finance

Date: 2026-11-02. Status: research input for the lead; no decision is taken here. Branch `docs/feature-book-06-cash` from `origin/main` (6ca087e). This is chapter 06 of the feature book; the inputs are the repo documents and branch notes listed in the source registry.

**Summary for the lead**

1. The cash path is fully specified on paper: custody `collected → with_cashier → with_bank`, D-18 `not_held` for card, mada and wallet, D-19/D-20 handover and liability in one transaction, D-21 report close, and the operations in `staff-delivery.yaml` and `driver.yaml` are wave-tagged.
2. Nothing in the repo reverses a collection. `delivered` is terminal (domain §3.13), so a COD parcel returned after delivery has no arrow that moves its custody. Merchant statement, per-order expected-versus-collected view, finance exports, COD eligibility and VAT on COD have no order.
3. Wave 1 gap: a replayed wrong PIN sets `cash_blocked` (DEL-7, wave 1), but the only clearing door, `clearDriverCashBlock`, is wave 2 (DEL-11). The wave-1 PIN reset clears the lock, not the block (DEL-4 §8.2 #19 lists what it clears).
4. Contract defect (checked 2026-11-02 with ajv): the `DepositRequest` conditional makes `reverses_deposit_id` required on every deposit, positive ones included.
5. Contract conflict: deposit reversal moves custody back to `with_cashier` (contract N8, `recordDeposit`), which breaks D-19 (forward only), the §3.16 arrows, and the CHECK and unique key in `data.md` §2.2.
6. Stale plan references: roadmap Q-15 and the DEL-4 plan still carry a 120-second PIN window and cite DEL-8 for cash figures and replay checks. The contract uses the H1 signal instead (REVIEW N5), and the roadmap gives cash to DEL-7 and DEL-11.
7. Role conflict: the dispatcher role holds `delivery.cash.read`, and the contract forbids combining a driver role with a cash permission (REVIEW M9, `role_combination_forbidden`), yet DEL-4 plan §8.2 #6 accepts `['dispatcher', 'driver']`.
8. Shapes the market suggests that differ from the roadmap: COD amount prefilled from the order and confirmed by the driver (Shipsy, Wasal), a merchant status view over custody (Torod), and seven difference classes for carrier settlement (Fulfillor, wave 4). Torod's transfer-to-merchant step does not fit, because no money passes through us in the current model.
9. KSA specifics: the 30-day mada refund window is a processor rule in secondary sources, while SAMA's Mada rules leave the refund timeframe to the merchant. Friday is the weekly off for remittance centres. The 15 percent VAT touchpoint is not settled by any source for COD fees.
10. Unanswered (section 6) includes money ownership and PSP licensing, the reversal shape, and the VAT treatment of `cod_amount`. Digital methods stay behind ADR-0017; card and mada are record-only (D-18).

## 1. Scope and reading rules

- Each fact cites a source ID from section 8. Repo facts were read 2026-11-02 at `origin/main` 6ca087e. Branch facts are carried from the note named, which was read 2026-11-02 at the commit shown in section 8, and were not re-fetched here. Web facts were read 2026-11-02 and are marked as fetched or search-only.
- `[inferred]` marks this researcher's reading. Everything unmarked is stated by the cited source.
- "Shape for us" is the current design (ADR or doc) and, where a teardown suggests a change, the adaptation for the lead to accept or reject. No architecture is decided here.
- Money is integer halalas (SAR, two decimals) in every contract today. Wave numbers follow `roadmap.md` §1.

## 2. Features

### 6.1 COD on the order and eligibility

1. **Definition and goal.** The amount the recipient owes on delivery, stated on the order so the driver collects exactly that. Goal: the merchant sets COD once and the driver cannot collect a different sum. [R1 §3.1, R2 `del_orders`]
2. **Workflow.** Set at `createOrder` or CSV import (DEL-2). Non-zero only for kinds `delivery` and `exchange` (D-4; `cod_not_allowed` for `return_pickup` and `pickup_request`). Locked from `picked_up` (`409 order_locked`); every change is audited with before and after (K-7, M7). Offline: the phone uses the order snapshot it holds; a mismatch at replay is `cod_amount_mismatch` (D-7).
3. **Rules and edge cases.** Integer halalas; `Money.currency` is the enum `[SAR]` only (R9). `allowed_cod_methods` defaults to `[cash]` and digital methods are "only after the owner gate of ADR-0017" (R9). No eligibility rule (cart value, weight, excluded items) exists in any ADR or contract. GCC: a three-decimal currency (BHD, IQD, JOD, KWD, LYD, OMR, TND) cannot be stored as the contract defines it (W6, B1 §2.1). KSA: whether `cod_amount` includes the 15 percent VAT is not stated [inferred gap].
4. **Data.** `del_orders.cod_amount bigint`, `currency`; mutable row, no personal data. Invariant D-4 and D-7; nightly assertion 4 (R2 §3.4). `wms_fulfilment_orders.cod_amount` carries the same field for WMS orders (R2 §2.3).
5. **Surfaces.** Merchant order form and detail COD panel (WEB-5, wave 1, `delivery.cash.read` for the panel); `createOrder`, CSV import; driver sees the amount on the stop (DRV-4).
6. **Permissions and audit.** Dispatcher holds `delivery.orders.create`; `cod_amount` changes write an audit row with before and after (K-7; R7 `staff-delivery.yaml` l.452).
7. **Dependencies.** DEL-2 (in progress, leg 1), DEL-7 for the sum check at delivery. No provider.
8. **Metrics.** COD share of orders; count of `cod_amount` edits; `cod_amount_mismatch` rejections at replay (proposed as alert [inferred]).
9. **Market.** Salla's COD fee and the SAR 20 minimum and SAR 1,000 maximum are secondary-source figures (B2 S1). Wasal stores `payment_amount` (expected) and `payment_collected` on the stop (B7 S5). Shipsy auto-captures COD from the shipment, so the driver never types it (B6 A8). Torod's shipment form has no COD step (B5 T26). **Shape for us:** our order-level amount with per-collection split (current, D-7). Adaptation to consider: prefill the driver's collection line from `cod_amount` and ask for confirmation [inferred from Shipsy and Wasal]. No ADR governs it yet.
10. **Roadmap.** Partial. Covered: DEL-2 and DEL-7 (wave 1). Missing: eligibility per account, proposed as DEL-19 (wave 2, B1 §3). Owner questions: B2 unanswered 8 and 10 (who sets limits and fees); U10, U11, U12.

### 6.2 Collection at the door, split methods

1. **Definition and goal.** At `delivered` the driver records one or more collections that sum exactly to `cod_amount`, each with a method (`cash`, `card`, `mada`, `wallet`). Goal: the driver records what was taken, in the right method, with a reference for non-cash.
2. **Workflow.** `delivered` writes the proofs and the collections in one transaction (D-7, D-17, D-18). The app validates locally: integer halalas, exact sum, a reference for every non-cash line, proofs of `proof_policy.cod` (R3 §5.1). A split (part cash, part mada) is two lines. Offline: the item goes to the outbox and replays (D-15). Exception: a sum mismatch is `422 cod_amount_mismatch`; a non-cash method outside `allowed_cod_methods` is `422 method_not_allowed`.
3. **Rules and edge cases.** Card, mada and wallet are recorded as collected elsewhere (ADR-0017); the app never takes a card payment, and those lines never enter cash totals (D-18). The cash PIN is required when any line is `cash` (driver.yaml `cash_pin` conditional). GCC: method enum is the same everywhere; no mada-specific validation of the reference format is defined.
4. **Data.** `del_cod_collections`: `order_id`, `driver_id`, `amount bigint > 0`, `method`, `external_reference`, `business_date`, `pin_review boolean` (R2 §2.2). Insert-only with trigger `core_reject_mutation` (R2 §3.1). `business_date` is the Asia/Riyadh date of `min(client_ts, server_ts)` (R8 `delivered` description).
5. **Surfaces.** Driver app delivery sheet (DRV-4, wave 1). Staff: `listOrderCollections` (wave 1), `listCollections` (wave 2). Recipient tracking shows no collection data (D-24 as summarised in B2 Module 1) [inferred]. Merchant webhook `delivery.cod.collected` (amount, method, custody) (R18).
6. **Permissions and audit.** Driver role `delivery.driver.cash`, which must not be combined with a staff role (M9). Collections are in the event payload, so the event row is the audit.
7. **Dependencies.** DEL-7 (wave 1; roadmap row cites ADR-0007, ADR-0008, ADR-0034), DRV-4, DEL-6 for assignment. No payment provider.
8. **Metrics.** Collections per method per day; split share; non-cash references missing (a validation rejection count); `pin_review` count.
9. **Market.** Torod's COD cycle begins with the carrier collecting on delivery and status "under review" (B5 T24). Shipsy's driver app captures COD at the door with a tamper-evident receipt (B6 A8). Fulfillor's COD is tracked, not custody-controlled (B4 row 23). Nearpay and Geidea SoftPOS are the card options named in B2 S28 and S29. **Shape for us:** record-only for non-cash, cash with custody, split as one line per method (current; ADR-0007, ADR-0017, D-18). We borrow the server-side proof gate and the tamper-evident receipt idea [inferred], not a payment capture.
10. **Roadmap.** Covered on paper (DEL-7 wave 1, DRV-4 wave 1). Not started: DEL-7 has no order file in `docs/orders`. Owner questions: Q-1 (offline conflict, field fact wins), Q-25 (keep rejected driver events with cash, default yes).

### 6.3 Cash PIN at collection and at replay

1. **Definition and goal.** A four-to-six-digit driver PIN attests that the driver, not someone holding the phone, recorded the cash and asked for handovers (document 4 §3.2).
2. **Workflow.** Set: first set or first set after a dispatcher reset needs an OTP; a change needs the current PIN (`driverSetCashPin`, DEL-4 §2.9). Live at the door: a wrong PIN is `403 cash_pin_invalid`, nothing is recorded, the key is not stored, so the driver can retype; five failures give `423 cash_pin_locked`. Replay (the device made an authenticated call after `client_ts`, the H1 signal): the fact is recorded (D-23), the failure counted, the driver set `cash_blocked`, and the response is `200` with `cash_pin_status: failed` (R8, R11 H2, N5).
3. **Rules and edge cases.** Five failures lock cash actions until a dispatcher resets (`resetDriverCashPin` clears hash, failures and lock, DEL-4 §8.2 #19). Locked drivers still deliver non-cash. The PIN is never stored, logged or hashed in the event (R8 `delivered`). Device verifier (ADR-0034, proposed): Argon2id, 19 MiB, two iterations, 16-byte salt; five local failures lock cash recording on the device; open Q-44 on the secure-store value and the React Native Argon2 library. Time window: the roadmap default is "120 s" (Q-15) and DEL-4 §2.9 cites a "120 s window" for DEL-8, but the contract decides by the H1 signal and says "never by `client_ts` age" (R8 `delivered`, REVIEW N5). [inferred: the roadmap line predates N5.]
4. **Data.** `del_drivers.cash_pin_hash` (Argon2id), `cash_pin_failures` (0 to 5), `cash_pin_locked_at`; `pin_review` on the collection (R2 §2.2, R2 §10). The PIN is personal data at rest, retained for the membership's life (R2 §10).
5. **Surfaces.** Driver app: PIN setup, PIN keypad, locked screen (driver-app §5.2). Staff: `resetDriverCashPin` (wave 1). `pin_review` appears only on the staff collection view (REVIEW H2).
6. **Permissions and audit.** Dispatcher holds `delivery.drivers.manage` for PIN reset (R12 role table). Audit rows `delivery.driver.cash_pin_set` and `delivery.driver.cash_pin_locked`, never the PIN (DEL-4 §2.9, §8.2 #19).
7. **Dependencies.** DEL-4 (merged 2026-11-02, #114, per roadmap §0), DRV-1 for the device verifier (wave 1), ADR-0034 accepted or replaced, DEL-7 for replay.
8. **Metrics.** Failed checks per driver per day; locks per week; time from lock to reset (dispatcher); replay PIN failures as a share of cash events [inferred].
9. **Market.** No teardown read shows a cash PIN. Shipsy uses biometric login and an OTP to the consignee for proof (B6 A8). Wasal's POD is signature or photo, not a PIN (B7 S7). **Shape for us:** own design (ADR-0034 proposed, the contract's `driverVerifyCashPin`). Reason in the ADR: door attestation offline, with the server re-check at replay so the verifier gates the app and never the ledger.
10. **Roadmap.** Covered (DEL-4, DRV-1, DEL-7). Open: Q-15 (window and six digits only) is stale against N5; Q-44 is open; ADR-0034 is proposed. Owner: U6.

### 6.4 Custody states and entries

1. **Definition and goal.** Where each cash collection physically is: with the driver (`collected`), with a cashier at a site (`with_cashier`), or in the bank (`with_bank`). Non-cash collections are `not_held`. Goal: the figure of record for cash is the ledger, not a counter.
2. **Workflow.** First entry on creation: `NULL → collected` (cash) or `NULL → not_held` (card, mada, wallet). `collected → with_cashier` on `confirmHandover` (DEL-11). `with_cashier → with_bank` on `recordDeposit` (DEL-12). Each move is a new entry recorded by the receiver, never the driver (D-19). Current custody is the latest entry (§3.11).
3. **Rules and edge cases.** Forward only (D-19, §3.16). CHECK in `data.md` §2.2 allows only those arrows. Unique `(account, collection, to_custody)`: each state at most once. Conflict: the reversal in `recordDeposit` moves custody back to `with_cashier` (R7, REVIEW N8), which is not an arrow and repeats a state (U2). Custody has no reversal arrow for a delivered collection (U1).
4. **Data.** `del_cash_custody_entries`: `collection_id`, `from_custody`, `to_custody`, `holder_type` (driver, cashier, bank_account), `holder_id`, `handover_id`, `deposit_id`, `recorded_by`, `created_at`. Append-only by trigger, truncate blocked (R2 §3.1). `bank_account` has no bank identity field (R9 `CustodyEntry`). Retention: life of the account, no personal data in the row (R2 §10 rule).
5. **Surfaces.** Staff: `listCustodyEntries` per collection (wave 2), `listCollections` with `custody` filter (wave 2). Driver: `driverListCollections` with `custody` (wave 1). Merchant webhook shows `custody` on `delivery.cod.collected` only (R18).
6. **Permissions and audit.** Cashier holds `delivery.cash.receive` and `delivery.cash.deposit`; never `delivery.liability.record` (R12). Separation: the cash holder (driver) cannot confirm (D-19; R15 §2).
7. **Dependencies.** DEL-7 (`collected`, `not_held`, wave 1), DEL-11 (`with_cashier`, wave 2), DEL-12 (`with_bank`, wave 2), INT-1 for slips only.
8. **Metrics.** Ageing of `with_cashier` (no metric defined in the sources, U14); settlement lag from `collected` to `with_bank` (not defined either).
9. **Market.** Shipox has four cash stages: to be collected, with driver, with cashier, with bank (B2 S7). Shipsy describes rider settlement with partial settlement (B2 S19). Torod's statuses are under review, collected, transferred (B5 T24). ADR-0007 credits Logestechs with a settlement report and deficit ledger that its public pages do not show (B3 §1). **Shape for us:** the four-state append-only chain with a PIN and a counted handover (current; ADR-0007). Borrow the status words for the merchant view (6.12), not a transferred state, because no money passes through us [inferred].
10. **Roadmap.** Covered (DEL-7, DEL-11, DEL-12). Owner questions: U1, U2, U3.

### 6.5 Cash in hand per driver

1. **Definition and goal.** How much cash each driver holds now, and since which business date. Goal: dispatch and the driver both see the same figure.
2. **Workflow.** `del_driver_cash_positions` is maintained in the same transaction as custody (R2 §3.3). `driverGetMe` shows cash figures from wave 1; `driverGetCash` is wave 2 (R8). The phone shows "confirmed SAR X" from the server and "waiting to sync SAR Y" for pending cash items (R3 §5.4).
3. **Rules and edge cases.** `cash_in_hand` = sum of cash collections whose latest custody is `collected`; never below zero (CHECK `>= 0`). `oldest_collected_business_date` drives the D-11 check. DEL-4 §8.2 #30 says the cash figures are zero "until DEL-8", which contradicts the roadmap (DEL-7 wave 1, DEL-11 wave 2) [inferred stale reference].
4. **Data.** `del_driver_cash_positions`: `driver_id` PK, `cash_in_hand`, `oldest_collected_date`, `liability_balance` (R2 §2.2). Projection, rebuildable from the ledger (R2 §3.5 step 4).
5. **Surfaces.** Driver cash tab (DRV-4 wave 1, cash lines), staff driver cash page `/drivers/[driverId]/cash` (web.md §8, wave 2; WEB-10 in the roadmap).
6. **Permissions.** `delivery.cash.read` for staff; dispatcher holds it (R12); the phone reads its own figures under `delivery.driver.cash`.
7. **Dependencies.** DEL-7 and DEL-11; DEL-4 (merged).
8. **Metrics.** Total cash in hand by site; drivers above a threshold (threshold not defined); `oldest_collected_date` age in days.
9. **Market.** Shipox shows pending amount per driver with a filter by name (B2 S7). Detrack shows per-driver expected, recorded, collected and shortages per day (B2 S20). **Shape for us:** projection from the ledger, two-line display in the app (current, R3 §5.4). Borrow Detrack's expected-versus-recorded split as a staff view [inferred].
10. **Roadmap.** Covered (DRV-4 and WEB-6 wave 1; DEL-11 for the staff view in wave 2). Owner questions: U4 (threshold and block link).

### 6.6 Cash block and its clearing

1. **Definition and goal.** A driver holding cash from a previous business day gets no new offers or assignments until a supervisor clears the block (D-11, ADR-0007). Goal: no new work for a driver who owes cash.
2. **Workflow.** Set when `oldest_collected_date` is before today (Asia/Riyadh) (D-11). Set also by a replayed wrong PIN (DEL-7, REVIEW H2). The offer path returns `422 driver_cash_blocked`; the phone shows a banner, "expected" offline (R3 §5.5). Clearing: `clearDriverCashBlock` with a note, audited (wave 2, owner role only).
3. **Rules and edge cases.** The current run continues; only new offers and assignments are blocked (D-11, R3 §5.5). **Gap:** the PIN-replay block (wave 1) has no clearing door before wave 2. The effects listed for `resetDriverCashPin` do not include `cash_blocked` (DEL-4 §8.2 #19). The sources do not say whether a handover lifts the block automatically or only a supervisor clearance does; the contract allows clearance while collections are still `collected` (U4). Friday and Saturday: a cash day collected Thursday night is blocked on Friday morning while remittance centres are closed on Friday [inferred interaction with W3].
4. **Data.** `del_drivers.cash_blocked_at`, `cash_blocked_reason`, partial index `WHERE cash_blocked_at IS NOT NULL` (R2 §2.2). An explicit stored flag, not derived; the audit row carries the clearance.
5. **Surfaces.** Driver banner (R3 §5.5). Staff: drivers page and cash desk (WEB-10, wave 2). Notification: `cash_block_notice` goes to home-site dispatchers who opted in (R16 §5.1); INT-7 lists it as a recipient message (R14). The feature-coverage note flags the same conflict (B1 §1).
6. **Permissions and audit.** `delivery.drivers.clear_cash_block` held by the owner set only (R12); clearance writes an audit row (R7). Dispatcher cannot clear.
7. **Dependencies.** DEL-11 for the clearing door and the handover; DEL-7 for the PIN-replay flag; INT-7 for the notice; OPS-5 runbook "clear a cash block".
8. **Metrics.** Blocked drivers now (domain §7 telemetry); block duration; blocks by reason (PIN replay versus previous-day cash).
9. **Market.** Shipsy's shortage triggers a hold (B2 S19 summary, search only). ADR-0007 also credits Logestechs with the block rule; B3 §1 did not check it. **Shape for us:** a stored flag with reason and an owner-only clear (current). Borrow nothing yet; the open rule is the wave-1 clearing door.
10. **Roadmap.** Partial: D-11 in DEL-11 (wave 2); PIN block in DEL-7 (wave 1) without a door. Owner questions: U4, U21 (`cash_block_notice` recipient or dispatcher).

### 6.7 Handover to the cashier with counted differences and liability

1. **Definition and goal.** The driver asks to hand a set of cash collections to a cashier at a site; the cashier counts, confirms, and any difference becomes a liability entry on the driver. Goal: the party at risk never attests their own handover (ADR-0007).
2. **Workflow.** `driverRequestHandover` (driver, PIN required, default collections are the driver's own `collected` cash in no other open handover). Expected amount is the sum. Cashier `confirmHandover` with `counted_amount` under a row lock: `collected → with_cashier` for every listed collection, and one liability entry for `counted − expected` if non-zero, in one transaction (D-20). `rejectHandover` with a reason. Online only for the driver (R3 §5.6).
3. **Rules and edge cases.** Sign convention: positive is deficit owed by the driver, negative is surplus or clearance (R9). Reasons: `handover_deficit`, `handover_surplus`, `clearance`, `write_off`, `correction`. A negative entry needs `approved_by` not the handover's cashier (`403 separation_of_duties`). The button is disabled while any cash item is pending sync (R3 §5.6). Friday and Saturday: no source defines weekend handover; the handover is at the merchant's site, not a bank [inferred].
4. **Data.** `del_cash_handovers` (`expected_amount`, `counted_amount`, `status` requested, confirmed, rejected, `pin_checked_at`), `del_cash_handover_collections` (unique), `del_driver_liability_entries` (signed `amount`, `CHECK amount <> 0`, append-only) (R2 §2.2, §3.1).
5. **Surfaces.** Driver cash tab and handover request (DRV-7, wave 2). Cash desk handovers page (WEB-10, wave 2). Webhook: `delivery.handover.confirmed` and `delivery.liability.recorded` are internal, not merchant-exposed (R18 l.159).
6. **Permissions and audit.** Cashier: `delivery.cash.receive`. Liability record: owner set only (`delivery.liability.record`), and the cashier never holds it (R12). Separation of duties: the driver holding cash cannot confirm (D-19); no second approver for a difference below any threshold (U8).
7. **Dependencies.** DEL-11 (wave 2) on DEL-7; DEL-4 PIN doors (merged); DRV-7 for the phone.
8. **Metrics.** Handover count and value per site per day; deficits and surpluses by driver; rejection rate; time from request to confirm (settlement lag, U14).
9. **Market.** Shipsy's route-close reconciliation: an agent reconciles, the system computes expected cash at close (B6 A8). Fulfillor's COD reconciliation has seven difference classes, but they apply to carrier settlements (B4 §6 A5). Shipox has a batch update to "with cashier" (B2 S7). **Shape for us:** driver-requested, cashier-confirmed, difference as a liability entry (current). The market's "person confirms what the system computes" matches our D-20 [inferred].
10. **Roadmap.** Covered (DEL-11 wave 2, DRV-7 wave 2, WEB-10 wave 2). Owner questions: Q-25 (rejected driver events with cash); U8 (maker and checker threshold).

### 6.8 Deposits with slip upload

1. **Definition and goal.** The cashier banks cash collected at a site and records the bank reference and a photo or PDF of the slip. Goal: the slip, the reference and the collections are linked, so the bank side can be matched.
2. **Workflow.** `createDepositSlipUpload` (sha256, content type jpeg, png or pdf, size up to 10 MiB, URL valid 10 minutes), then `recordDeposit` with `collection_ids`, `amount`, `bank_reference`, `deposited_at`. Each collection is deposited once; custody moves `with_cashier → with_bank` (D-19). The upload is single use and bound to the uploader and the account (N8). Corrections: a reversing deposit with the same collections (contract; see 6.4 conflict).
3. **Rules and edge cases.** `amount` must equal the sum of the listed collections (`deposit_sum_mismatch`, no tolerance). Card, mada and wallet lines are rejected (`method_not_allowed_for_cash`). **Defect:** the `DepositRequest` conditional makes `reverses_deposit_id` required on every deposit (checked 2026-11-02 with ajv: a positive 15000 deposit without a link is invalid, which is the defect). The intended rule, "negative needs a link", needs an `if` on `amount < 0` at the root. Reversal sets custody back to `with_cashier` (6.4). Weekends: remittance centres work Sunday to Thursday, Friday is the weekly off, Saturday is optional (W3). A Friday or Saturday cash day can close with cash at `with_cashier` (D-21), so the bank lag does not block a report [inferred].
4. **Data.** `del_cash_deposits`: `amount` (negative only when reversing, CHECK), `bank_reference`, `slip_storage_key`, `deposited_at`, `business_date`, `reverses_deposit_id`; `del_cash_deposit_collections` unique (R2 §2.2). Insert-only (R2 §3.1). Slip file: no retention row in `data.md` §10 (U15).
5. **Surfaces.** Cash desk deposits page (WEB-10, wave 2). Webhook `delivery.deposit.recorded` is internal (R18). Object storage for the slip (INT-1, not in the roadmap §0 progress table, 2026-11-02).
6. **Permissions and audit.** `delivery.cash.deposit` (cashier, R12). No second approver for deposits (U8).
7. **Dependencies.** DEL-11 on DEL-7; INT-1 (object storage, signed upload); PLAT-8 outbox for the event (R14 DEL-12 row lists ADR-0007, domain §3.11, §5.2, handbook 03).
8. **Metrics.** Deposits per day per site; bank references missing or duplicated (a validation count); deposit lag from `with_cashier` to `with_bank`; reversals per month.
9. **Market.** Shipsy describes depositing cash at the hub, with no bank-slip detail (B2 S19). Torod sends collected money to merchants on a plan schedule, which needs a holding position we do not have (B5 T2, T9, T24). **Shape for us:** our slip and reference with a reversing deposit (current). The reversal design is the part to fix (6.4, U2).
10. **Roadmap.** Covered on paper (DEL-12 wave 2). Defect in the contract (above). Owner questions: U2, U8, U15.

### 6.9 Cash reports per site and business date

1. **Definition and goal.** One cash report per site and Asia/Riyadh business date with totals by method, deficits and an immutable close (D-21). Goal: the day's cash closes with zero unexplained deficit (wave 2 exit).
2. **Workflow.** Open by default and built from ledgers. `closeCashReport` succeeds only when every cash collection of the date is `with_cashier` or `with_bank` and every difference has a liability entry (D-21); otherwise `409 cash_report_unbalanced`. Once closed, no change, enforced by a conditional trigger (R2 §3.1).
3. **Rules and edge cases.** Business date is the Asia/Riyadh date of `min(client_ts, server_ts)`. Offline collections therefore carry the client's date, which may be a date already closed; the sources do not say what happens to a late replay into a closed date (U5). Totals are `cash`, `card`, `mada`, `wallet` (R9 `CashReport`); card and mada totals are recorded, never reconciled to a processor. Friday and Saturday: the close is the merchant's calendar day, and bank deposits may lag [inferred].
4. **Data.** `del_cash_reports`: `site_id`, `business_date`, `cash_total`, `card_total`, `mada_total`, `wallet_total`, `deficits` (bigint), `status` open or closed, `closed_by`, unique `(account, site, date)` (R2 §2.2). The reporting view `rpt_site_day` (no wave assigned in `data.md`) and the table `rpt_daily_kpis` filled at 02:00 Asia/Riyadh (R2 §9).
5. **Surfaces.** Cash desk reports list and day page (WEB-10, wave 2; `getCashReport`, `listCashReports`). Owner dashboard "today" uses live views, not the report table (R2 §9).
6. **Permissions and audit.** `delivery.cash.close_report` held by the cashier (R12); a single role can receive, deposit and close (U8).
7. **Dependencies.** DEL-11, DEL-12; nightly assertions (6.10).
8. **Metrics.** Days closed on time; deficits per site per day; close attempts rejected as unbalanced.
9. **Market.** Fulfillor's COD view matches per order, not per day (B4 F14). Shipsy's route-close reconciliation is the nearest form (B6 A8). Torod's merchant COD view lists statuses and search, not a day close (B5 T24). **Shape for us:** day close per site with immutable record (current, D-21). Borrow nothing; the market evidence for day close is thin.
10. **Roadmap.** Covered (DEL-12 wave 2, WEB-10 wave 2). Owner questions: U5, U8.

### 6.10 Nightly cash assertions

1. **Definition and goal.** A nightly check that the cash projections equal the ledger, with drift shown as an alert. Goal: a bug in a projection cannot hide cash.
2. **Workflow.** Runs at 03:00 Asia/Riyadh on the platform role; results to the ops log and the "ledger assertion drift" metric; any non-empty result opens an alert (R2 §3.4, W-7). The same queries run in CI and the diagnose console.
3. **Rules.** Five cash assertions: every cash collection has a first `collected` entry; every non-cash collection has exactly one `not_held`; `cash_in_hand` equals the sum of collections whose latest custody is `collected`; `liability_balance` equals the sum of entries; each confirmed handover's `counted − expected` equals its entry; every delivered order with `cod_amount > 0` sums exactly; every closed report equals its recomputation (R2 §3.4 items 1 to 5). A rebuild procedure exists per account (R2 §3.5).
4. **Data.** Reads ledger and projection tables; writes nothing. The assertion results are ops-log rows, not personal data.
5. **Surfaces.** Ops log and the diagnose console (DEL-15, wave 2); the metric on the platform dashboard (platform §7).
6. **Permissions.** Platform role `elx_platform` (R2 §3.4); diagnose console for platform support, whitelisted fixes only (R12).
7. **Dependencies.** DEL-7, DEL-11, DEL-12; DEL-15 for the console; OPS-5 for the runbook.
8. **Metrics.** Drift count per night (target zero); time to rebuild a driver's position.
9. **Market.** No teardown read shows an assertion. Torod publishes a status and a schedule, not an invariant (B5 summary 7). **Shape for us:** own design (ADR-0007, data §3.4). Stated as a strength in the platform comparison, unverified in public sources (B3 §3).
10. **Roadmap.** Covered (DEL-12 wave 2; exit criterion "nightly assertions green" in §2 wave 2). Owner questions: none new.

### 6.11 COD reversal on return or cancellation

1. **Definition and goal.** When a COD parcel comes back, or an order is cancelled after its cash was taken, the collection must stop counting as owed cash and the merchant must see the reversal. Goal: a returned COD parcel never stays in cash totals.
2. **Workflow.** None exists. No arrow leaves `delivered` (terminal, domain §3.13), and `failed → returned` applies to orders that were not delivered, so a collection cannot reach a returned order through the state machine. Cancel is allowed only before pickup, when no collection exists. A return after delivery is a `return_pickup` order (DEL-18, wave 4), which has no custody arrow for its collections.
3. **Rules and edge cases.** Custody has no reversal arrow (6.4). The CHECK in `data.md` §2.2 forbids every other move. A deposit reversal exists and is a reversing entry, a pattern the lead could reuse, but its custody move conflicts (6.4, U2). Refusal at the door is an `attempted` (D-14), not a collection.
4. **Data.** None defined. A reversal would be a new insert-only entry type or a reversing collection (inferred; the sources name neither).
5. **Surfaces.** Merchant: no surface. Webhook: `delivery.cod.collected` only, no reversal event (R18).
6. **Permissions.** Undefined. Owner question on who records a reversal (B2 unanswered 9).
7. **Dependencies.** DEL-11 for custody, DEL-18 (wave 4) for return flow, INT-10 for the webhook.
8. **Metrics.** Returned COD orders with an uncounted collection (the case that must be zero).
9. **Market.** Salla refunds to store wallet or original gateway; mada refunds same day, card in about 14 days, mada within 30 days (B2 S2, secondary). Tabby's refund window is 180 days and returns a new reference per refund (B2 S35). Geidea supports partial card refunds with a cumulative cap (B2 S27). **Shape for us:** none yet. The market refund patterns apply to card payment, which we do not take (ADR-0017).
10. **Roadmap.** Missing. Proposed as DEL-23 (wave 2 entry type, wave 4 return flow, B1 §3). Owner questions: U1, B2 unanswered 9.

### 6.12 Merchant COD statement and per-order reconciliation

1. **Definition and goal.** For each merchant and period, what the merchant's drivers collected, what was handed over and deposited, and what is still open, per order. Goal: the merchant reconciles COD against the orders without asking staff.
2. **Workflow.** Read-only, built from the ledgers (Q-32 default). Per order: expected (`cod_amount`), collected (sum of collections), custody reached (`with_cashier`, `with_bank`), difference. Torod's merchant view uses statuses under review, collected, transferred and a search by customer, tracking or order number (B5 T24).
3. **Rules and edge cases.** No payout. Under the current model no money passes through Eeasy, so a statement is a custody reconciliation, not a remittance (inferred; U3, U17). The per-order collection list exists for staff (`listOrderCollections`, wave 1) and is the seed of the reconciliation.
4. **Data.** Read-only views over `del_cod_collections`, custody and deposits; the reporting layer may not write (R2 §9 rule). No table is defined for a statement.
5. **Surfaces.** Staff order detail COD panel (WEB-5, wave 1). Merchant finance page: none in the roadmap.
6. **Permissions.** Merchant owner or admin would read; the permission is not defined (`delivery.cash.read` is staff-only and dispatcher holds it).
7. **Dependencies.** DEL-11, DEL-12, Q-32; proposed DEL-23 (feature-coverage) or BIL-1 (teardowns) for any payout.
8. **Metrics.** Open COD per merchant per day; age of the open amount; reconciliation exceptions.
9. **Market.** Salla shows a COD balance, transactions and weekly invoices, Sunday and Wednesday, with the carrier fee taken from the customer fee (B2 S1, secondary). Torod's transfer schedule is free twice a month, Premium weekly, Pro twice weekly, and instant transfer carries a commission (B5 T2, T9). Wasal's "Total COD expected, collected, pending" totals (B7 S5). **Shape for us:** a custody-based statement with no payout (inferred). Borrow the Wasal totals and Torod's status words; the payout schedule does not apply.
10. **Roadmap.** Missing as an order (Q-32 answers only the driver side). Owner questions: U17, B2 unanswered 7; B1 §4 Q4 (billing).

### 6.13 Finance exports

1. **Definition and goal.** A file of cash data (collections, custody, deposits, reports, liability) for the merchant's accounting, filtered by date, site and method. Goal: the accountant does not re-key cash.
2. **Workflow.** Not defined. The audit export (PLAT-7) and the reporting views exist; no cash export endpoint exists in `openapi` (grep, 2026-11-02). Proposed as RPT-1 (wave 2) in B1 §3.
3. **Rules.** Amounts in halalas with the `SAR` code; the export must carry custody and method. Accounting connectors (QuickBooks, Xero, Zoho) are named by Fulfillor with direction unstated (B4 row 33).
4. **Data.** Exports read `rpt_` views only [inferred from R2 §9]; no personal data beyond driver first name if included.
5. **Surfaces.** Cash desk export button (not in WEB-10 row). API: none.
6. **Permissions.** `delivery.cash.read` would be the natural gate; not defined.
7. **Dependencies.** DEL-12 reports, WEB-10, RPT-1 (proposed).
8. **Metrics.** Exports per month; failed exports.
9. **Market.** Salla exports filtered COD transactions to Excel or CSV (B2 S1, secondary). Fulfillor names accounting connectors (B4). **Shape for us:** a read-only CSV and Excel export over the views (proposed; B1 §3). No connector.
10. **Roadmap.** Missing. Owner questions: U20.

### 6.14 Carrier COD settlement reconciliation

1. **Definition and goal.** When a carrier collects COD on a shipment we booked, match the carrier's remittance to the order and classify each gap. Goal: no unexplained carrier remittance.
2. **Workflow.** Expected COD follows the delivery outcome; matching starts from the order, not the carrier statement; each gap gets one class (B4 F14, B4 §6 A5). Seven classes named: pending settlement, overdue remittance, amount mismatch, unmatched payment, delivery exception, valid deduction, client allocation error.
3. **Rules.** Applies only if a carrier collects COD for an Eeasy shipment (ADR-0014, carrier shipments through Eeasy shipping) [inferred]. Own-fleet COD has no carrier remittance (ADR-0005).
4. **Data.** Not defined. A settlement table would be append-only if built (inferred from ADR-0007's ledger pattern).
5. **Surfaces.** Staff finance view. None in the roadmap.
6. **Permissions.** Undefined.
7. **Dependencies.** INT-8 (carrier choice), DEL-7, DEL-12; the proposed INT-13 (teardowns) or INT-15 (platform comparison). **ID collision:** INT-13 is also "channel allocation" in B1 §3.
8. **Metrics.** Gap count per class; days overdue.
9. **Market.** Fulfillor's COD settlement classes (B4 F14). Logestechs's COD fee automation (B2 S8, vendor marketing). SMSA and Naqel connectors show reconciliation views (B2 S11, S12, vendor pages). **Shape for us:** a wave-4 order over INT-8 with the seven classes, reusing the ledger rules (B3 §4, INT-15). Adapt, not copy: the classes are Fulfillor's, read from a fetched page.
10. **Roadmap.** Missing. Owner questions: U18.

### 6.15 Card and mada at the door: SoftPOS or payment links

1. **Definition and goal.** The recipient pays by card or mada at the door through the driver's phone (tap to phone), or through a link sent before delivery. Goal: fewer cash handovers and no card terminal.
2. **Workflow.** Not built. Today the driver records the card or mada line with an external reference (6.2). Digital COD waits for the owner gate (ADR-0017). Payment port named, no adapter (R16 §2.9).
3. **Rules.** Tap-to-phone only, no Bluetooth (ADR-0017). Refunds only to the original card, partial allowed, cumulative cap (B2 S27, Geidea). mada refund window: a processor rule of 30 days in secondary sources, SAMA's Mada rules leave the refund timeframe to the merchant (W1, fetched 2026-11-02). Android minimum differs by source for Nearpay (Android 9 on S29, 10 on S30).
4. **Data.** Not defined. A capture and refund ledger would be new (ADR-0017 says the new ADR chooses the outbox kinds).
5. **Surfaces.** Driver app: none. Recipient payment link: none.
6. **Permissions.** Undefined.
7. **Dependencies.** Owner unlock of ADR-0017; provider choice (Geidea, Nearpay or a bank SoftPOS; B2 unanswered 14); SAMA licensing question for funds (U3).
8. **Metrics.** Not applicable until approved.
9. **Market.** Geidea SoftPOS live in KSA on Android, with iPhone pending (B2 S28, search). Nearpay SDK for Saudi (B2 S29, fetched). SAIB and Alinma SoftPOS for their own merchants (B2 S31, S32, search). Tabby payment links by SMS or push with a 20-minute session (B2 S34, fetched). **Shape for us:** own record-only model until ADR-0017 is unlocked (current). Borrow the tap-to-phone and refund rules when unlocked.
10. **Roadmap.** Gated (B1 §3 "after ADR-0017 is unlocked"; roadmap §6 "digital COD deferred"). Owner questions: B2 unanswered 14; B1 §4 Q4.

### 6.16 Pay-later providers

1. **Definition and goal.** The recipient pays through a buy-now-pay-later provider instead of COD. Goal: lower COD risk for the merchant.
2. **Workflow.** Not built, not proposed as an order.
3. **Rules.** A merchant-side choice. Tabby's refund window is 180 days, closed payments only (B2 S35). Tamara's COD-alternative evidence is a 2021 to 2022 plugin changelog (B2 S36, weak).
4. **Data.** None.
5. **Surfaces.** Checkout of the merchant's store, not ours.
6. **Permissions.** Not applicable.
7. **Dependencies.** A provider contract; ADR-0017 gate.
8. **Metrics.** Not applicable.
9. **Market.** Tabby and Tamara are merchant-side checkout options (B2 S34 to S36). No KSA merchant demand evidence was found (B2 unanswered 6). **Shape for us:** none. Out of scope unless the owner asks.
10. **Roadmap.** Missing by design. Owner questions: B2 unanswered 6; B1 §4.

### 6.17 Driver pay statements

1. **Definition and goal.** A statement per driver and period of what the driver is paid. Goal: the driver can check pay against shifts and deliveries.
2. **Workflow.** DEL-13 (wave 2) "statement per driver and period, scoped by the register ruling". The register has no pay ruling; Q-32 says "read-only reports over existing ledgers and events; no new ledger" (R14 §4).
3. **Rules.** No pay rate, pay basis (per stop, per shift, per hour) or deduction rule exists in any document (grep, 2026-11-02). `rpt_driver_day` is named for "pay checks" (R2 §9). Liability deductions appear as liability entries and are not automatically netted [inferred].
4. **Data.** Read-only view `rpt_driver_day` (orders delivered and attempted, cash held, liability, shift hours). No pay entity.
5. **Surfaces.** Driver app: none defined (DRV-7 does not list pay). Staff: a drivers page panel (WEB-10 scope unclear).
6. **Permissions.** Driver reads own statement, staff `delivery.cash.read` (inferred).
7. **Dependencies.** DEL-7, DEL-11, DEL-5 for shift hours, Q-32.
8. **Metrics.** Statements issued per period; disputes raised.
9. **Market.** No teardown read covers driver pay statements (B2 Module 2: "no competitor source read for pay statements"). **Shape for us:** read-only over views (Q-32 default). The pay basis is an owner decision, not a market fact.
10. **Roadmap.** Covered in name only (DEL-13 wave 2). Owner questions: U16, Q-32.

### 6.18 VAT touchpoints on COD

1. **Definition and goal.** Where VAT at 15 percent touches COD: the price the recipient pays, a COD fee if any, the merchant's invoice, the driver pay, and any Eeasy fee. Goal: each amount has a VAT treatment fixed before a money figure ships.
2. **Workflow.** None defined. `Money` has no tax field (R9). ZATCA phase 2 is research item OPS-8 (B3 §4).
3. **Rules.** The standard rate is 15 percent, in force since 1 July 2020 (W7, search summary). The searched sources do not say whether a COD fee is taxed at 15 percent as a separate supply or inside the courier charge (W7). The supply date generally follows delivery (W7, search). Wasal's plan prices are quoted excluding 15 percent VAT (B7 §1), which is the only KSA market example read.
4. **Data.** None for tax. Money has no VAT field; a VAT line would be a new field, probably on any billing row (BIL track).
5. **Surfaces.** Merchant invoices (BIL-2 proposed, ZATCA). None for cash.
6. **Permissions.** Not defined.
7. **Dependencies.** Owner VAT position and the ZATCA wave (B1 §4 Q4); OPS-8 research; BIL-1 to BIL-3 (proposed, not in the roadmap).
8. **Metrics.** Not defined.
9. **Market.** Torod quotes plans with VAT excluded and no COD percentage published (B5 T2, T3, U4). **Shape for us:** none decided. The cash ledger holds gross collected amounts only, which is consistent with a cash record but leaves the fee's VAT open [inferred].
10. **Roadmap.** Missing. Owner questions: U12, B1 §4 Q4.

## 3. Shapes that differ from the roadmap today

These are the features where the market or the source material suggests a shape the roadmap does not yet carry. The lead decides; each is listed with its evidence.

1. **Collection reversal (6.11).** Roadmap has no order. Adaptation: a reversing entry, as deposits use, rather than a custody move backwards (U1, U2).
2. **Deposit reversal (6.8, 6.4).** Current contract moves custody backwards, which D-19 forbids. Adaptation: a reversing deposit with custody unchanged, or a new arrow in §3.16 by ADR.
3. **Driver block clearing (6.6).** Roadmap puts the clearing door in wave 2 while the PIN-replay block is wave 1. Adaptation: move `clearDriverCashBlock` to wave 1 or stop the replay flag from blocking in wave 1 (U4).
4. **COD amount at the door (6.1, 6.2).** Roadmap and contract have the driver type each line. Market (Shipsy, Wasal) prefills from the order. Adaptation: prefill and confirm, D-7 unchanged.
5. **Merchant statement (6.12).** Roadmap has none. Torod's status words fit a custody view; its payout schedule does not, because we hold no merchant money in the current model (U3, U17).
6. **Carrier settlement (6.14).** Roadmap has none. Fulfillor's seven classes fit a wave-4 order over INT-8. Two teardown notes use different ids (INT-13 and INT-15) and INT-13 is taken in feature-coverage (B1 §3).
7. **PIN window (6.3).** Roadmap Q-15 and the DEL-4 plan keep a 120-second window that the contract replaced by the H1 signal. Adaptation: re-rule Q-15 and fix the DEL-8 references.

## 4. Conflicts found in the sources (for the lead to resolve)

| # | Conflict | Sources | Effect |
|---|---|---|---|
| C1 | Deposit reversal moves custody back to `with_cashier` | staff-delivery `recordDeposit`; REVIEW N8; domain §3.16 and D-19; data §2.2 CHECK and unique key | Contract cannot be implemented as written |
| C2 | `DepositRequest` conditional requires a link on every deposit | staff-delivery `DepositRequest` allOf (ajv check 2026-11-02) | Positive deposits fail validation |
| C3 | Wave-1 block with no wave-1 clearing door | DEL-7 (replay sets block), `clearDriverCashBlock` wave 2, DEL-4 §8.2 #19 | A driver blocked in wave 1 cannot be cleared by the app or the web |
| C4 | PIN window: 120 s versus H1 signal | roadmap Q-15; DEL-4 §2.9, §7 Q2; driver.yaml `delivered`; REVIEW N5 | Q-15 default is stale |
| C5 | Cash figures and PIN checks cite DEL-8 | DEL-4 §2.9, §8.2 #30; roadmap DEL-7 and DEL-11 | Wrong order owns the cash figures |
| C6 | Dispatcher with driver role allowed | DEL-4 §8.2 #6, §7 Q5; identity §2 and contracts README §11 (dispatcher holds `delivery.cash.read`); REVIEW M9 | Combination refused by the contract's rule |
| C7 | `cash_block_notice` recipient or dispatcher | roadmap INT-7; integrations §5.1 row 2; B1 §1 | Message goes to the wrong audience |
| C8 | Logestechs settlement report and deficit ledger not in public sources | ADR-0007 context; B3 §1 | Claim cited for the design is unverified |
| C9 | Order-id collision INT-13 | B4 §6 (INT-13 carrier settlement); B1 §3 (INT-13 channel allocation); B3 §4 (INT-15) | Id to be fixed before registration |

## 5. Market evidence and its limits

- Fulfillor: COD settlement classes are from a fetched page (B4 F14). Torod: COD statuses and schedule from fetched price, terms and help pages, with one conflict (one-week grace against plan schedule, B5 U5). Shipsy: COD capture from a fetched vendor article (B6 A8); enterprise API not readable. Wasal: COD fields from app bundle chunks (B7 S5, a bundle read, not a page). Salla figures are secondary (B2 S1, fetched by its author). Nothing in the teardowns shows a settlement ledger or a cash PIN.

## 6. Unanswered

- **U1. Reversal shape.** No source defines how a delivered collection is reversed after a return. Is it a new custody arrow, a reversing collection, or a merchant-side adjustment? Who records it, and does it reach the merchant webhook?
- **U2. Deposit reversal and D-19.** The contract moves custody back to `with_cashier`. Should the rule be a reversing deposit with custody unchanged, or an ADR adding an arrow to §3.16?
- **U3. Money ownership and licensing.** Which bank account holds `with_bank` cash, and whose is it? Does Eeasy ever hold merchant funds? SAMA's guidance separates a licensed payment service provider from a technical provider and treats settlement of merchant funds as licensable (W5, secondary commentary); the sources do not settle which side we are on (counsel).
- **U4. Block clearing.** Does a handover lift `cash_blocked` automatically? May a supervisor clear a block while collections are still `collected`? What clears a wave-1 PIN block before wave 2?
- **U5. Late replay into a closed day.** An offline collection with a closed `business_date` is not addressed by D-21 or the contract.
- **U6. PIN window.** Keep the 120-second window (Q-15) or the H1 signal (contract N5)? Six digits only?
- **U7. Dispatcher and driver role combination.** Is `delivery.cash.read` a cash permission for M9? If yes, DEL-4 §8.2 #6 is wrong.
- **U8. Maker and checker.** One cashier can confirm a handover, record a deposit and close the report. Is a second approver needed above a threshold, and at what amount?
- **U9. `DepositRequest` conditional.** Fix the schema (C2) in the contracts owner's next change.
- **U10. Eligibility and limits.** Who sets COD limits, minimum and maximum, and fees (B2 unanswered 8 and 10; B1 Q10)?
- **U11. Three-decimal currencies.** When are BHD, KWD, OMR and others stored (B1 §2.1)? Secondary sources list BHD, IQD, JOD, KWD, LYD, OMR, TND at three decimals (W6); ISO 4217 itself was not read.
- **U12. VAT.** Does `cod_amount` include the 15 percent VAT? Is a COD fee taxed at 15 percent as a separate supply or inside the courier charge? Eeasy's VAT position and the ZATCA wave (B1 §4 Q4; OPS-8). No source read settles the COD fee case (W7).
- **U13. mada refunds.** The 30-day window is a processor rule in secondary sources (W2, search only); SAMA's Mada rules leave the timeframe to the merchant (W1). Which applies when digital COD is unlocked?
- **U14. Settlement lag and ageing.** No metric defines the threshold for `with_cashier` ageing or `collected` ageing.
- **U15. Slip retention.** Deposit slips and bank references have no retention row (`data.md` §10). Slips may carry account identifiers; is that personal data?
- **U16. Driver pay basis.** No pay rate, basis or deduction rule exists. What is "scoped by the register ruling" in DEL-13?
- **U17. Merchant statement.** Is the statement a custody reconciliation only, or a payout statement (B2 unanswered 7)?
- **U18. Carrier COD.** Does any carrier collect COD for Eeasy shipments in scope (ADR-0014)? If so, which id is the order (INT-13 or INT-15)?
- **U19. Pay-later.** Out of scope, or a merchant option to document (B2 unanswered 6)?
- **U20. Finance export.** Which format and destination (CSV, Excel, accounting connector)? No source read chooses one.
- **U21. Block notice audience.** Dispatchers (integrations §5.1) or recipients (INT-7)?

## 7. Feature index

| Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|
| 6.1 COD on the order and eligibility | Partial | DEL-2 (in progress), DEL-7; DEL-19 proposed | 1; 2 for eligibility | U10, U11, U12 |
| 6.2 Collection at the door, split methods | Covered on paper | DEL-7, DRV-4 | 1 | Q-1, Q-25 |
| 6.3 Cash PIN at collection and replay | Covered (contract and DEL-4 merged); window stale | DEL-4 (merged), DRV-1, DEL-7; ADR-0034 proposed | 1 | Q-15, Q-44, U6 |
| 6.4 Custody states and entries | Covered; reversal conflict | DEL-7, DEL-11, DEL-12 | 1 to 2 | U1, U2, U3 |
| 6.5 Cash in hand per driver | Covered | DRV-4, WEB-6, DEL-11 | 1 to 2 | U4 |
| 6.6 Cash block and its clearing | Partial: wave-1 block has no door | DEL-7, DEL-11, OPS-5, INT-7 | 1 and 2 | U4, U21 |
| 6.7 Handover, counted difference, liability | Covered on paper | DEL-11, DRV-7, WEB-10 | 2 | Q-25, U8 |
| 6.8 Deposits with slip upload | Covered; contract defect | DEL-12, INT-1 | 2 | U2, U8, U15 |
| 6.9 Cash reports per site and business date | Covered; late replay open | DEL-12, WEB-10 | 2 | U5, U8 |
| 6.10 Nightly cash assertions | Covered | DEL-12, DEL-15, OPS-5 | 2 | none new |
| 6.11 COD reversal on return or cancellation | Missing | DEL-23 proposed; DEL-18 | 2 (entry), 4 (flow) | U1 |
| 6.12 Merchant COD statement, per-order reconciliation | Missing (per-order staff list only) | DEL-23 proposed | 2 or 3 | U17 |
| 6.13 Finance exports | Missing | RPT-1 proposed | 2 | U20 |
| 6.14 Carrier COD settlement reconciliation | Missing | INT-15 (or INT-13) proposed | 4 | U18 |
| 6.15 Card and mada at the door, SoftPOS, payment links | Gated | ADR-0017; port unimplemented | after unlock | B2 unanswered 14, U3 |
| 6.16 Pay-later providers | Missing by design | none | none | B2 unanswered 6 |
| 6.17 Driver pay statements | Named only | DEL-13 | 2 | Q-32, U16 |
| 6.18 VAT touchpoints on COD | Missing | BIL-1 to BIL-3 proposed | later | U12 |

## 8. Source registry

Read date for every row: 2026-11-02. Repo rows read at `origin/main` 6ca087e in the worktree `lead-fable`. Branch rows read at the commit shown and carried from the author's note, not re-fetched.

| ID | Source | Used for |
|---|---|---|
| R1 | `docs/architecture/domain-model.md` §3.1, §3.11, §3.13, §3.16, §3.18 (D-4, D-7, D-11, D-14, D-15, D-17 to D-23), §5.2, §6.3, §7 | Aggregates, state machines, invariants, event catalogue |
| R2 | `docs/architecture/data.md` §2.2 (`del_` cash tables), §3.1, §3.3 to §3.5, §9, §10 | Tables, CHECKs, triggers, assertions, rebuild, reporting, retention |
| R3 | `docs/architecture/driver-app.md` §5.1 to §5.6, §13 | Driver flows, PIN, cash in hand, block, handover, open questions |
| R4 | `adr/0007-driver-cash-custody-logestechs-model.md` (accepted 2026-10-31) | Custody model, liability, card and wallet not held |
| R5 | `adr/0017-digital-cod-tap-to-phone-owner-gated.md` (accepted 2026-10-31) | Digital COD gate |
| R6 | `adr/0034-offline-cash-pin-device-verifier.md` (proposed 2026-10-31) | Device verifier |
| R7 | `docs/contracts/openapi/staff-delivery.yaml` (`listCollections` to `closeCashReport`; `recordDriverLiability`; `DepositRequest`; l.452) | Staff cash operations, waves, permissions |
| R8 | `docs/contracts/openapi/driver.yaml` (`driverSetCashPin`, `driverGetCash`, `driverVerifyCashPin`, `driverListCollections`, `driverRequestHandover`, `driverListLiability`, `delivered` event) | Driver cash operations |
| R9 | `docs/contracts/openapi/components.yaml` (`Money`, `SignedMoney`, `CodCollection`, `CustodyEntry`, `CashHandover`, `DriverLiabilityEntry`, `DriverCashSummary`, `CashDeposit`, `CashReport`, `UploadTicket`, `allowed_cod_methods` l.363) | Schemas |
| R10 | `docs/contracts/errors.md` (cash codes l.43 to 44, 51 to 73, 85) | Error codes |
| R11 | `docs/contracts/REVIEW.md` (H2, M4 to M7, M9, N5, N8) | Contract decisions |
| R12 | `docs/contracts/README.md` §11 role table and permission matrix, §12 point 2 | Roles and permissions |
| R13 | `docs/orders/DEL-4/plan.md` §2.9, §7 Q2 and Q5, §8.2 notes #6, #19, #30, #33, #36 | PIN doors, plan references |
| R14 | `docs/roadmap.md` §0, §1.2, §1.3, §2, §4 (Q-1, Q-15, Q-25, Q-32, Q-33, Q-44), §5 (A-4), §6 | Orders, waves, exits, questions |
| R15 | `docs/architecture/identity-and-tenancy.md` §2 | Role scopes and separation of duties |
| R16 | `docs/architecture/integrations.md` §2.9 (`PaymentPort`), §5.1 row 2, §5.4 | Payment port, block notice, quiet hours |
| R17 | `docs/architecture/web.md` §8 cash pages (l.336 to 339) | Cash desk pages and permissions |
| R18 | `docs/contracts/webhooks.md` (events table l.60, 90, 119, 147, 159) | Merchant-exposed cash events |
| W1 | https://rulebook.sama.gov.sa/en/node/8849 (SAMA Mada operating rules, update on refunds, dated 22/8/2016) | Merchant sets refund timeframe; fetched 2026-11-02 |
| W2 | https://support.paytabs.com/en/support/solutions/articles/60000705745-mada-refunds (search summary only) | 30-day processor window, secondary |
| W3 | https://rulebook.sama.gov.sa/en/node/1835 (SAMA remittance centre working hours, 2017 circular; search summary only) | Sunday to Thursday business week; Friday off; Saturday optional |
| W5 | https://rulebook.sama.gov.sa/en/node/1438 and the SAMA Implementing Regulations PDF (search summary; Al Tamimi and Tookitaki commentary) | PSP licensing, aggregation, technical providers, secondary |
| W6 | https://docs.tazapay.com/docs/decimal-currencies and an OpenJDK currency data file (search summary) | Three-decimal currencies, secondary |
| W7 | https://docs.invopop.com/compliance/saudi-arabia (search summary); ZATCA VAT guideline PDF (search result, not read) | 15 percent standard rate since 1 July 2020; no COD fee guidance found |
| B1 | `origin/docs/feature-coverage` at 7396dcc: `docs/research/feature-coverage-2026-11.md` | Proposed orders DEL-19 to DEL-29, RPT-1, owner questions, §2.1 currency |
| B2 | `origin/docs/feature-coverage` at 7396dcc: `docs/research/features-recipient-cash-returns-2026-11.md`, Module 2 and registry S1, S2, S8, S11, S12, S19, S20, S27 to S29, S31, S32, S34 to S36 | Market rows for cash features, secondary Salla figures |
| B3 | `origin/docs/platform-teardowns` at d75ed6f: `docs/research/platform-comparison-2026-11.md` §1, §3, §4, §5 | Consolidated proposals, INT-15, Logestechs caveat |
| B4 | `origin/docs/platform-teardowns`: `docs/research/teardown-fulfillor-2026-11.md` §1, §2, §5 (rows 21, 23, 33), §6 A5, §8 (F1, F2, F6, F14, F17) | COD settlement classes, custody comparison |
| B5 | `origin/docs/platform-teardowns`: `docs/research/teardown-torod-2026-11.md` §1, §2, §4, §7 (U4, U5), §8 (T2, T3, T9, T24, T26, T43) | COD ladder, transfer schedule, plan pricing |
| B6 | `origin/docs/platform-teardowns`: `docs/research/teardown-shipsy-2026-11.md` §1, §2.1, §3, §6, §8 (A1, A3, A4, A5, A8) | COD capture, route-close reconciliation, hub notes |
| B7 | `origin/docs/platform-teardowns`: `docs/research/teardown-wasal-2026-11.md` §1, §2.4, §4, §8 (S1, S5, S7) | POD policy, COD fields, payment-on-delivery tier, prices excluding VAT |

Verification run 2026-11-02: the DepositRequest conditional was compiled with ajv (draft-07 mode, from a local install outside this repo) against four cases: a positive deposit without a link (invalid), a negative reversal without a link (invalid), a negative reversal with a link (valid), and a corrected conditional `if` on `amount < 0` at the root (positive valid, negative without link invalid, negative with link valid). The check script was a scratch file and is not in the repo.
