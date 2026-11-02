# Feature book 03 · Driver app and field loop

Date: 2026-11-02. Status: research input for the lead; no decision taken. Scope: the driver app (`apps/driver`) and the field loop it drives, for eeasy-logistics (Saudi Arabia and the GCC). Sources are read on 2026-11-02 unless the source list gives another date; every source ID below resolves to a URL or repo path and a read date in the source list. "Shape for us" records the current roadmap or ADR shape. Where a teardown or census proposes a different shape, it is labelled "proposed" and is not adopted here.

## Summary for the lead

1. The sign-in, offline outbox, run, offer, pickup and deliver-with-photo path is covered by roadmap rows DEL-4, DRV-1 to DRV-4. Most of the listed field features are in the roadmap; the gaps are listed in 2.
2. Account picker (409 `account_choice_required`) exists in `driver.yaml` and DRV-1 plan 2.5, but `driver-app.md` §7.1 does not describe it yet.
3. Proof kinds `recipient_otp` and `id_check` are in the contract and domain model, but no order defines their capture. A `scan` proof kind (proposed by Safee and Shipsy) is not in the contract enum.
4. Partial delivery and a driver-side refusal or return at the door are not modelled. The driver arrows (domain §3.13) let a driver record only `attempted` with a reason. Refusal-as-attempt is open (Q-6).
5. The geofenced drop warning (a Shipsy-style radius check at the consignee pin) has no roadmap row; DEL-26 in the feature-coverage note is a proposal, advisory first.
6. Driver SOS (Safee panic action, Teardown platform DRV-12) has no roadmap row. The feature-coverage note has no SOS entry, and the ID "DRV-8" collides with its proof-capture proposal.
7. Pre-shift vehicle check is proposed as DRV-9 (feature-coverage) with no roadmap row; it is undecided whether it gates offers.
8. Multilingual UI beyond Arabic and English conflicts with ADR-0016 and AGENTS.md. Safee and Shipsy list more languages. The owner must rule and supersede the ADR for the driver app.
9. Call and chat masking has no provider on the roadmap. The app shows `tel:` numbers today, which is a PDPL question, not only a feature gap.
10. Background location and battery profiles are covered by ADR-0039 (accepted) and DRV-3. Q-44 (secure-store accessibility and the React Native Argon2 library) is still open and blocks ADR-0034.

## Method and source keys

- Repo inputs are cited by path and section. Web and teardown inputs are cited by the source ID in the list at the end.
- Facts are marked as stated by the source; anything the researcher derived is marked "(inferred)".
- Legal and regional facts were checked with WebSearch and WebFetch on 2026-11-02. Where a source could not be confirmed, it is listed under Unanswered, not stated as fact.
- Each feature has the same ten aspects, numbered 1 to 10. Related listed items share one section (for example the five proof kinds sit in section 8) and each listed item keeps its own row in the feature index.

## 1 Sign-in by OTP, device binding, account picker, device limit and revocation

**1. Definition and user goal.** A driver signs in with a six-digit WhatsApp code, binds the phone as one of at most two active devices, and picks the account when the phone drives for more than one merchant. A dispatcher can revoke a device. Source: `driver.yaml` `/auth/otp/request`, `/auth/otp/verify`; `driver-app.md` §7.1 to §7.4.

**2. Workflow.** (a) `driverRequestOtp` with the phone, 202 for any phone, 60 s cooldown. (b) `driverVerifyOtp` with the code and `DeviceInfo` (device_id, platform, app_version, push_token). (c) On `409 account_choice_required`, the app lists `details.accounts` and resends the same code with `account_id`; the code is not spent. (d) On `409 device_limit_reached`, the screen stays with "ask your dispatcher to remove an old phone". (e) On `401 device_revoked`, the app stays on sign-in: a code never brings a revoked app id back. Actors: driver, dispatcher (revocation via DEL-4 `revokeDriverDevice`). Happy path: one account, one device. Offline: sign-in is online only; the phone refuses nothing offline. Five verification attempts per code, challenges expire in 5 minutes (`driver.yaml` description).

**3. Business rules and KSA/GCC specifics.** Phone normalised to E.164 server-side; `+966` offered as prefix (`driver-app.md` §7.1). Two-device cap is Q-8 (default two, provisional). Driver-app language for OTP text: `locale` enum is `[ar, en]` only (`driver.yaml` `OtpRequest`), which blocks any other language without an ADR (see section 17). WhatsApp is the only OTP rail (ADR-0037, ADR-0041); a driver without WhatsApp cannot sign in (`features-driver-fleet-alerts` Module 1). Ramadan and prayer times do not change sign-in rules (no source).

**4. Data.** `del_driver_devices`: device_id (≤200 chars), platform, app_version, push_token (≤4096), revoked_at, last_seen_at, unique per driver and device; partial index on active devices is not unique, so the cap is counted under the driver row lock (DEL-4 plan 8.2 #2). On the phone: device_id (random UUID, secure store, `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, never backed up, `driver-app.md` §7.1, DRV-1 2.3); refresh token (90 days, device-bound); no hardware identifier. Retention of revoked device rows: not stated.

**5. Surfaces.** Driver app: `(auth)/sign-in`, `(auth)/verify`, account picker sheet (DRV-1 2.5). API: the four auth operations. Dispatcher web: device list and revoke (DEL-4 2.5, WEB-6).

**6. Permissions, roles and audit.** Operations use `core.auth.anonymous` / `core.auth.self`; the run needs `delivery.driver.work` (`driver.yaml`). Audit: `delivery.driver_device.registered`, `delivery.driver_device.revoked`, `core.session.started` (DEL-4 2.13). Every failure returns the same `otp_invalid` body (identity §3.2).

**7. Dependencies and integrations.** PLAT-9 OTP and messaging port; WhatsApp `auth_otp` template (wave 0 remaining, roadmap §0); PLAT-11 sessions; INT-4 push token invalidation (DEL-4 2.11). OS: `expo-secure-store`, `expo-crypto` (UUID).

**8. Metrics and reporting.** Sign-in events in PostHog with ids only; device-limit and revocation counts (driver-app §11). Not in any order's reporting row (DEL-17 covers scorecards only).

**9. How the market builds it.** Bringg offers email, phone or SSO login (features-driver-fleet-alerts, S1, read 2026-11-02, fetched). Wasal, Safee: sign-in method not stated in the pages read. Safee lists MFA as a release title (teardown-safee S13). Shape for us: own OTP over WhatsApp, device-bound refresh, two-device cap (ADR-0037, identity §3.2). Borrowed: nothing from the market; the rule is ours because WhatsApp is the messaging rail. Account picker is our own answer to multi-merchant drivers; no source describes one.

**10. Roadmap mapping.** Covered: DEL-4 (merged #114, sign-in, device binding, revoke), DRV-1 (sign-in screens, picker in plan 2.5). Partial: `driver-app.md` §7.1 lacks the picker step (DRV-1 2.5 says the lead amends it). Open owner questions: Q-8 (device cap, provisional), Q-24 (min version, see 15). The refresh-reuse grace is now answered (A-3, Q-23 provisional, 30 s), which makes `driver-app.md` §13 question 2 stale.

## 2 Cash PIN and offline device verifier

**1. Definition and user goal.** The driver sets a four-to-six-digit cash PIN that attests they, not whoever holds the phone, recorded a cash collection. A device-held Argon2id verifier lets the app reject a wrong PIN at the door without the server. Source: `driver.yaml` `/cash-pin`, `/cash-pin/verify`; `driver-app.md` §5.2 to §5.3; ADR-0034 (proposed).

**2. Workflow.** First set: `driverSetCashPin` with a fresh OTP (`otp_code`). Change: needs `current_pin`. Arming the verifier: computed on the device from a PIN the server has just accepted (set, change, handover request, online cash delivery, or `driverVerifyCashPin` at sign-in when no verifier exists). Five consecutive local failures lock cash recording on the device until an online check succeeds. Server lock `423 cash_pin_locked` wipes the verifier. Offline: a pending cash event keeps its PIN in secure store under the outbox item id, injected at send time, never in SQLite (ADR-0034). Live vs replay: the contract decides by the H1 signal (no other authenticated call after `client_ts`). A live wrong PIN returns `403 cash_pin_invalid` and records nothing; a replayed wrong PIN records the delivery, counts the failure, sets cash_blocked and returns 200 with `cash_pin_status: failed` (`driver.yaml` `/orders/{order_id}/events`).

**3. Business rules and KSA/GCC specifics.** PIN required when any collection is `cash` (A-4). Lock after five failures; a dispatcher resets (DEL-4 2.5). Western digits on the keypad (`driver-app.md` §5.2). Length: four to six digits in the contract; six-digit-only is an open option under Q-15. Cash norms: no source in the inputs sets a KSA COD limit; the feature-coverage note cites Salla's SAR 20 minimum and SAR 1,000 maximum without a fetched source (unverified here).

**4. Data.** Server: `cash_pin_hash` (Argon2id), `cash_pin_failures` 0 to 5, `cash_pin_locked_at` (DEL-4 plan 2.1). Device: verifier (Argon2id 19 MiB, 2 iterations, 16-byte salt) in secure store, not backed up; per-event PINs in secure store until ack. Retention: the verifier is deleted on sign-out, revocation, server lock, or PIN change seen on another device (`driver-app.md` §5.3, §7.4).

**5. Surfaces.** Driver app `(setup)/pin` and settings "change PIN". API: `driverSetCashPin`, `driverVerifyCashPin` (proposed, ADR-0034; the operation is not yet in the contract's accepted set). Dispatcher web: reset (DEL-4 2.5).

**6. Permissions, roles and audit.** `delivery.driver.cash`. Audit: `delivery.driver.cash_pin_set`, `delivery.driver.cash_pin_reset`, `delivery.driver.cash_pin_locked`; the PIN itself is never logged (DEL-4 2.13).

**7. Dependencies and integrations.** Native Argon2 module (a native build, `driver-app.md` §12.4). Secure-store accessibility value: Expo SDK 58 marks `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` deprecated; Q-44 is open and must be spiked in DRV-1 before ADR-0034 is accepted. Dependency on DEL-7 (replay check) and DEL-11 (handover).

**8. Metrics and reporting.** "PIN locked locally" PostHog event (`driver-app.md` §11); server-side lock counts in DEL-15 diagnose console (proposed reading).

**9. How the market builds it.** Shipsy: no PIN; a structured proof gate and auto-captured COD (teardown-shipsy A8, read 2026-11-02, fetched via vendor article). Safee: COD as one line, no reconciliation or PIN described (teardown-safee S4). Logestechs: no PIN described publicly; its webhook carries a delivery `pinCode` (a different thing, teardown-logestechs D4). Chosen shape for us: server-verified PIN at replay plus a device verifier (ADR-0034, proposed, owner to accept). Borrowed: nothing; the design is ours and is recorded as the stronger custody rule in the platform comparison (section 3 there).

**10. Roadmap mapping.** Partial: PIN set and reset in DEL-4 (merged); device verifier and `driverVerifyCashPin` are in DEL-4 scope (roadmap row) and DRV-1 2.6, both in progress. Open: ADR-0034 is proposed; Q-15 (120 s window, device verifier plus server re-check, length four to six, provisional); Q-44 spike. Owner question: accept ADR-0034 and six digits only or not.

## 3 Permissions and setup flow

**1. Definition and user goal.** After first sign-in the driver is walked through PIN arming and the OS permissions the app needs (location, notifications, camera), each explained in their language, before any shift. Source: `driver-app.md` §6.3, §9 `(setup)/permissions`; DRV-1 plan 2.7.

**2. Workflow.** Route groups: `(auth)` without a session, `(setup)` until PIN and permissions are done, `(app)` with a session. Permissions are asked on the setup screen, never on cold start. iOS: "While Using" first, then "Always" on shift start. Android: fine location, then background from system settings (Android 11+). Notifications and camera each have a "later" path. Refused background location is allowed with a visible warning (Q-26 default). Offline: the permissions screen works offline (`driver-app.md` §9).

**3. Business rules and KSA/GCC specifics.** Purpose strings in `ar` and `en` (`driver-app.md` §6.3). Heat and sunlight: field screens must read in sunlight, tap targets at least 56 dp (`driver-app.md` §10). Google Play background-location declaration and prominent disclosure are needed (`driver-app.md` §6.3; play-location-policy-2026-11). Google's date for removing geofencing as a foreground-service use: roadmap Q-41 says 2027-01-27 and says we are unaffected; the vendor changelog gives August 2026 and the two sources conflict (background-location-teardown S4 vs S11).

**4. Data.** Permission choices are not stored beyond the OS (DRV-1 2.7). The push token is sent with `driverUpdatePushToken` when permission is granted (driver.yaml).

**5. Surfaces.** Driver app setup screens; settings "this device" line. No dispatcher surface.

**6. Permissions, roles and audit.** Driver role only. No audit row for permission choices (none specified).

**7. Dependencies and integrations.** `expo-location`, `expo-task-manager`, `expo-camera`, `expo-notifications`; Play data-safety and App Store privacy declarations (OPS-3). The store labels must match what the app collects; Logestechs declares "Data Not Collected" on a POD app (teardown-logestechs A1), and Safee's label conflicts with its own text (teardown-safee S11). We must not copy either.

**8. Metrics and reporting.** Permission-denied rate: not specified in any order.

**9. How the market builds it.** Shipsy: location check at delivery (teardown-shipsy A8). Wasal: no permission flow described (teardown-wasal). Chosen shape: own setup flow with in-app explanation before the OS prompt, background location after an explanation, as in `driver-app.md` §6.3. This is ours; the market sources do not describe a comparable flow.

**10. Roadmap mapping.** Covered: DRV-1 (setup screens, plan 2.7); DRV-3 (background location). Open: Q-26 (warning versus block, provisional allow with warning); Q-41 (store date, answered 2026-11-01 but conflicting with vendor changelog). Owner question: whether a refused background permission blocks shift start (`driver-app.md` §13 Q4 and Q-26).

## 4 Offline outbox and sync screen

**1. Definition and user goal.** Every driver field write is recorded on the phone first (SQLite outbox, idempotent key) and replayed in order when the network allows; the sync screen shows what is waiting, what was rejected and what is done. Source: `driver-app.md` §3, §4.5; ADR-0008 (accepted).

**2. Workflow.** Record: one SQLite transaction writes the outbox item, proof rows and the read-model overlay. Replay: per-order lane strict by `seq` (D-16); lanes in parallel, three requests in flight; shift barrier (`shift_end` after earlier order items settle); triggers on reconnect, foreground, SSE connect, every 15 s while open, background task. Results table (`driver-app.md` §3.4): `200` acked; `401 token_expired` refresh and resend; `409 stale_driver_event` and `invalid_transition` rejected and shown with both versions; `409 shift_not_active` rejected with "retry"; `422` client defects rejected and reported; `403 account_suspended` pauses all replay. Rejected items are never dropped. Offline: the whole loop works without network; locations are a separate buffer (section 13). Sync screen: three groups (needs attention, waiting, done), header with connectivity and clock offset, support-bundle export.

**3. Business rules and KSA/GCC specifics.** Replay pauses behind a banner on `account_suspended`. Clock: `client_ts` corrected by server Date offset; offset above two minutes logged (`driver-app.md` §3.6). Basement and warehouse signal loss is the stated design case (ADR-0008 context). Offline window: `client_ts` must lie in the assignment window plus an account setting, default 12 h (`driver.yaml` `/orders/{order_id}/events`). Business dates use Asia/Riyadh. Feature-coverage notes that Onfleet's offline mode is an admin setting and that sources conflict; not resolved (features-driver-fleet-alerts, Source conflict note).

**4. Data.** `outbox_items` (id UUIDv7, driver_id, lane, order_id, kind, event_type, payload without `cash_pin`, client_ts, seq, status pending/sending/acked/rejected, attempts, last_error, response); `proof_uploads`; `run_stops`, `offers`, `me`, `reference` read model; `log_lines` ring (5,000 lines or 7 days). Encrypted with SQLCipher; key in secure store; refuses to start without cipher (ADR-0039 rule 10, Q-40 ruled 2026-11-01). Retention: acked items kept 7 days on screen; rejected items kept until resolved; uninstall destroys the outbox.

**5. Surfaces.** Driver app: `(app)/(tabs)/sync`; run tab badge with the "needs attention" count. Dispatcher web: none; rejected field events do not reach dispatchers today (open question 3 in `driver-app.md` §13; Q-25 default yes, provisional).

**6. Permissions, roles and audit.** Driver token only; outbox rows are bound to `driver_id` and replay only under that driver's token (`driver-app.md` §7.4). Server side `Idempotency-Key` is stored for 24 h and `del_order_events` permanently (D-15).

**7. Dependencies and integrations.** `expo-sqlite` with `useSQLCipher`, `expo-secure-store`, `expo-network`, `expo-background-task`; contract `driver.yaml`; DEL-7 replay endpoints; PLAT-8 outbox on the server side is a separate concept.

**8. Metrics and reporting.** Outbox depth, oldest open item age, rejections by code, replay latency (`acked_at − client_ts`), sent to PostHog every 15 minutes while open (`driver-app.md` §11). Server does not receive outbox metrics.

**9. How the market builds it.** Shipox is the only reference that queues offline with a sync screen and deferred proof upload (ADR-0008 context). Shipsy: "every screen works without data", encrypted on device, per-event merge (teardown-shipsy A8). Safee: offline in one sentence, manager app stores trips (teardown-safee S4, S7). Spoke, Track-POD, OnTime 360 offer offline capture (features-driver-fleet-alerts S15). Logestechs: no offline mode shown (teardown-logestechs, absence only). Omniful: no offline mode stated for its driver app (teardown-omniful O13). Chosen shape for us: own outbox with per-order lanes, idempotent replay and a visible rejected state (ADR-0008). Borrowed: the sync-screen-with-pending-items idea from ADR-0008's market note; the replay rules are ours and are the stronger design in the platform comparison §3.

**10. Roadmap mapping.** Covered: DRV-2 (outbox, read model, sync screen, support bundle, log ring), DEL-7 (replayable events). Open: Q-25 (rejected driver events with cash shown to dispatch, default yes, provisional); `driver-app.md` §13 Q3 is the same question. Owner question: whether an offline window of 12 h is right for field conditions.

## 5 Run list and stop sequence

**1. Definition and user goal.** The driver sees the stops assigned to them for the shift, in an order the driver can follow, with status, slot, COD and a "not synced" mark. Source: `driver-app.md` §9 run list note; DRV-4 and DRV-7 rows in `roadmap.md`.

**2. Workflow.** Wave 1: stops ordered by slot window, then assignment time; the driver may reorder locally (a view preference, not sent). Wave 2: rung 1 of ADR-0010 supplies the stop sequence from the server (INT-6, VROOM) and the list follows it (DRV-7 "run list in server sequence"). Filled by `driverListRun` plus SSE `delivery.order.assigned/cancelled` refetch. Offline: read from the local read model. Empty state: no open assignments. Exceptions: a stop removed by dispatch shows "removed by dispatch" with the rejected item attached (`driver-app.md` §3.4).

**3. Business rules and KSA/GCC specifics.** Heat: a midday outdoor work ban (12:00 to 15:00) applied to private-sector establishments in 2026 (W1, read 2026-11-02); whether delivery riders are covered is not stated (Unanswered 2). Ramadan working-hour reductions are not reflected in any shift rule (Unanswered 3). Traffic: stop order sets drive time through Riyadh traffic (inference from features-driver-fleet-alerts Module 1). Hard rule: the run list shows only orders whose active assignment is this driver (`driver.yaml` `/orders`).

**4. Data.** `RunStop` (order, assignment, open_attempt) with `version`; driver-side order is a view preference only. Retention: follows the read model.

**5. Surfaces.** Driver app `(app)/(tabs)/index`. API `driverListRun`, `driverGetOrder` (404 for other drivers' orders). Dispatcher board WEB-7 shows status only.

**6. Permissions, roles and audit.** `delivery.driver.work`. No audit for local reordering (view preference, not sent).

**7. Dependencies and integrations.** DEL-6 (assignments), DEL-9 (slot windows), INT-6 (VROOM sequence), INT-2 (geocoded point). OS: none beyond SSE.

**8. Metrics and reporting.** Stop completion per shift is not in any order's reporting row; DEL-17 scorecards are proposed wave 4.

**9. How the market builds it.** Shipsy: linear task list, "never a map-first view", server-sequenced from a micro-clustered route (teardown-shipsy A8). Bringg: customisable stop order and clustering (features-driver-fleet-alerts S1). Tryoto: route optimisation up to 30 stops (S9). Wasal: stop numbered on a map with ETA per stop, drivers may reorder only with permission (teardown-wasal). Chosen shape for us: slot-ordered local list in wave 1, server sequence in wave 2 (`driver-app.md` §9; roadmap DRV-7). Borrowed: Shipsy's linear list; our shape is the same, and our driver-side reorder is ours.

**10. Roadmap mapping.** Covered: DRV-4 (wave 1 run list); partial until DRV-7 and INT-6 (wave 2). Open: `driver-app.md` §9 says document 3 §12.4 leaves stop-sequence attribute to the wave 2 order; no owner question is filed. Owner question: should drivers be allowed to reorder at all once server sequence exists (Wasal allows drivers to edit routes per workspace; teardown-wasal Unanswered 20).

## 6 Offers sheet and acceptance race

**1. Definition and user goal.** A driver sees an offered order with stop, distance, COD and a countdown, and accepts or declines; the first acceptance wins. Source: `driver-app.md` §8.3; `driver.yaml` `/offers/{offer_id}/accept`, `/decline`; D-12, D-13.

**2. Workflow.** Offer arrives by SSE `delivery.order.offered`, push, or poll. Accept enabled only online; one request with the same `Idempotency-Key` so a lost response cannot double-accept. Outcomes: `200` assignment; `409 offer_withdrawn` ("another driver took this order"); `409 offer_expired`; `409 shift_not_active`; `422 capacity_exceeded`; `422 driver_cash_blocked`; `403 driver_not_assignee`. Decline asks an optional reason. Offline: offers expire; nothing is queued (`driver.yaml` description: offer acceptance online only).

**3. Business rules and KSA/GCC specifics.** Cash block (D-11) blocks offers; Asia/Riyadh business day. Offers only to active drivers on an active shift with a vehicle, covering the zone (D-12). Speech: `expo-speech` reads new offers aloud when enabled (`driver-app.md` §10). Ramadan and heat: none specific.

**4. Data.** `offers` read model; server Offer states sent, accepted, declined, expired, withdrawn (domain §3.14); `responded_at`, `expires_at`. Retention: domain-defined.

**5. Surfaces.** Driver app offer sheet (form sheet route). API `driverListOffers`, `driverAcceptOffer`, `driverDeclineOffer`. Dispatcher: DEL-6 offers.

**6. Permissions, roles and audit.** `delivery.driver.work`; a dispatcher's offer is an audited assignment change through the domain (D-22).

**7. Dependencies and integrations.** DEL-6, DEL-10 (rule-created offers, wave 2), DRV-5 (stream and push), INT-4 (push).

**8. Metrics and reporting.** "Offer acceptance latency" is a named telemetry signal (domain §7); no report order yet.

**9. How the market builds it.** Wasal: auto-distribution preview then confirm (teardown-wasal P4); Shipsy: rule and ML allocation; a driver re-optimisation prompt is "next release", not shipped (teardown-shipsy §2.1). Safee: assignment gap of 60 s per company (teardown-safee S14). Chosen shape for us: offers with a first-accept row lock (D-13), manual in DEL-6, rule-created in DEL-10. Proposed from the platform notes, not adopted: the assignment gap (Safee A2) and preview before commit (Wasal P4).

**10. Roadmap mapping.** Covered: DRV-4 (offer sheet), DRV-5 (acceptance race, push), DEL-6 (offers). Partial: DEL-10 assignment gap and preview are not in the roadmap row. Owner question: whether an offer gap (default 60 s) is wanted.

## 7 Pickup by scan and start stop

**1. Definition and user goal.** At the shop or hub the driver scans the parcel label to take custody (`assigned` to `picked_up`), then starts the stop (`picked_up` to `out_for_delivery`). Source: `driver-app.md` §9 pickup and start-stop rows; domain §3.13.

**2. Workflow.** Scan with `expo-camera`; the scanned code must match the order label (number or source reference) locally before the event is written; mismatch refused with a haptic error; manual entry for damaged labels. Start stop is an action on order detail, one replayable event. Both offline through the outbox. Exceptions: a damaged label goes to manual entry, not to a fake scan.

**3. Business rules and KSA/GCC specifics.** Pickup is the custody moment: the parcel is with a driver from `picked_up` (domain §3.13 note). Labels: merchants must print labels; no source measures KSA label rates (features-driver-fleet-alerts Module 1, medium relevance, unverified).

**4. Data.** `picked_up` event with `scan_code`; order `status` fold; no separate scan table.

**5. Surfaces.** Driver app `(app)/orders/[orderId]/pickup`, order detail action. API `driverPostOrderEvent`.

**6. Permissions, roles and audit.** Assignee only (D-6); order events are append-only (D-15).

**7. Dependencies and integrations.** Label codes from the order (DEL-2). `expo-camera` barcode scanning.

**8. Metrics and reporting.** Not in any order's row.

**9. How the market builds it.** Bringg: camera barcode scanning (features-driver-fleet-alerts S1). Onfleet: barcode scanning (S3). Logestechs: barcode scanning throughout the app (teardown-logestechs A1). Chosen shape for us: label match before the event is written, which is the same rule as the market's scan-and-match. Our own choice: the match is enforced locally and the server checks the assignee (D-6).

**10. Roadmap mapping.** Covered: DRV-4. Open: none filed. Start stop: covered by DRV-4 and DEL-7 (`driver-app.md` §9 table).

## 8 Deliver with proof kinds: photo, signature, recipient OTP, ID check, scan, and the geofenced drop warning

**1. Definition and user goal.** At the door the driver completes the stop as delivered, with the proofs the account's policy requires. Proof kinds in the contract: photo, signature, recipient_otp, id_check. Source: `driver.yaml` `DriverOrderEvent.proofs`; domain §3.10, D-7, D-17; `driver-app.md` §4.

**2. Workflow.** Proofs captured at the door (photo in-app only, max 3 per event; signature canvas with typed recipient name). Each file processed, hashed (sha256), written with a `proof_uploads` row in the same transaction as the event (ids minted offline, UUIDv7). The event declares proofs; the file uploads only after the event is acked (`driver-app.md` §4.1). `recipient_otp` and `id_check` are accepted by the contract but the app blocks them until a wave order defines capture: a policy that names them blocks delivery with a clear message, not a fake proof (`driver-app.md` §4.2). Geofenced drop warning: no roadmap row; the feature-coverage DEL-26 proposal is advisory first; Shipsy checks a radius around the consignee pin before delivery (teardown-shipsy A8; the radius is unpublished). Our driver app has no drop-radius check; ADR-0039 covers only the parked geofence used for tracking.

**3. Business rules and KSA/GCC specifics.** Photo limits: about 400 KB target, 1.5 MB re-encode ceiling, longest edge 1600 px (`driver-app.md` §4.2); server cap 10 MiB and only JPEG or PNG (`driver.yaml` `ProofUploadRequest`). PDPL: a recipient photo or identity check is personal data; no PDPL source was read by this chapter for identity capture (see Unanswered). ID check: no KSA demand found; storing ID data needs a PDPL basis (features-driver-fleet-alerts S31, unverified).

**4. Data.** `proofs` on server (order_id, attempt_id, kind, storage key, upload_status pending_upload/stored/failed, sha256), read by signed URL only (ADR-0015). On phone: file under documentDirectory until stored, then deleted; row kept 7 days.

**5. Surfaces.** Driver app `(app)/orders/[orderId]/deliver`, sync screen (proof rows). API `driverPostOrderEvent`, `driverCreateProofUpload`, `driverConfirmProof`. Dispatcher: proof-pending alert at 24 h (D-17), channel not built (DEL-21 proposal).

**6. Permissions, roles and audit.** Assignee only. Proof objects are audited through domain events; retention is not decided (domain §9 Q5 asks whether trails should follow the two-year proof retention).

**7. Dependencies and integrations.** DEL-7 (proofs, D-7), DRV-4, DRV-2 (queue), storage (ADR-0015). For recipient OTP: a WhatsApp recipient template is needed (ADR-0037 templates only); integrations §5.1 has no recipient OTP template (feature-coverage §1). Outbound messages go through the outbox (AGENTS hard rule).

**8. Metrics and reporting.** Proof backlog count and bytes, upload latency, stored time (`driver-app.md` §11). No report order.

**9. How the market builds it.** Shipsy: OTP to the consignee completes POD; signature; photo mandatory for failure, damage and COD handover; Deliver disabled while a required proof is missing; barcode decoder for damaged labels (teardown-shipsy A8). Safee: signature, photo, QR or barcode scan, location-confirmed handoff record (teardown-safee S4). Grasshopper: code to the consignee's phone, optional per account (features-driver-fleet-alerts S27). Onfleet: age check against government ID (S3). Wasal: signature or photo, optional per stop, PDF export (teardown-wasal B7). Chosen shape for us: proof kinds and a policy row, enforced server-side on replay (domain D-7, DEL-7). Adopted proposals: a required-proof set per reason (Shipsy, teardown-platform §4); a `scan` proof kind with handoff record (Safee A1); both are proposals, not adopted.

**10. Roadmap mapping.** Covered: photo and signature (DEL-7, DRV-4 wave 1). Partial: recipient OTP and ID check in contract only (DRV-8 proposal in feature-coverage, wave 2). Missing: scan proof kind, geofenced drop warning, per-reason proof set. Owner questions: which merchants need recipient OTP or ID check (feature-coverage Q7); whether a drop radius blocks or warns (feature-coverage Q8 area, Shipsy Q3); whether `scan` is a kind (teardown-safee A1).

## 9 Partial delivery and attempts with reasons

**1. Definition and user goal.** Partial delivery: some items of an order are handed over and others refused with a reason. Attempt: the driver reached the door but did not complete delivery, and records a reason code so the order can be retried or fail at the account's maximum. Source: domain D-14, §3.13, §3.15; `driver.yaml` `/orders/{order_id}/events` (`attempted`, `reason_code`); `driver-app.md` §9 attempt row.

**2. Workflow.** Attempt: `out_for_delivery` to `attempted` with a reason code from the account list (cached offline, D-14). The order returns to `out_for_delivery` when the driver retries the same run; the attempt count rises; when it reaches `max_attempts` (default 3) the system moves the order to `failed`. "Last attempt" is shown before the limit (`driver-app.md` §9). Partial delivery: not modelled. The order is delivered as a whole (D-7 requires full proofs and an exact COD sum; domain §3.13). Offline: attempts are replayable events like delivery.

**3. Business rules and KSA/GCC specifics.** Recipient refusal at the door: does it count as an attempt or go straight to `failed` is open (domain Q6, Q-6). Heat and Ramadan: no rule. Torod publicly lists "5 failed attempts" for merchants (features-driver-fleet-alerts S11) and failed visits drive cost (inference).

**4. Data.** `attempts` (order_id, assignment_id, number, status open/succeeded/failed/voided, reason code, note, point, client_ts, domain §3.10 and §3.15). Partial outcome: no per-item record exists.

**5. Surfaces.** Driver app attempt screen. Dispatcher: DEL-14 reschedule and address pin (wave 2); dispatcher void with audit (attempt state machine).

**6. Permissions, roles and audit.** Assignee only; dispatcher void is audited (domain §3.15). Reason-code catalogue is an account setting (D-14).

**7. Dependencies and integrations.** DEL-7, DEL-14, DEL-18 (returns, wave 4), Q-4 (exchange shape), reason-code list from DEL-1 or account settings.

**8. Metrics and reporting.** Failure reasons by driver and account are named in Wasal's reports (teardown-wasal §2.8) and in DEL-17 proposals (wave 4). Not wave 1.

**9. How the market builds it.** Wasal: stop statuses delivered, failed with reason, no answer, needs redelivery (teardown-wasal §2.3). Shipsy: structured incident list, not free text, feeding an NDR agent (teardown-shipsy A8). Grasshopper: reject items, then sign for the rest (features-driver-fleet-alerts S26). Track-POD: partial delivery with refusal reasons (S25). DispatchTrack: per-SKU return code (S28). Chosen shape for us: reason-coded attempts and a whole-order delivery (domain). Partial delivery needs an ADR because it changes the state machine and D-7 (feature-coverage §3 DEL-30). Borrowed: the structured reason list (Shipsy, Wasal); not partial delivery.

**10. Roadmap mapping.** Covered: attempts (DEL-7, DRV-4). Missing: partial delivery (wave 4 proposal DEL-30 in feature-coverage, needs ADR). Owner questions: domain Q6 (refusal as attempt), feature-coverage Q3 (partial delivery per merchant), teardown-platform §5 Q6 (partial fulfilment default).

## 10 Returns at the door

**1. Definition and user goal.** The driver collects an item the recipient returns at the door, with a reason, and the return goes back to the site. Source: domain §3.1 `return_pickup` kind; `driver-app.md` §9 ("collect" label); DEL-18 in `roadmap.md` (wave 4).

**2. Workflow.** Per the domain, a return is a separate order kind; the driver's arrows do not include a driver-side return. A driver cannot move an order to `failed` or `returned` (domain §3.13: `failed` is dispatcher, `returned` is site staff). Therefore, a return at the door in wave 1 can only be recorded as an attempt with a reason; the return flow itself is DEL-18 (wave 4). Offline: as attempts.

**3. Business rules and KSA/GCC specifics.** Return volume from marketplaces is an inference (features-driver-fleet-alerts Module 1). Logestechs allows return only while out for delivery, with a cost-paid flag (teardown-logestechs §5). Ramadan and heat: none.

**4. Data.** Order with kind `return_pickup`; returns disposition in WMS-8 (domain §4.8); no driver-side return record.

**5. Surfaces.** Driver app order detail "collect" label; dispatcher DEL-18 flows; site staff `checkInReturn` (`staff-delivery.yaml`, feature-coverage Module 3).

**6. Permissions, roles and audit.** Site staff for `failed` to `returned` (domain §3.13); assignee for the door event.

**7. Dependencies and integrations.** DEL-18, DEL-28 (recipient return request, wave 4 proposal), WMS-8, Q-4.

**8. Metrics and reporting.** Return rate: DEL-17 (wave 4). Not wave 1.

**9. How the market builds it.** DispatchTrack return codes per SKU (features-driver-fleet-alerts S28). Grasshopper reject-and-sign flow (S26). Logestechs: return routes, courier pick-up, bundle returns (teardown-logestechs §1.6). Omniful: courier-partner return after failed delivery, QC in WMS (teardown-omniful §2.1). Chosen shape for us: return as an order kind, recorded at the site (domain). Borrowed: nothing beyond the reason-code idea.

**10. Roadmap mapping.** Partial: the order kind exists (domain), flow is DEL-18 wave 4; driver-side door return is missing. Owner question: may the driver record a door return before wave 4, and whether DEL-18 moves earlier (feature-coverage Module 3 says "owner may pull forward").

## 11 COD and card at the door

**1. Definition and user goal.** On a delivered order with COD, the driver records what was collected and by which method (cash, card, mada, wallet). Cash is held by the driver and handed to a cashier later; card, mada and wallet are collected elsewhere and never enter cash totals. Source: `driver.yaml` `cod_collections`; D-4, D-7, D-18; ADR-0007; ADR-0017.

**2. Workflow.** On `delivered` with `cod_amount > 0`: one or more collections, integer halalas, sum exactly equal to `cod_amount` (D-7), non-cash lines need an external reference, cash line needs the PIN. Offline: the item is written locally; the PIN is held in secure store; online-only dependencies are checked at replay. Card at the door: the app never takes a card payment; the line is recorded as collected elsewhere with custody `not_held` (ADR-0017). Split payments are two lines. Replay with a wrong PIN: see section 2.

**3. Business rules and KSA/GCC specifics.** COD norms: no source in the inputs sets KSA limits; feature-coverage cites Salla's SAR 20 minimum and SAR 1,000 maximum (unverified in this chapter). Mada is the domestic debit scheme (feature-coverage, not sourced). ADR-0017 gates digital COD on owner approval and chooses tap-to-phone over Bluetooth POS if approved. Shipsy and Safee describe auto-captured COD; our driver types a confirmed amount (proposed, teardown-shipsy §6 item 4). Who sets COD limits and fees is an owner question (feature-coverage §4 Q10).

**4. Data.** `del_cod_collections` (insert-only; amount halalas, method, external reference); custody entries (collected, not_held); on phone, pending cash lines in outbox; PIN never in SQLite.

**5. Surfaces.** Driver app deliver screen; cash tab (DRV-4 wave 1 cash, DRV-7 wave 2). API `driverPostOrderEvent`, `driverListCollections`. Dispatcher and cashier: DEL-11 handovers (wave 2).

**6. Permissions, roles and audit.** `delivery.driver.cash` for PIN actions; custody entries are recorded by the receiver, never the driver (D-19).

**7. Dependencies and integrations.** DEL-7, DEL-11, DEL-12, ADR-0034, ADR-0007. Card acceptance would need a provider (tap-to-phone; Nearpay or Geidea named in ADR-0017), not chosen.

**8. Metrics and reporting.** "Unrecorded cash" and "waiting to sync" lines on the cash screen (`driver-app.md` §5.4); cash reports per site (DEL-12).

**9. How the market builds it.** Shipsy: amount captured from the shipment, no typing, tamper-evident receipt, reconciliation at route close (teardown-shipsy A8). Safee: COD as one line, no reconciliation (teardown-safee S4). Logestechs: COD on each status event, no custody chain shown publicly; ADR-0007's citation of Logestechs is unverified (teardown-logestechs §7 item 1). Omniful: COD payment proof in the driver app (teardown-omniful O13). Chosen shape for us: insert-only collections and a custody ledger with PIN at handover (ADR-0007, ADR-0034, stronger on paper per platform comparison §3). Adopted proposal: amount from the order, driver confirms (proposed DEL-7 amendment).

**10. Roadmap mapping.** Covered: DEL-7 (record), DRV-4 (deliver with COD), DEL-11 and DRV-7 (handover, wave 2). Card at the door: missing by design (ADR-0017). Open: ADR-0017 owner unlock; Q-33 pricing; the ADR-0007 Logestechs citation needs checking before reuse.

## 12 Navigation hand-off, order detail, and the stop card

**1. Definition and user goal.** From a stop the driver sees the recipient, address (with National Address short code), items and COD, and opens the map app with the drop point. Source: `driver-app.md` §9 order detail; ADR-0039 item 8.

**2. Workflow.** Order detail: "Call" (`tel:`), "Navigate" (Google Maps, Apple Maps or Waze by URL with the order point; choice stored in settings). No in-app turn-by-turn. Offline: detail reads from the local model. Kind-specific labels: `return_pickup` shows "collect"; `exchange` shows out and in items.

**3. Business rules and KSA/GCC specifics.** National Address short code shown on the stop (INT-2). Maps: ADR-0033 chose MapLibre for in-app maps; navigation uses the OS map app. iOS activity type `OtherNavigation`, not `AutomotiveNavigation`, because the latter snaps to roads (ADR-0039). Heat: none specific.

**4. Data.** Order and address point; navigation choice in settings (device-local). No location leaves the device through navigation.

**5. Surfaces.** Driver app `(app)/orders/[orderId]/index`. API `driverGetOrder`.

**6. Permissions, roles and audit.** Assignee only; the order is 404 for other drivers (`driver.yaml`).

**7. Dependencies and integrations.** INT-2 (geocode, short codes), external map apps (Google Maps, Apple Maps, Waze by URL), no new SDK.

**8. Metrics and reporting.** None specified.

**9. How the market builds it.** Bringg connects to Google Maps and Waze (features-driver-fleet-alerts S1). Wasal: turn-by-turn and embedded Google Maps on higher tiers (teardown-wasal §2.3); a proposed hand-off to the device map app (P8). Shipox: "pinpoint navigation" claimed (features-driver-fleet-alerts S6). Chosen shape for us: hand-off to the device's map app, which is the adapted shape of Wasal's proposal.

**10. Roadmap mapping.** Covered: DRV-4. Open: Wasal's Unanswered 19 (owner decision whether drivers may open a stop in the device map app); no owner question filed in the roadmap. Proposed DRV-4 amendment P8 in teardown-wasal.

## 13 Call and chat masking

**1. Definition and user goal.** The driver can reach the recipient, and the recipient the driver, without either seeing the other's number. Source: features-driver-fleet-alerts Module 1 ("Driver–recipient call or chat masking"); `driver-app.md` §9 ("Call opens `tel:`").

**2. Workflow.** Today: "Call" opens the phone dialler with the recipient's number, so the driver sees it. No chat. Proposed: a proxy number per order through a telephony provider, with the call recorded or not as ruled. No provider is chosen; the outbox rule would apply to any call-proxy write (AGENTS hard rule). Offline: call needs signal; no offline path.

**3. Business rules and KSA/GCC specifics.** PDPL: showing a recipient number to a driver is already processing of personal data; a proxy would process more. Recording calls is personal-data handling with no ADR (teardown-shipsy §5 row "Masked and recorded calls": No, for now). No KSA evidence on harassment found.

**4. Data.** Today: recipient phone is on the order (domain §3.1). Proposed: proxy mapping per order with an expiry; recording retention undefined.

**5. Surfaces.** Driver app order detail; recipient message templates (WhatsApp only, ADR-0037). No chat surface.

**6. Permissions, roles and audit.** Driver assignee only. Call logs: not specified.

**7. Dependencies and integrations.** A telephony provider (none in `integrations.md`), the outbox, PLAT-8. Twilio Proxy and LogiNext are examples in the sources (features-driver-fleet-alerts S29, S30; vendor material).

**8. Metrics and reporting.** None.

**9. How the market builds it.** Bringg: masked numbers and driver–dispatcher chat (features-driver-fleet-alerts S1). Shipsy: masked calls through a proxy, calls recorded, templated in-app messages (teardown-shipsy A8). Logestechs: none shown. Chosen shape for us: none yet; Shipsy's own call (no, for now) is the closest recorded decision. Owner decision.

**10. Roadmap mapping.** Missing (DRV-10 proposal in feature-coverage, needs a provider). Owner questions: feature-coverage Q5 (telephony proxy acceptable and who pays); whether calls are recorded.

## 14 Background location and battery profiles

**1. Definition and user goal.** While on shift, the phone reports position so dispatch and the recipient see the vehicle; the app uses fewer resources when parked. Source: ADR-0039 (accepted 2026-11-01); ADR-0009; ADR-0028; `driver-app.md` §6.2 to §6.3.

**2. Workflow.** Runs only while the shift is active or paused. Two profiles: `moving` (High accuracy, about every 10 s or 20 m) and `parked` (Balanced, about 60 s or 50 m) entered on arrival at a stop or after fixes within 30 m for 3 minutes; a 150 m parked geofence exits to moving. Speed bands widen the distance interval. Fixes dropped when worse than 100 m, older, duplicate or impossible. Batches of up to 20 points to `driverPostLocations`; buffer keeps 240 points; a watchdog restarts a stale task. Offline: buffer drains oldest first; a lost point is a gap, not a lost fact (ADR-0028).

**3. Business rules and KSA/GCC specifics.** Battery budget: at most 4 % per hour on an active shift on the reference Android device (owner ruling 2026-11-01, Q-39). Shifts are 8 to 12 hours (`driver-app.md` §6.2). Heat: battery drain and phone heat in summer are not measured in any source (inference). PDPL: driver positions are personal data; the retention question is Q-5 (trails 90 days, provisional) and whether trails follow the two-year proof retention (domain §9 Q5). Positions are visible only while on shift (`driver-app.md` §6.3). Ramadan: no source.

**4. Data.** `del_driver_locations` ring of 240 per driver; daily trails `del_driver_trails` kept 90 days (domain §7); on phone the buffer; per point `battery_pct`, `is_charging`, `power_saver` (added by DEL-5, A-18).

**5. Surfaces.** Driver app background task and setup screen; dispatcher map (WEB-6); recipient page shows position only while `out_for_delivery` (D-24, domain §7).

**6. Permissions, roles and audit.** `delivery.driver.locations`. Position access by dispatcher is not audited per read (not specified).

**7. Dependencies and integrations.** `expo-location`, `expo-task-manager`, `expo-battery`; Play foreground-service `location` type; Android 14+ restrictions; iOS `UIBackgroundModes: location`. Commercial plugin rejected (ADR-0039 alternatives).

**8. Metrics and reporting.** Points per hour, gaps over 2 minutes, battery per hour per shift on one reference Android and one reference iPhone before wave 1 exit (`driver-app.md` §6.2). Stale-tracking alert after 5 minutes (DEL-5).

**9. How the market builds it.** Transistorsoft's plugin: a two-state moving/stationary machine, stop-detection, speed-scaled distance filter, batching; no measured battery figures published (background-location-teardown, S2 and S5; read 2026-11-01, repo path docs/research/background-location-teardown-2026-11.md). Safee: phone as tracker with trip summary (teardown-safee S5). Chosen shape for us: own tracker on `expo-location` with two domain-driven profiles, no commercial plugin, because the plugin needs a paid key and closed native code (ADR-0039). Adopted from the market: speed-scaled interval and batching (ideas only). We do not use motion-sensor stop detection (not in Expo SDK 58, ADR-0039).

**10. Roadmap mapping.** Covered: DRV-3 (profiles, watchdog, battery measurement), DEL-5 (ring, stale alert). Open: Q-39 ruled; Q-41 conflicting Google dates (see section 3); Q-5 trail retention (provisional 90 days). A native module only if measurement misses budget (ADR-0039).

## 15 Push notifications

**1. Definition and user goal.** The server tells a driver about a new offer, an assignment or cancellation change, or a cash block, without showing personal data on the lock screen. Source: `driver-app.md` §8.2; DRV-5; INT-4 (merged, roadmap §0).

**2. Workflow.** Sent by the server through the Expo push service; the app never sends push. Channels on Android: `offers` (high, heads-up), `run` (default), `cash` (high). Payload carries ids and a localised title and body rendered in the driver's locale. Foreground: offer from SSE, push suppressed for the same id. Background or killed: push opens the offer sheet after a fresh fetch. Offline: nothing arrives; offers expire.

**3. Business rules and KSA/GCC specifics.** No recipient name, phone or address in a notification (`driver-app.md` §8.2). Locale follows the driver's app language (section 17). Quiet hours for recipient messages are an INT-7 concept; none is defined for drivers.

**4. Data.** Expo push token per device (`push_token`, ≤4096 chars); cleared on archive, suspension, revocation and when the provider reports it invalid (DEL-4 2.11, INT-4).

**5. Surfaces.** Driver app notifications and deep links (`eeasydriver://offers/{id}`, `orders/{id}`, `cash`, `sync`); push sender (INT-4).

**6. Permissions, roles and audit.** Notification permission on the setup screen. Sending is server-side; delivery receipts are not described.

**7. Dependencies and integrations.** `expo-notifications`, Expo push service, INT-4 push sender (merged), `driverUpdatePushToken`.

**8. Metrics and reporting.** Push delivery and open rates: not specified.

**9. How the market builds it.** Bringg: push for assignments and alerts (features-driver-fleet-alerts S2, S1). Shipday: real-time alerts (S7). Chosen shape for us: id-only payloads, locale-rendered by the server (ADR-0016, ADR-0029 for SSE names). Our own rule: no personal data in push.

**10. Roadmap mapping.** Covered: INT-4 (sender), DRV-5 (driver push). Missing: none. Open: none filed.

## 16 App update and minimum version

**1. Definition and user goal.** A driver on an old build is told to update before an API or policy change breaks them, and the server refuses calls from builds below a minimum. Source: `driver.yaml` `DriverMe.min_app_version` (proposed) and `426 app_update_required` on every driver door; `driver-app.md` §12.4 and §13 Q5; DEL-4 plan 2.10.

**2. Workflow.** Every request carries `X-App-Version` and `X-App-Platform`. Below the configured minimum (semver), the server returns `426 app_update_required` with `details.min_app_version`; a missing header passes. The app shows a full-screen notice on any 426; `driverGetMe.min_app_version` gives a soft prompt on foreground. OTA updates via EAS Update apply on next cold start; the app never reloads mid-stop (`driver-app.md` §12.4).

**3. Business rules and KSA/GCC specifics.** A native build is needed for SDK upgrades, native modules and permission strings (`driver-app.md` §12.4). Store review timing is not in any source. Drivers on older Android devices may not receive updates promptly (inference; no source).

**4. Data.** Config `DRIVER_MIN_APP_VERSION_IOS` and `_ANDROID`, optional (DEL-4 plan 2.14). Device rows keep `app_version`.

**5. Surfaces.** Driver app update notice; API guard `AppVersionGuard` on `/v1/driver/*` (DEL-4 2.10); no dispatcher view.

**6. Permissions, roles and audit.** None beyond driver token.

**7. Dependencies and integrations.** EAS Build and Update channels, fingerprint runtime policy (`driver-app.md` §12.3 to §12.4); OPS-3 store accounts.

**8. Metrics and reporting.** App version distribution per device (PostHog ids, `driver-app.md` §11); not specified further.

**9. How the market builds it.** No source in the census or teardowns described a minimum-version gate; this is our design. Logestechs' driver app last listed release is October 2025 (teardown-logestechs A1), which is a store fact, not a policy.

**10. Roadmap mapping.** Partial: guard and config in DEL-4 (merged); Q-24 provisional default: `min_app_version` on `driverGetMe` and 426 (roadmap). DRV-6 owes "minimum-version handling if ruled". `driver-app.md` §12.4 and §13 Q5 are stale: they say no signal exists. Owner question: ratify Q-24.

## 17 Multilingual UI beyond Arabic and English

**1. Definition and user goal.** A driver reads the app in their own language, not only Arabic or English. Source: ADR-0016; AGENTS.md hard rule "Arabic and English for every string"; `driver-app.md` §10.

**2. Workflow.** Today: `ar` is the default on first launch, `en` is a setting; direction via RTL; `Accept-Language` follows the app language so server messages match. Adding a language needs the catalogue (`packages/i18n`) and a contract change: `driverRequestOtp.locale` enum is `[ar, en]` (`driver.yaml`). Offline: strings are bundled.

**3. Business rules and KSA/GCC specifics.** Feature-coverage states that Urdu, Hindi, Bengali and Tagalog cover most of the GCC driver workforce (inference from census; the workforce mix is not sourced). TGA says non-Saudi delivery drivers must work for licensed companies (features-driver-fleet-alerts S19, read 2026-11-02, Al Riyadh Daily). Calendar: Gregorian dates, Western digits (ADR-0016).

**4. Data.** Locale per driver (on the driver record, not stated); keys in `packages/i18n` `driver` namespace; CI fails on a missing key (`driver-app.md` §10).

**5. Surfaces.** Driver app, push text, WhatsApp OTP text (`locale` enum), support bundle.

**6. Permissions, roles and audit.** None.

**7. Dependencies and integrations.** ADR supersession for the driver app (feature-coverage §2 item 2); catalogue structure must allow more languages before DRV-4 screens ship (feature-coverage §2).

**8. Metrics and reporting.** Language distribution: not specified.

**9. How the market builds it.** Bringg: multilingual (features-driver-fleet-alerts S1). Shipday: 30 languages on its site (S7). Shipsy: Arabic, English and Hindi listed (teardown-shipsy §2.1, Capterra). Safee: English, Arabic, French, Urdu on the App Store (teardown-safee S11). Chosen shape for us: Arabic and English only (ADR-0016), with the catalogue to be extended by a superseding ADR for the driver app. The census proposes that supersession (DRV-11 in feature-coverage); not adopted.

**10. Roadmap mapping.** Missing (DRV-11, blocked by rule). Owner question: supersede ADR-0016 for the driver app, and which languages (feature-coverage §4 Q3).

## 18 Support bundle

**1. Definition and user goal.** A driver exports one file that support can read when something is stuck, without the app uploading anything silently. Source: `driver-app.md` §11; DRV-2 plan 2.8.

**2. Workflow.** Sync screen "export" writes one JSON file to the share sheet: app and update version, device and OS, clock offset, open and rejected outbox items with errors and request ids (payloads included, PINs never), upload rows without files, last 2,000 log lines. The driver sends it to support over WhatsApp (`driver-app.md` §11). Offline: fully local.

**3. Business rules and KSA/GCC specifics.** Bundle contains driver operational data including recipient names inside payloads; the PDPL basis for sharing it with support is not analysed in any source read (see Unanswered). PIN, token and phone never written to the log ring (`driver-app.md` §11).

**4. Data.** Built from `outbox_items`, `proof_uploads`, `log_lines` (ring capped at 5,000 lines or 7 days); not stored as its own record.

**5. Surfaces.** Driver app sync screen. Support: receives the file by WhatsApp; no staff tool to ingest it in any order.

**6. Permissions, roles and audit.** Driver only. No audit of export (not specified).

**7. Dependencies and integrations.** Share sheet (OS); Sentry and PostHog for remote diagnostics (`driver-app.md` §11).

**8. Metrics and reporting.** Export count: not specified.

**9. How the market builds it.** No public source among the teardowns describes a driver-side support bundle. Chosen shape for us: our own, manual and user-initiated; the reason is the rule "nothing uploads silently" (`driver-app.md` §11).

**10. Roadmap mapping.** Covered: DRV-2 (bundle, log ring). Open: no owner question; the PDPL basis for sharing recipient data with support is not filed.

## 19 Driver SOS

**1. Definition and user goal.** A driver in danger or an accident presses one action that tells dispatch where they are and which order they carry. Source: teardown-safee S5 (panic button); teardown-platform-comparison §4 (proposed DRV-12 "Driver SOS").

**2. Workflow.** Proposed: one action sends the last known position and the active order to dispatch; staff see it on the board; no SMS (ADR-0037). Safee's panic sends an admin email with the last known location (teardown-safee §2.1); the device or app that triggers it is not stated. Offline: the last known position is local; the event needs the outbox or a priority path, not decided.

**3. Business rules and KSA/GCC specifics.** Wasl and CST tracking rules for phone trackers are unresearched (RES-1 proposal in teardown-safee §6 A8). Heat and night work: no rule. PDPL: an SOS sends a position to dispatch; the basis is the same as the on-shift tracking in section 14.

**4. Data.** No entity. Proposed: an SOS event with position, time and order id, retained under the operations rule (not specified).

**5. Surfaces.** Driver app action; dispatcher board (WEB-7); push or alert channel (DEL-21 proposal, not in roadmap).

**6. Permissions, roles and audit.** Driver token; audit row not specified.

**7. Dependencies and integrations.** DEL-5 (positions), DRV-5 (push), DEL-21 (staff alerts, proposed). AGENTS: side effects through the outbox.

**8. Metrics and reporting.** SOS count and response time: not specified.

**9. How the market builds it.** Safee: panic button sends an immediate email to admins with the last known location (teardown-safee §2.1). Other platforms in the sources show no SOS. Chosen shape for us: none decided; the proposal in the platform comparison is one action to dispatch, no SMS. The ID collides: safee proposal A4 calls it "DRV-8", the platform note calls it "DRV-12", and feature-coverage uses DRV-8 for proof capture. The lead must assign one id.

**10. Roadmap mapping.** Missing. No order in `roadmap.md`. Owner questions: who is alerted, whether any call step exists (teardown-safee A4), and whether the order is wave 1 or 2.

## 20 Pre-shift check

**1. Definition and user goal.** At shift start the driver confirms the vehicle is fit (checklist, photos) and that the phone and permissions are ready. Source: features-driver-fleet-alerts Module 2 (vehicle pre-shift check; Bringg S1, DeTrack S15); feature-coverage §3 proposed DRV-9.

**2. Workflow.** Proposed: checklist before `driverStartShift` with photos; owner decides whether a failed check gates offers. Today: shift start picks a vehicle and an optional planned shift (`driver.yaml` `StartShiftRequest`); there is no checklist. Offline: start is online only.

**3. Business rules and KSA/GCC specifics.** Vehicle operating-card rules for motorcycle delivery (TGA, features-driver-fleet-alerts S19, S21; the 2026 executive regulation date is unconfirmed). Heat: a pre-shift check can record cooling and tyre condition; no KSA rule read. Ramadan reduced hours: a claimed six-hour and 36-hour weekly cap for Saudi Muslim employees appears only in secondary expat sites and is unverified (Article 98 claim); no shift rule in the roadmap uses it (see Unanswered).

**4. Data.** Proposed checklist record per shift; not in any domain entity today (domain §3.6 DriverShift has no checklist).

**5. Surfaces.** Driver app `(app)/shift/start`; dispatcher view not specified.

**6. Permissions, roles and audit.** Driver token; audit of a failed check not specified.

**7. Dependencies and integrations.** DRV-3 (shift), DEL-5 (shifts), DEL-4 (vehicles), DEL-10 (offers).

**8. Metrics and reporting.** Check completion rate: not specified.

**9. How the market builds it.** Bringg: pre- and post-shift forms, advanced tier (features-driver-fleet-alerts S1). DeTrack: pre-route safety checklist (S15). Wasal: loading checks in the driver tier matrix (teardown-wasal §2.3). Chosen shape for us: none decided; DRV-9 is a proposal. Borrowed: the checklist-before-start idea from Bringg and Wasal, not adopted.

**10. Roadmap mapping.** Missing (DRV-9 proposal, feature-coverage). Owner question: does a failed check gate offers (features-driver-fleet-alerts Unanswered 1 covers the same gate for expired documents).

## Unanswered

Owner questions and gaps no source settled. Each is one line the lead can turn into a question.

1. PDPL sensitive-data list after the 2023 amendment: whether location and national-ID data are sensitive. Search summaries conflict (W2 says the amendment removed location; a pre-amendment list includes it). The official text was not readable (MISA PDF blocked; Akin Gump 403). Blocks the basis for ID checks and the geofenced warning.
2. Midday outdoor work ban in 2026: official dates, and whether delivery riders and couriers are covered (W1 gives no legal rule for couriers and its text names 2025 dates).
3. Ramadan reduced hours for private-sector drivers: the six-hour and 36-hour cap appears only in secondary expat sites (W3). No 2026 Saudi announcement was found.
4. Retention and lawful basis for ID or Iqama scans and licence copies (B1 Unanswered 2).
5. COD limits, fees and who bears damage costs (B2 §4 Q10). The Salla SAR 20 and 1,000 figures are not sourced here.
6. Google Play date for geofencing as a foreground-service use: Q-41 says 2027-01-27; the vendor changelog says August 2026 (R16 S4 vs S11). Owner check in Play Console.
7. Secure-store accessibility value and the React Native Argon2 library (Q-44), needed before ADR-0034 is accepted.
8. ADR-0007's Logestechs citation: public pages show no custody chain (P5 §7 item 1). Locate the 2026-09-21 research or drop the citation.
9. Refusal at the door: attempt or straight to `failed` (domain Q6, Q-6).
10. Driver reorder of stops once server sequence exists (P3 Unanswered 20).
11. Driver app languages: supersede ADR-0016 for the driver app, and which languages (B2 §4 Q3).
12. Driver SOS: who is alerted and in which wave (P4 A4; P1 §4 DRV-12).
13. Pre-shift check: does a failed check gate offers (B1 proposal DRV-9).
14. Telephony proxy for calls and chat, provider, cost and call recording (B2 §4 Q5).
15. Partial delivery per merchant and the ADR it needs (B2 Q3; P3 Unanswered 6).
16. Scan as a proof kind, or barcode-at-drop only (B1 DRV-8 vs P4 A1).
17. Geofenced drop: advisory or blocking, and the radius (B2 DEL-26; P2 Unanswered 3).
18. Roadmap hygiene: ids are reused across proposals. "DRV-8" means proof capture in B2 and driver SOS in P4; "DRV-12" is SOS in P1; "DEL-19" means compliance in B1, intake in B2, service levels in P3, exception rules in P2. Assign new ids in the roadmap before any order is planned.
19. Driver-app document is stale in five places: §7.1 lacks the account picker; §5.3 describes replay-only PIN verification while the contract adds a live refusal path (`driver.yaml` events description); §12.4 and §13 Q5 say no min-version signal exists (it is proposed in `driver.yaml` and implemented in DEL-4); §13 Q2 (refresh grace) is answered by A-3.
20. `driver.yaml` `DriverOrderEvent.cash_pin` is documented as required for cash; live refusal (403) versus replay recording (200, cash_blocked) is decided by the H1 signal. Confirm the H1 definition with the contract owner.

## Feature index

Rows are the listed items in the brief's order. The ten-aspect sections above group them; section numbers are not row numbers.

| Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|
| 1 Sign-in by OTP and device binding | covered | DEL-4, DRV-1 | 1 | Q-8 |
| 2 Account picker (multi-account phone) | partial (contract yes; driver-app §7.1 stale) | DEL-4, DRV-1 | 1 | none |
| 3 Device limit and revocation | covered | DEL-4 | 1 | Q-8 |
| 4 Cash PIN | covered (set, reset, lock) | DEL-4 | 1 | Q-15 |
| 5 Device verifier (offline PIN) | partial (ADR-0034 proposed) | DRV-1, DEL-4 | 1 | Q-15, Q-44 |
| 6 Permissions | covered | DRV-1, DRV-3 | 1 | Q-26 |
| 7 Setup flow | covered | DRV-1 | 1 | none |
| 8 Offline outbox | covered | DRV-2 | 1 | Q-25 |
| 9 Sync screen | covered | DRV-2 | 1 | Q-25 |
| 10 Run list | covered (order by slot) | DRV-4 | 1 | none |
| 11 Stop sequence (server) | partial | DRV-7, INT-6 | 2 | Unanswered 10 |
| 12 Offers sheet | covered | DRV-4 | 1 | none |
| 13 Acceptance race | covered | DRV-5, DEL-6 | 1 | none |
| 14 Order detail | covered | DRV-4 | 1 | none |
| 15 Pickup by scan | covered | DRV-4 | 1 | none |
| 16 Start stop | covered | DRV-4 | 1 | none |
| 17 Deliver | covered | DRV-4, DEL-7 | 1 | none |
| 18 Proof: photo | covered | DEL-7, DRV-4 | 1 | none |
| 19 Proof: signature | covered | DEL-7, DRV-4 | 1 | none |
| 20 Proof: recipient OTP | partial (contract only) | DRV-8 proposal | 2 | Unanswered 15 |
| 21 Proof: ID check | partial (contract only) | none | owner | Unanswered 1, 4 |
| 22 Proof: scan | missing (not in enum) | proposal (P4 A1) | open | Unanswered 16 |
| 23 Geofenced drop warning | missing | DEL-26 proposal | 2 | Unanswered 17 |
| 24 Partial delivery | missing (needs ADR) | DEL-30 proposal | 4 | Unanswered 15 |
| 25 Attempts with reasons | covered | DEL-7, DRV-4 | 1 | Unanswered 9 |
| 26 Returns at the door | partial (flow wave 4) | DEL-18 | 4 | none |
| 27 COD at the door | covered (record); handover wave 2 | DEL-7, DEL-11 | 1, 2 | Unanswered 5 |
| 28 Card at the door | missing by design | ADR-0017 | not scheduled | owner unlock |
| 29 Navigation hand-off | covered | DRV-4 | 1 | Unanswered 10 |
| 30 Call masking | missing | DRV-10 proposal | open | Unanswered 14 |
| 31 Chat masking | missing | DRV-10 proposal | open | Unanswered 14 |
| 32 Background location | covered | DRV-3, DEL-5 | 1 | Q-5 |
| 33 Battery profiles | covered (budget ruled) | DRV-3 | 1 | Q-39 (ruled) |
| 34 Push notifications | covered | INT-4, DRV-5 | 1 | none |
| 35 App update | partial (guard in DEL-4) | DEL-4, DRV-6 | 1 | Q-24 |
| 36 Minimum app version | partial (proposed field) | DEL-4, DRV-6 | 1 | Q-24 |
| 37 Multilingual UI | missing (ADR-0016) | DRV-11 proposal | blocked | Unanswered 11 |
| 38 Support bundle | covered | DRV-2 | 1 | none |
| 39 Driver SOS | missing | proposal (id unassigned) | open | Unanswered 12 |
| 40 Pre-shift check | missing | DRV-9 proposal | open | Unanswered 13 |

## Sources

Read dates are 2026-11-02 unless shown. Repo paths are relative to the repo root at `origin/main` 6ca087e. Branch notes were read with `git show` from the named remote branch.

| ID | Source | Read |
|---|---|---|
| R1 | `docs/architecture/driver-app.md` (whole) | 2026-11-02 |
| R2 | `docs/architecture/domain-model.md` §3.1, §3.3, §3.5 to §3.18, §7, §8, §9 | 2026-11-02 |
| R3 | `docs/architecture/identity-and-tenancy.md` §3.2, §4, §5, §9 | 2026-11-02 |
| R4 | `adr/0004-new-driver-app.md` | 2026-11-02 |
| R5 | `adr/0008-offline-first-driver-app-with-outbox.md` | 2026-11-02 |
| R6 | `adr/0021-driver-app-inside-the-monorepo.md` | 2026-11-02 |
| R7 | `adr/0034-offline-cash-pin-device-verifier.md` (proposed) | 2026-11-02 |
| R8 | `adr/0039-own-adaptive-location-tracker.md` | 2026-11-02 |
| R9 | `adr/0017-digital-cod-tap-to-phone-owner-gated.md` | 2026-11-02 |
| R10 | `adr/README.md` (ADR-0016, 0028, 0035 status lines) | 2026-11-02 |
| R11 | `docs/contracts/openapi/driver.yaml` (whole) | 2026-11-02 |
| R12 | `docs/orders/DEL-4/plan.md` §2, §8.2 | 2026-11-02 |
| R13 | `docs/orders/DRV-1/plan.md` §2 | 2026-11-02 |
| R14 | `docs/orders/DRV-2/plan.md` §2 | 2026-11-02 |
| R15 | `docs/roadmap.md` §0, §1.2 to §1.5 rows DEL-4 to DEL-18, DRV-1 to DRV-7, and Q-8, Q-15, Q-24 to Q-26, Q-39 to Q-41, Q-44 | 2026-11-02 |
| R16 | `docs/research/background-location-teardown-2026-11.md` (S2, S4, S5, S9, S11) | read 2026-11-01 by its author |
| R17 | `AGENTS.md` (hard rules, sizing) | 2026-11-02 |
| B1 | `origin/docs/feature-coverage:docs/research/features-driver-fleet-alerts-2026-11.md`; registry S1 to S34 inside it (Bringg, Onfleet, Shipox, Shipday, Torod, Samsara, TGA sources) | 2026-11-02 |
| B2 | `origin/docs/feature-coverage:docs/research/feature-coverage-2026-11.md` | 2026-11-02 |
| P1 | `origin/docs/platform-teardowns:docs/research/platform-comparison-2026-11.md` | 2026-11-02 |
| P2 | `origin/docs/platform-teardowns:docs/research/teardown-shipsy-2026-11.md` (A and T registries) | 2026-11-02 |
| P3 | `origin/docs/platform-teardowns:docs/research/teardown-wasal-2026-11.md` (S1 to S20) | 2026-11-02 |
| P4 | `origin/docs/platform-teardowns:docs/research/teardown-safee-2026-11.md` (S1 to S26) | 2026-11-02 |
| P5 | `origin/docs/platform-teardowns:docs/research/teardown-logestechs-2026-11.md` (A1, D2 to D5, L-series) | 2026-11-02 |
| P6 | `origin/docs/platform-teardowns:docs/research/teardown-omniful-2026-11.md` (O13, O14, O18, O19) | 2026-11-02 |
| W1 | DLA Piper, "Saudi Arabia enforces seasonal midday work ban to protect workers", note dated 2026-06-18, https://knowledge.dlapiper.com/dlapiperknowledge/globalemploymentlatestdevelopments/2026/saudi-arabia-enforces-seasonal-midday-work-ban-to-protect-workers (WebFetch) | 2026-11-02 |
| W2 | WebSearch results on the PDPL 2023 amendment (Groundlabs and DLA Piper summaries; Akin Gump and MISA text not readable) | 2026-11-02 |
| W3 | WebSearch results on Ramadan working hours (ksaexpats and economymiddleeast; secondary, no official Saudi text) | 2026-11-02 |

