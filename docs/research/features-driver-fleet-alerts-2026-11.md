# Feature census: driver app, fleet and workforce, merchant-staff alerts

Date: 2026-11-02. Status: research input for the lead; no decision taken. Scope: the three groups in the census brief. Roadmap references are to `docs/roadmap.md` §1 (every order's "Delivers" column, read 2026-11-02) and `docs/architecture/driver-app.md` §9 (screens per wave). Repo documents are cited by path. Web sources are cited as [S#] with the date read (all 2026-11-02) and whether the page was fetched or seen only as a search excerpt.

## Summary for the lead

1. The driver field loop is well covered: sign-in and device binding (DEL-4, DRV-1), offline outbox (DRV-2), pickup scan, photo and signature proof, attempts with reasons, COD recording (DEL-7, DRV-4), and battery profiles (DRV-3, ADR-0039). These match what the leading products offer.
2. No order covers merchant-staff alerts beyond events. `delivery.order.failed`, `delivery.driver.cash_blocked`, the 24-hour proof alert (D-17) and the 5-minute stale-tracking alert (DEL-5) name a dispatcher alert, but no order delivers a notification centre, staff WhatsApp or email alerts, SLA alerts, or escalation.
3. Driver compliance is missing entirely: no document entity (ID or Iqama, licence, registration, insurance) with expiry, and no gate on offers. Samsara and Fleetio both ship expiry alerts; the Saudi regulator ties delivery drivers to licensed companies and operating cards (S19, S21).
4. Drivers have no onboarding, training or pre-shift vehicle check in the roadmap. Bringg offers pre-shift forms (S1); Careem registers Captains and then trains them (S22, excerpt).
5. Proof kinds `recipient_otp` and `id_check` are accepted by the contract but blocked in the app until a wave order defines capture (driver-app §4.2). Barcode-at-drop is not a proof kind at all.
6. Partial delivery (some items refused with a reason) is not modelled: an order is delivered as a whole (domain-model §3.13, D-7). Several vendors support it (S25, S26).
7. Multilingual UI (Urdu, Hindi, Bengali, Tagalog) conflicts with the hard rule "Arabic and English for every string" (AGENTS.md; driver-app §10; ADR-0016). Bringg and Shipday offer more languages (S1, S7). The owner must rule.
8. Call and chat masking is missing: the app opens `tel:` and shows the recipient's number to the driver (driver-app §9). Bringg offers masked numbers and driver-dispatcher chat (S1).
9. Roadmap wording mismatch: INT-7 lists `cash_block_notice` under recipient messages, but integrations §5.1 sends it to the home-site dispatchers who opted in. Fix the row before the order is planned.
10. Regional evidence is thin. Torod, LogesTechs, SMSA, Aramex, Careem and HungerStation publish little driver-app detail. The sources here are mostly global products and one Saudi regulator timeline. Treat the KSA relevance ratings as inference where marked.

## Sources

Read 2026-11-02. "Fetched" means the page text was read. "Excerpt" means only the search result text was seen; treat such claims as unverified.

| # | Source | URL | How read |
|---|---|---|---|
| S1 | Bringg, About the Bringg Driver App (help) | https://help.bringg.com/docs/about-the-bringg-driver-app-1 | Fetched |
| S2 | Bringg, Set up alerts with automations (help) | https://help.bringg.com/docs/set-up-alerts-with-automations | Fetched |
| S3 | Onfleet, Proof of Delivery | https://onfleet.com/proof-of-delivery | Fetched |
| S4 | Onfleet, Notification set-up and triggers (help) | https://support.onfleet.com/hc/en-us/articles/360023669392 | Excerpt (page returned 403) |
| S5 | Onfleet, offline mode (help centre, via search) | https://intercom.help/onfleet-4f83d83093ac/en/articles/15254706 | Excerpt; URL not confirmed as the source of the text |
| S6 | Shipox, Features (driver app and dispatch) | https://shipox.com/features/ | Fetched |
| S7 | Shipday, Driver management | https://www.shipday.com/features/driver-management | Fetched |
| S8 | Shipday, Proof of delivery | https://www.shipday.com/features/proof-of-delivery | Excerpt |
| S9 | Tryoto (OTO), Driver management system | https://www.tryoto.com/shipping-management/driver-management-system | Fetched |
| S10 | OTO Flex, Advanced settings (help) | https://help.tryoto.com/en/support/solutions/articles/150000084852-advanced-settings-oto-flex | Excerpt |
| S11 | Torod, home page | https://www.torod.co | Fetched |
| S12 | Torod, About | https://torod.co/en/about-us | Excerpt |
| S13 | LogesTechs, Best delivery software in Saudi Arabia | https://logestechs.com/best-delivery-software-in-saudi-arabia/ | Fetched |
| S14 | LogesTechs, product page | https://logestechs.com/?p=16724 | Fetched (no driver-app content) |
| S15 | Spoke (formerly Circuit), The 5 best proof of delivery apps (article updated 2026-09-28; compares Spoke, Track-POD, Onfleet, DeTrack, OnTime 360) | https://spoke.com/blog/proof-of-delivery-app | Fetched; third-party comparison |
| S16 | Routific, Driver analytics and delivery performance reports (help) | https://academy.routific.com/en/articles/1317937-driver-analytics-and-delivery-performance-reports | Fetched |
| S17 | Samsara, Qualifications management (blog) | https://www.samsara.com/blog/qualifications-management | Fetched (undated page) |
| S18 | Fleetio, Contact management; renewal reminders (blog post dated 2012 in the excerpt) | https://www.fleetio.com/features/contact-management ; https://www.fleetio.com/blog/custom-fleet-renewal-reminders | Contact page returned 403; blog excerpt only |
| S19 | Al Riyadh Daily, TGA first-phase decisions on the delivery sector (published 2024-04-02) | https://alriyadhdaily.com/article/caecd0429a84468e918b739bd6545c4c | Fetched |
| S20 | Gulf News, Saudi freezes new motorcycle delivery licences (Oct 2024 per excerpt) | https://gulfnews.com/world/gulf/saudi/saudi-arabia-freezes-new-motorcycle-delivery-licences-operating-through-mobile-apps-as-regulatory-changes-loom-1.1728986009688 | Excerpt |
| S21 | GCC Business News, TGA executive regulations for goods transport by motorcycle (date not confirmed) | https://www.gccbusinessnews.com/tga-executive-regulations-goods-transport/ | Excerpt (page returned 403) |
| S22 | Careem Captain, App Store listing | https://apps.apple.com/us/app/-/id1356111909 | Excerpt |
| S23 | HungerStation rider app, and "Shaded Route" feature (company-reported figures) | https://apps.apple.com/sa/app/id1417971080 ; https://thebrandberries.com/hungerstation-beats-the-heat-with-ai-powered-shaded-route-for-delivery-riders/ | Excerpt |
| S24 | Tookan, Geo-fencing (help) | https://help.jungleworks.com/knowledge-base/geo-fencing/ | Excerpt (page returned 500) |
| S25 | Track-POD, Partial shipment and redelivery (blog) | https://www.track-pod.com/blog/partial-shipment-redelivery/ | Excerpt |
| S26 | Grasshopper, Partial delivery (help) | https://grasshopperlabs.io/help/mobile-apps/partial-delivery/ | Excerpt |
| S27 | Grasshopper, Proof-of-delivery authentication levels (help) | https://grasshopperlabs.io/help/mobile-apps/proof-of-delivery-pod-authentication-levels/ | Excerpt |
| S28 | DispatchTrack, SKU return codes (docs) | https://trials.dispatchtrack.com/docs/sku-return-code-values.html | Excerpt |
| S29 | LogiNext, Secure logistics communication (call masking) | https://www.loginextsolutions.com/secure-logistics-communication-call-masking | Excerpt; vendor marketing |
| S30 | Twilio, What are masked phone numbers (glossary) | https://www.twilio.com/docs/glossary/what-are-masked-phone-numbers | Excerpt |
| S31 | Tamimi, Saudi PDPL: key considerations for employers | https://www.tamimi.com/news/saudi-arabias-new-personal-data-protection-law-key-considerations-for-employers/ | Excerpt; law-firm commentary |
| S32 | Middle East Briefing, How to check Iqama validity | https://www.middleeastbriefing.com/news/how-to-check-iqama-validity-in-saudi-arabia/ | Excerpt; low-quality source, not used for rules |
| S33 | Urbi GeoFlow, monitoring (admin docs) | https://docs.urbi.ae/geoflow/administrator/monitoring | Excerpt; reference only |
| S34 | Expiration Reminder, Iqama and work permit tracking (vendor page) | https://www.expirationreminder.com/document-tracking/iqama-saudi-work-permit | Excerpt; vendor claim |

Repo sources (read 2026-11-02): `docs/roadmap.md`; `docs/architecture/driver-app.md`; `docs/architecture/domain-model.md`; `docs/architecture/integrations.md`; `docs/architecture/platform.md`; `docs/contracts/openapi/driver.yaml` and `staff-delivery.yaml`; ADRs in `adr/` at the repo root (ADR-0005, 0007, 0008, 0016, 0017, 0037, 0039, 0041); `AGENTS.md`.

Source conflict. Onfleet offline: S5 says offline mode is an admin setting, off by default, and that a driver cannot start or complete a task without connectivity while it is off. S15 says "DeTrack and Onfleet require active connectivity". Not resolved; test in a trial before relying on either.

## Module 1: Driver app and field loop

| Feature | What it does | Who offers it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Sign-in and device binding | Driver signs in with a one-time code and binds the phone; the refresh is tied to the device | Bringg: email, phone or SSO (OpenID Connect) login (S1) | High: the only sign-in path in waves 0 to 2 is a WhatsApp code (integrations §5.3, ADR-0037); a driver without WhatsApp cannot sign in | Covered: DEL-4 (driver OTP, device binding), DRV-1 | 1 (in plan) |
| Offline capture and replay | Field events and proofs are written to the phone and replayed when online | Spoke, Track-POD, OnTime 360 offline capture (S15); Onfleet: conflicting sources (S5, S15) | High: door-side work with weak signal in dense areas (inference; not sourced for KSA) | Covered: DRV-2 (outbox, sync screen), DEL-7 (replayable events), ADR-0008 | 1 (in plan) |
| Run list and stop order | Ordered stops for the driver's shift, with status and COD | Bringg: customisable stop order and clustering (S1); Tryoto: route optimisation up to 30 stops (S9); Routific: stop-level route data (S16) | High: stop order sets the drive time through Riyadh traffic (inference) | Partial: DRV-4 (run list by slot and assignment time, local reorder, wave 1); INT-6 (VROOM sequence, deferred to end of wave 2 by A-24) | 1 list; 2 server sequence |
| Navigation hand-off | Opens Google Maps, Apple Maps or Waze at the stop | Bringg: connects to Google Maps and Waze (S1); Shipox: "pinpoint navigation" (S6) | High: drivers already use these apps (inference) | Covered: DRV-4 (order detail, "Navigate", driver-app §9) | 1 (in plan) |
| Pickup by scan | Scans the parcel label at pickup and matches it to the order | Bringg: camera barcode scanning (S1); Onfleet: barcode scanning (S3) | Medium: depends on merchants printing labels; unverified | Covered: DRV-4 (pickup by scan, label match, manual entry, driver-app §9) | 1 (in plan) |
| Scan at drop as proof | Scan the parcel label at the door as the proof | Onfleet: multiple barcodes can be required per delivery (S3); Spoke: barcode scans are a POD method (S15) | Medium: an audit trail for COD disputes (inference) | Missing: barcode is not a proof kind (domain-model §3.10 lists photo, signature, recipient_otp, id_check) | Owner ruling; 2 if ruled |
| Photo proof | Photo at the door, processed on the phone | Onfleet (S3); Shipday: photos (S7); Spoke: photos and signatures (S15) | High: standard POD kind | Covered: DRV-4, DRV-2 (proof queue), DEL-7 | 1 (in plan) |
| Signature proof | Signature canvas with the recipient's typed name | Onfleet (S3); Shipday: signature capture (S7) | Medium: standard kind; demand not sourced for KSA | Covered: DRV-4, DRV-2 | 1 (in plan) |
| Recipient OTP as proof | Recipient reads a code, driver enters it, server verifies | Grasshopper: code sent to the consignee's phone, optional per account (S27); OTO Flex: photo or OTP proof (S10); Track-POD: PIN verification (S15) | High: the WhatsApp templates and OTP rail already exist (ADR-0037); the contract accepts `recipient_otp` (driver.yaml) | Partial: DEL-7 accepts the kind; driver-app §4.2 blocks it until a wave order defines capture; no order does | 2 (needs an order and a template) |
| ID check at the door | Driver checks a government ID and records the check | Onfleet: age check against government ID (S3); Shipday: ID verification on a higher plan (S8, excerpt) | Low: no KSA demand found; storing ID data needs a PDPL basis (S31, unverified) | Partial: contract kind exists; driver-app §4.2 blocks it; no order | Owner decision |
| Geofenced delivery | Drop is allowed or flagged only within a radius of the address point | DeTrack: geofencing checks (S15); Tookan: geofence triggers on entry and exit, no block documented in the excerpt (S24) | Medium: GPS error and short-code addresses (inference; National Address short codes are in use, driver-app §9) | Partial: DRV-3 parked geofence (ADR-0039) is for the tracker, not for proof; INT-2 geocode (DEL-2) gives the point | 2 candidate; warning first |
| Attempts and reasons | Records a failed visit with a reason code; the order fails at the account's maximum | Onfleet: Task Failed notification (S4); Torod: "handling failed delivery" and "5 failed attempts" on the merchant page (S11); DispatchTrack return codes (S28) | High: failed visits drive cost (inference from S11) | Covered: DEL-7 (attempts §3.15, D-14), DRV-4 attempt screen | 1 (in plan) |
| Partial delivery | Some items delivered, others refused with a reason, signature for the accepted ones | Track-POD: partial delivery with refusal reasons (S25); Grasshopper: reject items, then sign for the rest (S26); DispatchTrack: per-SKU return code (S28) | Medium: multi-item merchant orders (inference) | Missing: the order has one state for the whole order (domain-model §3.13); D-7 requires full proofs and COD sum; per-item outcome is only an open question for exchanges (domain-model §9 Q4) | Owner decision; needs an ADR (state machine) |
| Returns at the door | Collects a returned item at the drop with a reason | DispatchTrack return codes (S28); Grasshopper reject-and-sign flow (S26) | Medium: return volume from marketplaces (inference) | Partial: `return_pickup` kind (domain-model §3.1); labels "collect" (driver-app §9); end-to-end flow is DEL-18 (wave 4); `checkInReturn` exists in staff-delivery.yaml | 4 as planned; owner may pull forward |
| COD at the door (cash, card, mada, wallet) | Records each collection by method; cash needs the cash PIN | Logestechs: COD fee automation (S13, merchant side); Torod: COD settlement (S11, merchant side) | High: COD is a common payment method in KSA e-commerce (inference; mada is the domestic debit scheme, not sourced here) | Covered: DEL-7 (COD, custody), DRV-4 (deliver with COD), DRV-7 and DEL-11 (handover, block) | 1 record; 2 handover (in plan) |
| Card terminal on the phone | Driver takes a card payment on the device | Not researched | Unknown | Missing by design: ADR-0017 keeps digital COD gated; the app never takes a card | Not scheduled |
| Driver–recipient call or chat masking | Calls and messages go through a proxy number; neither side sees the other's number | Bringg: masked phone numbers and driver–dispatcher chat (S1); LogiNext (S29); Twilio Proxy (S30) | Medium: the app opens `tel:` and shows the number to the driver (driver-app §9); harassment is reported in vendor sources; no KSA evidence | Missing: no proxy in doc 9; a telephony provider would be a new external integration (outbox rule) | Owner decision; not before a provider is chosen |
| Multilingual driver UI (Urdu, Hindi, Bengali, Tagalog) | Driver app in more languages | Bringg: multilingual support (S1); Shipday: 30 languages on its site (S7) | High for the workforce if it is largely non-Saudi (inference; TGA says non-Saudi delivery drivers must work for licensed companies, S19); conflicts with the AR/EN rule | Missing; conflicts with AGENTS.md "Arabic and English for every string", driver-app §10, ADR-0016 | Owner ruling plus ADR |
| Battery and tracking profiles | Moving and parked cadence, power saver, battery budget of 4 % per hour | Transistorsoft plugin named in ADR-0039 as the leading commercial plugin; vendor page not fetched in this run | High: 8 to 12 hour shifts (driver-app §6.2) | Covered: DRV-3 (ADR-0039), Q-39 | 1 (in plan) |
| Shaded or heat-aware routing | Route choice favours shade in summer | HungerStation rider app "Shaded Route" (S23; figures are company-reported) | Medium: Saudi summer heat is the stated reason (S23) | Missing | Owner decision; not in roadmap |
| In-app support to dispatch | Driver reaches dispatch from the app | Bringg: driver–dispatcher chat (S1) | Medium: phones are the driver's only link to dispatch (inference) | Partial: DRV-2 sync screen, support bundle, log ring (driver-app §4.5, §11); "call dispatcher" text only | 1 partial; chat owner decision |

## Module 2: Fleet and workforce

| Feature | What it does | Who offers it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Driver and vehicle records | Creates drivers and vehicles, status, home site, vehicle kind and capacity | Shipday: in-house and third-party drivers, live tracking (S7); Tryoto: teams and vehicle types (S9) | High: own fleets are the product model (ADR-0005, AGENTS.md) | Covered: DEL-4 (drivers, vehicles, devices), WEB-6 (drivers, vehicles) | 1 (in plan) |
| Driver status, suspension and cash block | Active, suspended or archived; cash block clears by a dispatcher | Not researched beyond the cash-block design | High: cash custody control (ADR-0007) | Covered: domain-model §3.7; DEL-4, DEL-11 (clearing) | 1 and 2 (in plan) |
| Assignment rules and capacity | Limits per driver; assignment by city, proximity, workload, capacity, priority | Tryoto: rules by city, proximity, workload, capacity and priority (S9); Shipday: automatic assignment (S7) | High: capacity counters are a stated invariant (D-10) | Covered: DEL-6 (capacity counters, manual offers), DEL-10 (rule-based offers, wave 2) | 1 manual; 2 automatic (in plan) |
| Shift start, pause and end | Driver starts a shift with a vehicle, pauses and ends it | Bringg: start and end by swipe (S1); Shipday: schedules (S7) | High: shifts gate offers, cash and location (domain-model §3.17) | Covered: DEL-5 (shifts), DRV-3 (shift actions) | 1 (in plan) |
| Shift planning and rosters | Planned shifts and schedules | Shipday: "assign, monitor, and optimize driver schedules" (S7) | Medium: planned shifts for own drivers (inference) | Covered: DEL-10 (planned shifts), WEB-9 (screens) | 2 (in plan) |
| Attendance records | Shift start and end times, lateness, absence | Urbi GeoFlow: shift-level task metrics (S33; reference only); no driver-app vendor source found | Medium: labour records for own drivers (inference) | Partial: DEL-5 stores shift start and end (domain-model §3.17, events); no attendance report or lateness rule | 2 (report over existing events) |
| Slots and capacity per slot | Capacity per slot and day | Not researched | Medium | Covered: DEL-9 (slots and slot days) | 2 (in plan) |
| Compliance documents with expiry (ID or Iqama, licence, registration, insurance) | Stores each document with its expiry, lets the driver upload, and blocks assignment when one has lapsed | Samsara: expiry alerts to admins and drivers, driver self-service upload, alert when a driver starts a vehicle they are not qualified for (S17); Fleetio: renewal reminders for contacts and vehicles, including insurance (S18, excerpt; the 2012 post is old); Saudi: TGA requires a valid operating card for motorcycle delivery (S19); iqama expiry visible on Absher and permit records on Qiwa (S32, low quality) | High: the TGA phase-one decisions tie non-Saudi delivery drivers to licensed companies, uniforms and operating cards (S19); the regulator's motorcycle licence freeze (S20) and executive regulations of 2026 (S21, date unconfirmed) make the rule set live | Missing: domain-model §3.7 has no document entity; no order in roadmap | New order (proposed); wave 1 if gating is wanted, else 2 |
| Expiry reminders to staff | Scheduled reminders at fixed lead times before expiry | Samsara (S17); Fleetio (S18); a vendor's 90, 60 and 30 day intervals (S34, excerpt, vendor claim) | Medium: depends on the document order | Missing | With the document order |
| Vehicle pre-shift check | Checklist at shift start with photos | Bringg: pre- and post-shift forms such as vehicle checks (S1, advanced tier); DeTrack: pre-route safety checklist (S15) | Medium: vehicle operating card rules (S19, S21) | Missing; maintenance is out of scope (brief) | Owner decision |
| Driver performance and scorecards | On-time, failed and completed counts per driver, period reports | Routific: end-of-day performance reports, needs Live Tracking and the driver app (S16); Shipday: monitor performance (S7); OTO Flex: performance dashboard and SLA tracking (search excerpt; page not identified) | Medium: no KSA source on which metrics matter | Covered for reports: DEL-17 (SLA and scorecards, wave 4), Q-32 default | 4 (in plan); earlier by owner ruling |
| Driver-visible performance | Driver sees own metrics | Routific: not stated (S16); Careem Captain: daily earnings view (S22, excerpt) | Low to medium | Missing | Owner decision |
| Pay statements | Statement per driver and period | Careem Captain: daily earnings view and payouts (S22, excerpt; a third-party explainer gives a commission figure, unverified) | High for own fleets (inference) | Covered: DEL-13 (wave 2, statements; Q-32 read-only reports) | 2 (in plan) |
| Incentives and bonuses | Rules that add pay for on-time or volume | Careem Captain: bonus programmes (S22, excerpt) | Medium: pay policy is an owner decision | Missing: no incentive rule in domain-model or roadmap | Owner decision |
| Training and onboarding | Onboarding checklist and training before first shift | Careem: registration in a Captain portal, then training (S22, excerpt); Samsara: driver self-service (S17) | Medium: training obligations in KSA not verified | Missing: DEL-4 covers creating the driver and OTP only | Owner decision |
| Device management | Bind, list and revoke driver phones; two active devices | Bringg: SSO login (S1); device binding in DEL-4 | Medium | Covered: DEL-4 (`listDriverDevices`, `revokeDriverDevice`), WEB-6 (devices); Q-8 default two devices | 1 (in plan) |
| Company-phone management (MDM) | Remote lock and app control for company phones | Not researched | Unknown | Missing; owner has not said whether phones are company-owned | Owner question |

## Module 3: Notifications to merchant staff

| Feature | What it does | Who offers it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Failed-delivery alert to dispatch | Alerts a dispatcher when an order fails or an attempt fails | Bringg: alerts with severity, in-platform, SMS, email and webhook (S2); Onfleet: Task Failed notification and webhook (S4) | High: failed visits are the cost driver (inference from S11) | Partial: `delivery.order.failed` names a dispatcher alert (domain-model §6); no order delivers the channel; WEB-7 board shows status only | 1 with the notification centre |
| SLA-breach alert | Alerts when a promised window is missed | Bringg: no SLA option in the alert help (S2) | Medium: merchant windows not sourced for KSA | Missing alerts; DEL-17 gives reports only | 4 with DEL-17, or earlier by ruling |
| Cash-block alert | Alerts dispatchers when a driver holds cash past the rule | `delivery.driver.cash_blocked` names a dispatcher alert (domain-model §6); integrations §5.1 designs `cash_block_notice` as a WhatsApp utility to home-site dispatchers who opted in | High: cash custody control (ADR-0007) | Partial: DEL-11 (cash block and clearing, wave 2); INT-7 lists `cash_block_notice` as a recipient message, which conflicts with integrations §5.1 | 2 (in plan); fix INT-7 wording |
| Budget threshold alert | 80 % of the monthly message budget shows an in-app notice; 100 % skips recipient messages | integrations §5.6 (internal design); Bringg: SMS costs passed to the customer (S2) | Medium: message costs are a pricing input (Q-33) | Partial: INT-3 (monthly budget counter, wave 1); PLAT-12 usage counters; the in-app notice needs the notification centre, which no order builds | 1 with the notification centre |
| Stale-tracking alert | Alerts when a driver on an active shift has sent no point for 5 minutes | DEL-5 defines it (roadmap); sink not named | Medium: dispatch watches the map (inference) | Partial: DEL-5 defines the alert; no channel | 1 with the notification centre |
| Proof-pending alert | Alerts when a proof is still pending upload 24 hours after delivery (D-17) | domain-model D-17; driver-app §4.4 says the dispatcher is alerted | Medium | Partial: event rule defined; no channel order | 1 with the notification centre |
| In-app notification centre | A list of alerts with read state, severity and links | Bringg: alerts page on the platform (S2); Shipday: real-time alerts when a delivery completes (S7) | High: the budget notice and cash-block notice are designed as in-app or WhatsApp; no order builds the centre | Missing: WEB-3 home shows modules only | 1 (proposed order) |
| WhatsApp alerts to staff | Sends an alert to a staff member's WhatsApp | Bringg: SMS and email to admins and dispatchers (S2); Shipday: SMS and WhatsApp notifications on plans, recipient not stated (S7) | High: WhatsApp is the messaging rail (ADR-0041, ADR-0037); the platform number is for OTP and platform messages, merchant-linked numbers come in a later order | Partial: integrations §5.1 `cash_block_notice` (wave 2); ADR-0041 merchant-linked numbers not scheduled | 2 with cash-block alert; owner ruling on which number |
| Email alerts to staff | Sends an alert to a staff email | Bringg: email to admins and dispatchers (S2) | Medium: email is a secondary channel (inference) | Partial: PLAT-9 mail adapter (invitations and resets only) | 1 with the notification centre |
| Escalation rules | Re-notifies a second recipient after a delay if an alert is not acknowledged | Bringg: no time-based escalation documented (S2) | Medium: owner routing for failed and cash alerts is unset | Missing | Owner decision |
| Alert acknowledgement and severity | Staff acknowledge an alert; severity sets priority | Bringg: severity levels (S2) | Low to medium | Missing | With the notification centre |
| Recipient messages on failed attempt | Tells the recipient about an attempt and offers reschedule | Torod: SMS at each delivery stage (S11); Onfleet: one notification per trigger, 10-second anti-spam (S4) | High: already in plan | Covered: INT-3 (`order_attempted`), INT-7 (reschedule links) | 1 and 2 (in plan) |

## Proposed orders

Numbers are placeholders for the lead; no order is opened by this note. Dependencies are the roadmap orders named.

1. DEL-19 (proposed): driver compliance documents with expiry, driver upload, and an optional offer gate. Depends on DEL-4, WEB-6, DEL-6. Needs a document-retention rule under the PDPL (see Unanswered).
2. DEL-20 (proposed): staff notification centre and alert routing, in-app and email first, with severity and per-user channel settings. Depends on PLAT-10 (roles), PLAT-9 (mail adapter), INT-3 (budget counter).
3. DEL-21 (proposed): dispatcher alerts for failed orders, cash blocks, proof pending 24 hours, and stale tracking, wired to the domain events. Depends on DEL-20, DEL-7, DEL-11, DEL-5.
4. INT-9b (proposed, wave 2): WhatsApp staff alerts through the merchant-linked or platform number, starting with `cash_block_notice`. Depends on DEL-20, DEL-11 and ADR-0041's merchant-number order (owner ruling needed).
5. DRV-8 (proposed): recipient OTP and barcode-at-drop proof capture in the driver app, with the matching proof policy. Depends on DRV-4, DEL-7, INT-3 template approval (ADR-0037).
6. DRV-9 (proposed): pre-shift vehicle check and onboarding checklist before the first shift. Depends on DRV-3, DEL-5, DEL-4. Owner decides whether it gates offers.
7. DEL-22 (proposed): arrival and drop warning outside the geofence of the geocoded point; advisory first, blocking only by ruling. Depends on INT-2, DRV-3, DRV-4.
8. DEL-23 (proposed, needs ADR): partial delivery with per-item outcomes. Changes the order state machine and D-7 (COD sum), so it needs an ADR and depends on DEL-7 and DEL-18.
9. DRV-10 (proposed, needs a provider): masked calls and chat for driver and recipient. Depends on PLAT-8 (outbox) and an external telephony provider.
10. DRV-11 (blocked by rule): driver app in Urdu, Hindi, Bengali and Tagalog. Only after an ADR supersedes the Arabic and English rule.

## Unanswered

1. Should a driver without valid ID or Iqama, licence or insurance be blocked from offers, or only warned? Which document types apply to own-fleet motorcycles and vans?
2. What is the retention and lawful basis for storing ID or Iqama numbers and licence scans under the PDPL? The sources here are secondary (S31); the employer rules were not verified against the SDAIA text.
3. Do merchants want partial delivery with per-item refusal? That changes the order state machine and needs an ADR.
4. Which merchants need recipient OTP or ID check at the door, and which proof kinds are mandatory per merchant?
5. Is a telephony proxy for calls and chat acceptable, and who pays for it? Current design shows the recipient's number to the driver (driver-app §9).
6. Driver app languages: keep Arabic and English (AGENTS.md), or supersede the rule for Urdu, Hindi, Bengali and Tagalog? What is the workforce mix?
7. Who receives failed-delivery, cash-block and SLA alerts, and after how long without acknowledgement does an alert escalate?
8. Which number sends staff WhatsApp alerts: the platform number (OTP and platform messages, ADR-0041) or a merchant-linked number? Is that a new order?
9. Confirm the roadmap wording: INT-7 lists `cash_block_notice` as a recipient message, while integrations §5.1 sends it to dispatchers who opted in.
10. Are driver phones company-owned (needs MDM) or personal (device binding only)?
11. Are training and onboarding required by merchants or by the regulator? The TGA rules fetched (S19) do not name a training requirement.
12. Do merchants want driver-visible earnings, incentives and performance? Pay policy is not decided in the roadmap beyond Q-32.
13. Is card acceptance on the phone (mada, card terminal) in scope? ADR-0017 keeps it gated; no vendor was researched for it.
14. Research gaps, not owner questions: the public driver apps of Torod, LogesTechs (product page fetched, no driver content), SMSA, Aramex, Careem Captain and HungerStation publish little detail; Samsara's KB, Fleetio's contact page, the GCC Business News TGA article and the Tookan geofence page could not be fetched; the TGA 2026 executive regulations for motorcycle goods transport were seen only as an excerpt with no confirmed date. Verify against the TGA and vendor documentation before any order relies on them.
