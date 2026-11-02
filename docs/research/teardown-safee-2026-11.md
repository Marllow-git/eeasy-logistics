# Teardown: Safee (KSA fleet telematics with a last-mile module), 2026-11

Date: 2026-11-02. Branch `docs/teardown-safee` from `origin/main` at `1e0c184`. Author: researcher agent for the lead.
Site: https://safee.com (platform row of the KSA census, `docs/research/ksa-platform-census-2026-11.md` on `origin/docs/ksa-platform-census`).

Date convention: every source in §8 was read on 2026-11-02. Where a page shows its own date, that publisher date is given in the registry and is not a read date. Evidence codes: [Sn] = registry §8. [F] = page fetched and read. [S] = search-result summary only, page not opened. [I] = my inference from a cited fact. Unmarked statements are the vendor's own claims. Safee's own pages carry no independent customer evidence; treat every capability as "claimed" unless a release note or app listing states it.

## 1. Summary for the lead

1. Safee is a fleet telematics platform (GPS, CAN-bus, sensors, video, satellite) sold by Safee Technology LLC [S1][S11][S5]. Its last-mile module is one of about 20 modules [S1][S4]. The G2 seller page gives Dubai HQ and 2022 founding [S21].
2. Serves fleets and delivery operators in KSA and the Gulf. No customer is named; the three testimonials are unnamed (one Saudi logistics manager) [S2]. No price appears on any page read [S1][S4][S5].
3. Saudi depth is in compliance: Wasl (TGA) integration for applicable transport activities, Jeddah-only Madinati reporting, CST tracking-service approval [S16][S9][S8].
4. Borrow 1: proof of delivery with QR or barcode scan validation and a location-confirmed handoff record (amend DEL-7) [S4].
5. Borrow 2: an assignment gap that stops flapping, and driver groups scoped to one client account (amend DEL-10, DEL-4) [S14][S17].
6. Borrow 3: a driver panic action that sends the last known location to admins (new order DRV-8) [S5].
7. Stronger on paper: cash custody. Safee gives COD as one line with no reconciliation; ours is a ledger with PIN checks at replay (ADR-0007, ADR-0034, DEL-11, DEL-12) [S4].
8. Stronger on paper: offline. Safee states offline use in one sentence; ours is an idempotent outbox with replay rules (ADR-0008, DRV-2) [S4].
9. Stronger on paper: recipient tracking and a documented, signed integration surface (DEL-8, INT-9, INT-10, ADR-0040). Safee shows no recipient page and no public API docs [S4][S20]. Our side is specified, not shipped.
10. Census corrections: Madinati covers Jeddah only; the dispatch, POD, COD and offline claims sit on a last-mile sub-page, not the home page; docs.safee.com exists but holds release notes, not API docs [S9][S4][S20].

## 2. Product map

Each row cites registry IDs. "Where it lives" uses web (manager console), driver app, API.

### 2.1 Live tracking and fleet monitoring

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Live vehicle tracking | Real-time monitoring of many vehicles, "second-by-second updates", on a dashboard | Web; manager mobile app | S1, S7 |
| Manager app (Safee Tracking, iOS) | Live monitoring, route history, alarms, driver performance and alarms, waybill lookup, maintenance tasks, reports; English, Arabic, French, Turkish; 2 ratings averaging 3.0 | Manager mobile app | S12 [F] |
| Phone as tracker (AVL) | The driver's phone sends location, speed and distance in the background and gives a trip summary at the end | Driver app | S5, S11 [F] |
| Geofences | Virtual boundaries around routes, sites and restricted zones; entry and exit alerts | Web; manager app | S6, S7 |
| Alarms | "More than 50" alarm types: speeding, harsh braking, idling, unscheduled stops, temperature, fuel anomalies; custom thresholds | Web; mobile | S1, S5, S7 |
| Panic button | Sends an immediate email to designated admins with the vehicle's last known location; the device or app that triggers it is not stated | Web (admin email) | S5 |
| Trip and driver reports | Trip reports by vehicle, geofence and driver; export to Excel or PDF; saved reports run on a schedule with recipients and CC | Web | S5 |
| Device commands | Query, configure and command tracking devices: transient, persistent (retried until success or failure), bulk, alarm-driven and conditional (time or geofence) | Web; device link | S5, S13 (6.5.8 title) |

### 2.2 Driver app (Safee Driver, iOS listing)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Journeys and tasks | Lists assigned journeys and tasks as Pending, Scheduled or Completed; step-by-step map navigation; trip start and end confirmation | Driver app | S5, S11 [F] |
| Next-order choice | The driver picks the first order at trip start and the next order after finishing the current one (v1.1.1 notes) | Driver app | S11 [F] |
| Electronic proof of delivery | Listed as a feature; the listing gives no capture detail | Driver app | S11 [F] |
| Unicoop Orders | Shows order details and delivery status and lets the driver update the order status | Driver app | S11 [F] |
| Driving score | Performance scoring and risk assessment shown in the app | Driver app | S11 [F] |
| Languages and platform | English, Arabic, French, Urdu; iOS 15.6 or later; free; category Business; version 1.1.7 | App Store | S11 [F] |
| Offline | Driver app: "works offline in areas with poor connectivity and syncs automatically". Manager app: stores trip records and event logs until connectivity returns | Driver app; manager app | S4 [F], S7 [F] |

### 2.3 Dispatch and assignment

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Automatic job assignment | Jobs assigned "based on route logic, driver availability, and operational priorities"; drivers matched on proximity and capacity; assignment method not stated | Web; backend | S4 [F] |
| Capacity sources | In-house drivers, outsourced drivers, or "partner delivery resources" | Web | S4 [F] |
| Driver types | Static (fixed to one vehicle) or dynamic (authorised for several vehicles per shift); drivers added by hand or by Excel import | Web | S5 [F] |
| Dynamic reassignment | Ignition off and on within a threshold (default 60 s): the previous driver is reassigned when the new trip messages carry no driver ID; per-company on or off; device models can be excluded | Web; telematics device | S15 (25 Jun 2026) [F] |
| Assignment gap | Minimum time between two consecutive assignments to different vehicles, default 60 s, set per company | Company settings | S14 (27 Aug 2026) [F] |
| Driver groups | Client accounts create, edit and delete their own groups; only that account's drivers can be assigned; a "Manage Driver Groups" permission gates the page; "Show All Drivers" option | Web | S17 (13 Aug 2026) [F] |

### 2.4 Routing, journeys and tours

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Route planning | Routes factor in traffic, road condition and delivery sequence; "most cost-efficient and safest routes" | Web | S6 [F], S4 [F] |
| Routing algorithm | Not named; no benchmark or accuracy figure given | — | S4 [F] (absent) |
| Tours | Multi-journey delivery plans across several vehicles, built from depots, orders and fleet groups | Web | S5 [F] |
| Journey approval and risk | Pre-planned routes; automated approval or a configurable escalation workflow; each journey gets a risk score; the scoring method is not given | Web | S6 [F] |
| ETA | Goal stated as "improve ETA accuracy"; delays flagged "as they happen"; calculation not described; "estimated completion times" shown to managers in the driver app | Web; driver app | S6 [F], S4 [F] |
| Dynamic delivery windows | Windows adjusted from live traffic, driver proximity and urgency | Backend [I] | S4 [F] |

### 2.5 Proof of delivery, COD and recipients

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Proof of delivery | Digital signature, delivery photo, QR scan, barcode validation, location-confirmed handoff record, driver notes; photos of issues | Driver app | S4 [F] |
| OTP proof | Not on the page | — | S4 [F] (absent) |
| Cash on delivery | "Cash-on-delivery workflows" and "COD and POD photos"; collection, reconciliation, remittance and payment methods are not described | Driver app; web | S4 [F] |
| Recipient notices | "Real-time customer notifications" and "accurate status updates"; channels (SMS, WhatsApp, email) and triggers not named | Backend | S4 [F] |
| Recipient tracking page | Not described | — | S4 [F] (absent) |
| Order import | Bulk import from e-commerce platforms, ERP systems or manual entry; formats and volume limits not given | Web | S4 [F] |

### 2.6 Drivers, maintenance, reports and assistant

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Driver expiries | Expiries Explorer: alarms on licence and document expiry | Web | S5 [F] |
| Driver KPIs | RAG report, best-driver report, driver KPI report, violation monitoring for workload rules, workload and trip reports; KPI view added to the driver app (6.10.3 title) | Web; driver app | S5 [F], S13 [F] (title) |
| Vehicle maintenance | Standard, odometer-based, date-based, periodic, prompt and early tasks; spare parts; cost and resolution-time reports; PDF export of task cards | Web | S5 [F], S19 (11 Jul 2024) [F] |
| Amin AI assistant | Basic tier answers from a curated Q&A set; Amin AI tier answers "using your fleet data" by generating database queries; session quota; tier set by the licensed plan; activation through the partner administrator | Web | S18 (6 Aug 2026) [F] |
| Waste module | RFID tags on containers, scanned to the collecting vehicle; container history report | Web | S5 [F] |

### 2.7 Compliance and government links (Saudi)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Wasl (TGA) | Connection to the TGA platform for transport vehicles; registration sends device data with each vehicle; guide versions per activity (for example "Motorcycle Delivery" 1.1, "Inside Cities" 1.2) | Web; API to TGA [I] | S16 (17 Mar 2026) [F], S9 [F] |
| Madinati (Jeddah) | Reports vehicle location, weight and status to Jeddah Amanah for waste fleets; "requirements in other municipalities must be reviewed separately"; Riyadh left to the municipality | Web | S9 (19 Oct 2026) [F] |
| CST approval | Approved as a tracking service provider under the Tracking Services Registration; does not cover device approval, TGA activity qualification, Wasl connection or the hosting location of one deployment | — | S8 [F] |
| Opal | Claimed alignment with Opal standards for oil and gas | Web | S1 [F], S2 [F] (claim) |

### 2.8 Hardware modules (outside our scope; listed for completeness)

Weight sensors (analog, ROADEK, KIMAX), EV battery monitoring, TPMS, cold chain, satellite tracking (Satcomm), video telematics with Streamax cameras, CAN-bus equipment activity, fuel tanks and theft, immobiliser commands, warehouse temperature and humidity. Sources: S1 [F], S5 [F], S13 (6.5.15, 6.5.16, 6.5.8, 6.7.4, 6.9.4, 6.10.5 titles).

## 3. API and integration anatomy

- **Public API:** none documented in any page read. S4 lists "public API documentation, and webhooks" as absent. The FAQ does not mention an API [S5]. The vendor claims "flexible APIs" that connect ERP, logistics tools and third-party apps [S6] and "Advanced APIs" for ERP and waybill systems [S1]. Status: claimed, unverified.
- **Release-notes site:** docs.safee.com shows versions from 3.10.3 to 6.10.6 in one sidebar, with more than 150 entries [S13][S20] [F]. It holds release notes only: no endpoints, auth or webhook reference. [I] Most titles concern telematics, reports, government reporting and the assistant; the last-mile module has few release titles.
- **Identity:** the login link points to an OpenID Connect realm on app.safee.com [S3] [F]. [I] This suggests a Keycloak-style identity server; not confirmed.
- **Webhooks:** none documented. Alerts go to email (panic, scheduled reports, assistant transcripts) [S5][S18].

| Surface | Direction | What it does | Evidence |
|---|---|---|---|
| Wasl / TGA | Outbound | Vehicle registration with device data; per-activity guide versions | S16, S9 |
| Madinati (Jeddah) | Outbound | Location, weight and status reports for waste fleets | S9 |
| Google Maps | Outbound (map data) | Route guidance and map layer; "Google Maps Upgrade" (6.6.5 title) | S6, S13 |
| Streamax cameras | Inbound | Passenger counts for bus trip monitoring | S5 |
| IMEI-linked sensors, RFID | Inbound | Weight, temperature and humidity; container tags | S5 |
| Tracking devices | Two-way | Commands, configuration, status queries | S5 |
| Excel and CSV import | Inbound | Drivers, orders, attributes; "data importer" (6.5.21 title) | S5, S13 |
| ERP and e-commerce | Claimed two-way | "Bidirectional integration" and bulk import | S1, S4 [claim] |
| Salla, Zid, Shopify, WooCommerce, carriers | — | Not named on any Safee page read | S1–S7, S20 (absence on fetched pages, not proof) |

## 4. Operational model

- **Hierarchy:** partner administrator and helpdesk (S18) → company with a Company Admin (S13) → client accounts → driver groups and drivers (S13, S17). The privacy policy refers to an "FMS provider" that runs the platform for the client, and says GPS data is "owned by the client (owner of the fleet)" [S10] [F]. [I] Safee sells through partners who run instances; the page does not describe their terms.
- **Sites:** Wasl registrations "can be made per branch" [S5]. Company time zone and account cloning appear as release titles [S13].
- **Roles:** partners have full control; drivers see only assigned tasks and trips [S5]. Layered role-based access [S5]. Permission-gated management pages (Manage Driver Groups) [S17]. MFA is a release title (6.5.19) [S13].
- **Billing:** no price, tier table, trial or contract term on any page read [S1][S4][S5]. Capterra, G2 reviews and Software Advice returned HTTP 403 and were not read [S22]. The only commercial signal is licence-tiered features: the Amin AI tier depends on "your organization's licensed plan" [S18]. [I] Pricing is quote-based.
- **Automation:** conditional commands by time or geofence; alarm-driven commands [S5]. Automated journey approvals and a risk score per journey [S6]. Ignition-driven reassignment [S15]. Saved reports run on a schedule and are emailed [S5]. Auto job assignment is a claim [S4].
- **Retention and backup:** live web data kept "no less than six months"; older data on request; daily cloud backups with no retention period [S10].
- **Security:** "encrypted channels and role-based access controls" (answer cut off in the FAQ) [S5]. No certification, penetration test, incident response or encryption-at-rest statement on the privacy page [S10] [F].
- **Data location:** "The servers serving our Saudi clients remain hosted inside the Kingdom" [S8] (vendor statement, separate from CST). The privacy page says "local or offshore cloud providers" with no country [S10]. Both are vendor statements; the CST page itself says disclosed server locations "does not, by itself, confirm" Saudi hosting for a deployment [S8].
- **Store privacy label:** the Safee Driver listing says the developer "does not collect any data from this app", while the same listing says the app shares real-time location with the platform [S11] [F]. [I] A label conflict worth checking against our own labels (OPS-3).
- **Team and stack:** no Safee job posting or stack hint found [S24]. The login realm (§3) is the only stack hint [I].

## 5. Mapping to eeasy-logistics

"Borrow?" uses: yes (shape), adapt (shape with changes), no (reason and ADR). Order ids are from `docs/roadmap.md` §1.2 to §1.5. "Gap" means no order covers it.

| Feature | Safee | eeasy-logistics today | Borrow? |
|---|---|---|---|
| Live tracking | Second-by-second web map | DEL-5 pings and latest positions; WEB-6 map; ADR-0009 | Yes, already planned |
| Phone as tracker | Background AVL with trip summary | DRV-3, ADR-0039 (own tracker), ADR-0028 | Adapt: add a shift-end summary to DRV-3 (no new order) |
| Hardware telematics (GPS box, CAN-bus, fuel, TPMS, weight, EV, cold chain, video, satellite) | Core product | Gap; ADR-0002 scopes delivery and WMS only | No, for now: needs device vendors and hardware; revisit only on an owner ruling |
| Geofences | Entry and exit alerts | DEL-1 zones for coverage only | Adapt inside DEL-1: pickup and drop-off zone events |
| Alarm catalogue (50+ types) | Configurable alarms | DEL-5 stale-tracking alert; INT-3 messages | No: no evidence of demand for 50 types; keep a short alert list |
| Panic action | Admin email with last known location | Gap | Yes: amendment A4 (DRV-8) |
| Automatic assignment | Route logic, availability, priority, proximity, capacity | DEL-6 offers and manual dispatch; DEL-10 auto-dispatch; ADR-0009 | Yes, exists; add the gap rule (A2) |
| Ignition-driven reassignment | Device signal drives the driver change | Gap (no device feed) | No: depends on telematics; ADR-0039 gives phone location only |
| Assignment gap | 60 s per company | Gap | Yes: amendment A2 (DEL-10) |
| Driver groups scoped to an account | Client accounts manage their groups | DEL-4 has drivers and vehicles, no groups; ADR-0025 tenancy | Adapt: amendment A3 |
| Static or dynamic driver | Fixed or multi-vehicle per shift | DEL-4 driver to vehicle; DEL-5 shifts | Adapt: amendment A3 |
| Bulk driver import | Excel | DEL-3 imports orders only | Adapt: amendment A3 extends DEL-3 |
| Route optimisation | Traffic-aware, algorithm not named | INT-5, INT-6 (VROOM, ADR-0010), DEL-16; Q-45 benchmark | No borrow: ours names its solver and benchmark |
| Multi-stop tours with depots | Tours over depots, orders, fleets | INT-6 stop sequence; ADR-0018 sites | Adapt: treat depots as sites in DEL-16 (no new order) |
| Journey approval and risk score | Approval workflow; risk per journey | Gap | No: adds a staff step to every route with no evidenced need; revisit after WEB-7 use |
| ETA | Claimed, method not stated | INT-6 per-stop ETA; DEL-8 | Exists |
| Proof: photo, signature | Yes | DEL-7 proofs (photo, signature, recipient OTP, ID check); domain-model Proof row | Exists |
| Proof: QR or barcode scan, location-confirmed handoff | Yes | Gap in the Proof kinds | Yes: amendment A1 (DEL-7) |
| Proof: OTP | Absent | DEL-7 recipient OTP | Ours is ahead; no change |
| COD and cash custody | "COD workflows", no reconciliation | DEL-7, DEL-11, DEL-12; ADR-0007, ADR-0017 (digital COD gated) | No: ours is specified in more depth |
| Offline driver app | One-sentence claim | DRV-2; ADR-0008 | Ours is ahead on paper; already planned |
| Driver picks next order | Driver chooses the next order | DRV-4 and DRV-7 run list in server sequence | No: server sequence keeps dispatch control; revisit only on driver feedback |
| Driver KPIs and scorecards | RAG, KPI, violations | DEL-17 scorecards (reports only) | Adapt: amendment A7 |
| Driving score (harsh braking, speeding) | Scored in the app from device data | ADR-0039 uses GPS speed bands only | No: needs motion sensors, not in the plan; a new ADR if ever wanted |
| Document expiries (licence, registration) | Expiries Explorer | Gap | Yes: amendment A5 (DOC-1) |
| Vehicle maintenance | Full module with prompt and early tasks | Gap | Adapt: amendment A6 (VEH-1); owner picks the wave |
| Scheduled report delivery and exports | Scheduled email; Excel and PDF | DEL-17 reports; no export order | Adapt: amendment A7 |
| Recipient notices | Channels unnamed | INT-3 WhatsApp templates; ADR-0037; ADR-0041 | Ours is ahead; no change |
| Recipient tracking page | Absent | DEL-8, WEB-8 | Ours is ahead on paper |
| Public API and webhooks | Claimed, no docs | INT-9, INT-10; ADR-0030, ADR-0040 | Ours is ahead on paper; no change |
| Salla, Zid, carriers | None named | INT-11, INT-8 | Not a Safee lesson |
| Wasl (TGA) vehicle registration | Per-activity registration | Gap | Research first: amendment A8 (RES-1), then an owner decision |
| Madinati | Jeddah waste fleets only | Gap | No: waste is out of scope (ADR-0002) |
| Partner and client-account hierarchy | Partner, company, client account | ADR-0001 standalone; ADR-0006 provisioning door; ADR-0025 tenancy | No for resale; adapt the permission naming ("Manage Driver Groups") into doc 4 roles |
| Driver app languages | English, Arabic, French, Urdu | ADR-0016 Arabic and English | No: ADR-0016 governs |
| MFA and login | MFA (release title) | PLAT-11 (TOTP and OTP) | Exists |
| Data residency | Saudi servers claimed; offshore possible | ADR-0022 Gulf-region host | Exists; no change |
| AI assistant (Amin) | Tiered, quota-limited, uses fleet data | Gap | No: no order; any query over fleet data needs ADR-0025 and an owner decision |
| Manager mobile app | Safee Tracking and fleet app | Driver app only (DRV-*); staff use the web board (WEB-7) | Owner question; no order |
| Device commands (immobiliser, persistent retries) | Yes | Gap | No: device-dependent |
| Waste RFID containers | Yes | Gap | No: out of scope |

## 6. Proposed order amendments and new orders

None of these is ordered. The owner decides each one. Each keeps the one-task-one-PR rule (AGENTS.md).

- **A1. Amend DEL-7: scan proof and handoff record.** Add a `scan` proof kind for a QR or barcode value that matches the order's code, and store the device location and time at capture as a handoff record. Basis: S4. Shape: adapt; the current kinds are photo, signature, recipient OTP and ID check (domain-model Proof row). Merge danger: two-way door (additive kind), with a migration for the new kind.
- **A2. Amend DEL-10: assignment gap.** Add a per-account minimum time between two consecutive offers or assignments to different drivers or vehicles, default 60 s. Basis: S14. Shape: adapt (Safee's trigger is telematics; ours is an offer). Merge danger: two-way door (a setting).
- **A3. Amend DEL-4 and DEL-3: driver groups, driver type, driver import.** Driver groups scoped to an account (or to a site under ADR-0018), a static or dynamic driver type, a permission for managing groups, and CSV import for drivers and vehicles. Basis: S5, S17. Shape: adapt. Scope risk: this is one order, not three; the owner should confirm it fits wave 1.
- **A4. New DRV-8: driver SOS.** One action sends an event to dispatch with the driver's last known position and the active order; staff see it on the dispatch board (WEB-7); no SMS (ADR-0037). Depends on DEL-5 and DRV-5. Basis: S5. Shape: yes. Owner decides who is alerted and whether any call step exists.
- **A5. New DOC-1: driver and vehicle document expiries.** Licence and registration expiry dates, warnings before expiry, and an assignment block after expiry with a logged staff override. Depends on DEL-4. Basis: S5. Shape: adapt. Owner decides whether expiry blocks assignment.
- **A6. New VEH-1: vehicle service tasks.** Date-based and odometer-based service tasks with overdue warnings; no blocking until the owner rules. Depends on DEL-4. Basis: S5, S19. Shape: adapt. Wave 2 is the candidate, owner's choice.
- **A7. Amend DEL-17: driver KPIs and scheduled exports.** On-time rate, proof completeness and COD variance per driver; scheduled CSV or PDF exports to named recipients. Depends on DEL-7 and DEL-12. Basis: S5, S13. Shape: adapt.
- **A8. New RES-1 (research, no build): Wasl and CST applicability.** Establish whether own-fleet motorcycle couriers need the TGA motorcycle-delivery registration, which device fields that registration carries, and whether CST's tracking-service rules reach a phone tracker run by a merchant's own drivers (ADR-0039). Output: owner questions, not code. Basis: S16, S8, S9. Role: research.

## 7. Unanswered

1. Whether the last-mile claims work in production (POD scan validation, offline sync, automatic assignment, COD workflow). No customer, review or document confirms them. Ask for a demo or trial account ("Request a demo" [S3]).
2. Pricing, contract terms and billing model. Capterra, G2 and Software Advice returned HTTP 403 [S22].
3. Named Saudi customers. "Unicoop" appears in the driver app text [S11] with no country or owner.
4. Saudi legal entity, office and support hours. The Dubai HQ rests on a G2 search summary [S21]; the FAQ gives no support hours [S5].
5. Public API and webhook specification. None found; ask Safee for a partner API document.
6. Data residency per deployment: "inside the Kingdom" [S8] against "local or offshore cloud providers" [S10]. Ask in writing before any pilot.
7. The meaning of "Logisti" in "Wasl/Logisti" [S16] and whether it is a separate provider.
8. Whether own-fleet motorcycle couriers must register under Wasl, and which device fields are sent (RES-1).
9. Whether CST's Tracking Services rules cover a phone-based tracker that a merchant's own drivers run (ADR-0039). A legal reading is needed.
10. Madinati in Riyadh: Safee says the municipality must confirm [S9]. Our Riyadh delivery need is not in the sources.
11. Stack and hiring: no posting found [S24]; the stack is unknown.
12. Android availability of the driver app: no Google Play listing was found in search [S23].
13. The store privacy label conflict in §4 [S11]. Confirm before we set our own labels (OPS-3).
14. What data the Amin AI queries read and whether any leaves the account; the vendor says it "never expose[s] your data to external party" [S18].
15. The "over 200,000 active vehicles" and "0 +" counters on the home page [S2]: unverified.

## 8. Source registry

All read on 2026-11-02. "Date" is the publisher's date where the page shows one.

| ID | URL | Date shown | Read |
|---|---|---|---|
| S1 | https://safee.com/ | undated | [F] home, English |
| S2 | https://safee.com/ar/ | undated | [F] home, Arabic |
| S3 | https://safee.com/en/ | undated; footer © 2026 | [F] links, login realm, contact |
| S4 | https://safee.com/added-value-modules/last-mile-delivery/ | © 2026 | [F] last-mile module |
| S5 | https://safee.com/frequently-asked-questions/ | undated; © 2026 | [F] FAQ |
| S6 | https://safee.com/added-value-modules/journey-management-system/ | undated | [F] JMS module |
| S7 | https://safee.com/added-value-modules/mobile-app/ | undated | [F] mobile app |
| S8 | https://safee.com/safees-cst-approval/ | 2 Nov 2026, as extracted | [F] CST article |
| S9 | https://safee.com/saudi-wasl-madinati-municipality-comparison/ | 19 Oct 2026, as extracted | [F] Wasl and Madinati |
| S10 | https://safee.com/privacy-policy-and-end-user-license-agreement-eula-of-safee-platform/ | undated; © 2026 | [F] privacy and EULA |
| S11 | https://apps.apple.com/us/app/id6749274304 | versions 1.0 (19 Aug 2025) to 1.1.7 (Jul 8, year not shown) | [F] Safee Driver, iOS |
| S12 | https://apps.apple.com/us/app/id1436128272 | v5.0.18, Oct 22 (year not shown) | [F] Safee Tracking, iOS; 2 ratings, 3.0 |
| S13 | https://docs.safee.com/guides/6-10-6/ | 22 Oct 2026 | [F] release 6.10.6 and version sidebar |
| S14 | https://docs.safee.com/guides/6-10-2/ | 27 Aug 2026 | [F] assignment gap |
| S15 | https://docs.safee.com/guides/6-9-9/ | 25 Jun 2026 | [F] dynamic reassignment |
| S16 | https://docs.safee.com/guides/6-9-0/ | 17 Mar 2026 | [F] Wasl and Logisti |
| S17 | https://docs.safee.com/guides/6-10-1/ | 13 Aug 2026 | [F] driver groups |
| S18 | https://docs.safee.com/guides/6-10-0/ | 6 Aug 2026 | [F] Amin AI |
| S19 | https://docs.safee.com/guides/6-5-12/ | 11 Jul 2024 | [F] maintenance |
| S20 | https://docs.safee.com/ | undated; https://docs.safee.com/guides/ returned HTTP 404 | [F] welcome page; [F] 404 |
| S21 | https://www.g2.com/sellers/safee-fleet-management | undated | [S] search summary: Dubai, founded 2022 |
| S22 | https://www.g2.com/products/safee/reviews; https://www.capterra.com/p/247875/Safee/; https://www.softwareadvice.com.au/software/502382/Safee | undated | HTTP 403; not read |
| S23 | https://apps.apple.com/hu/app/safee-driver/id6749274304; Google Play search for "Safee Driver" | undated | [S] same app; no Google Play listing found in search, page not opened |
| S24 | Job-search summary (Safee Technology postings, stack) | undated | [S] no Safee posting found |
| S25 | `docs/research/ksa-platform-census-2026-11.md` on `origin/docs/ksa-platform-census` (Safee row, shortlist a) | 2026-11-02 | [F] census, read on the branch |
| S26 | Our documents at `origin/main` 1e0c184: `adr/0001`, `0002`, `0006`, `0007`, `0008`, `0009`, `0010`, `0011`, `0016`, `0017`, `0018`, `0022`, `0025`, `0028`, `0030`, `0034`, `0037`, `0039`, `0040`, `0041`; `docs/roadmap.md` §1.2 to §1.5, §6; `docs/architecture/domain-model.md` (Proof row); `AGENTS.md` (own fleets only; allowlist) | as on main | [F] |

Notes on S21 and S22: the G2 product page, Capterra and Software Advice returned HTTP 403, so the review and rating picture is missing. The Safee Tracking listing (S12) has two ratings only.
