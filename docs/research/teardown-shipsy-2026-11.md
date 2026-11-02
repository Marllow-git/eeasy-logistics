# Shipsy teardown, 2026-11

Date: 2026-11-02. Branch `docs/teardown-shipsy` from `origin/main` at `1e0c184`. Author: researcher agent for the lead.
Basis read: census row for Shipsy (`docs/research/ksa-platform-census-2026-11.md`, branch `origin/docs/ksa-platform-census`); ShipHero teardown section shapes (`origin/docs/shiphero-teardown`, not repeated); `docs/roadmap.md` §1.2 to §1.5; `adr/0001`, `0002`, `0005`, `0007`, `0008`, `0010`, `0011`, `0014`, `0017`, `0018`, `0021`, `0022`, `0023`, `0025`, `0037`, `0039`, `0040`, `0041`; `docs/architecture/domain-model.md` §2.3, §2.5, §3.8, §3.10, §3.11, §4.2, §4.15; `docs/architecture/integrations.md`.

Grades: **[F]** page fetched and read on 2026-11-02; **[S]** search-result summary or third-party page only; **(inferred)** my reading, not a source statement. Every fact cites a registry ID in section 8, and each registry entry gives the URL and the date read (2026-11-02 for all). Publication dates are given where the source shows one.

Limits: no logged-in access; Shipsy's Atlassian help pages and the Gartner and G2 pages were not readable in full; no product trial; no sales call. Shipsy's own last-mile page returned HTTP 404 (A2), so last-mile claims rest on the homepage (A1), the courier page (A4) and search summaries (S0).

## 1. Summary for the lead

1. Shipsy is a SaaS company with a Gurugram office listed on its trust page (A7), for last-mile dispatch, middle-mile hubs and linehaul, WMS, TMS and AI "agents". Its homepage claims 150+ enterprises in 30+ countries and a 2026 Gartner TMS niche placement (A1, vendor claims).
2. Its KSA footprint is thin and mostly dated 2023: a Monsha'at MoU signed March 2023, a Riyadh regional HQ announced April 2023, and a Seamless Saudi 2023 sponsorship (A13, A10, A12). No Saudi case study is published.
3. Census corrections. (a) The census says no Riyadh presence; Shipsy's own 2023 release announces a Riyadh regional HQ (A10). (b) The MoU is dated 14 March 2023, not undated (A13). (c) The $10 million is a five-year investment "in the region"; the concession has no stated value (A11, A13). (d) "No Saudi client" is contradicted by a Zajil Express General Manager testimonial on Shipsy's courier page; Zajil is Riyadh-based per directories, but it is a testimonial, not a case study (A4, T10).
4. Borrow 1, hub network as a first-class node: scan-driven sort to cages, sort-zone routing, inscan with weight and volume checks, and hub-to-hub trips balanced by capacity, destination and SLA (A3, A4). We have no hub concept; ADR-0018 site kinds are branch, warehouse or both. This is the largest gap.
5. Borrow 2, proof gating: the Deliver action stays disabled until every proof the reason requires is present, with an OTP to the consignee and a structured reason list instead of free text (A8). Our proof kinds and attempt reason codes already exist (domain-model §3.10); the gate is the new part.
6. Borrow 3, COD from the shipment: the driver never types the amount; it is captured from the shipment and reconciled at route close (A8). Our CodCollection is insert-only and custody is a ledger (domain-model §3.11, ADR-0007); the amount rule is not yet stated in DEL-7.
7. Stronger 1: stock is an append-only ledger with database-enforced invariants (ADR-0011, WMS-3). Shipsy claims 99.9% inventory accuracy (vendor claim, A9, S0) and publishes no ledger model.
8. Stronger 2: driver cash custody is modelled as append-only entries with a PIN at handover (ADR-0007, ADR-0034, domain-model §3.11). Shipsy's public pages describe auto-captured COD and reconciliation, not a custody model (A8).
9. Stronger 3: our integrator surface is planned to be public, with Standard Webhooks signing (ADR-0040, INT-9, INT-10). Shipsy's enterprise API is private and sales-gated (A1), and its webhook page is login-gated (A14).
10. Evidence limits: no Shipsy API reference, auth scheme, webhook signing, rate limit or sandbox is public. The driver app is described by one Shipsy article (A8); no store listing was found. Pricing is unpublished.

## 2. Product map

### 2.0 Module inventory

The homepage names TMS, WMS, last-mile, route optimisation, first-mile pickup, middle-mile hubs, multi-carrier management, on-demand, international, freight procurement, invoice reconciliation, tracking, geocoding, live tracking, AgentFleet, AgentFlow and Atlas (A1). It does not name OMS, returns, a standalone COD module, analytics or a driver app; those appear in sub-pages and the knowledge base. The knowledge base lists 22 modules and 315 articles, including Hub Operations and Mid Mile (34 articles), Route Optimization (4), Mobile Application (6), Warehouse Management (11), Finance Operations (6 and 11 advanced), Rates and Contracts (6), Communication Engine (8) and Vendor and Indent Management (8) (A5).

### 2.1 Last-mile delivery

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Auto dispatch | ML-based allocation of consignments to vehicles; rule-based allocation across 3PLs by cost, speed and ratings; G2 describes assignment from customer demand | Web dispatch; API | S0; T6 |
| Multi-stop route planning | Geocoding and route optimisation; trips built from delivery priority, vehicle capacity and time windows; vendor claim of 35% less planning time | Web planner | A4 (F); T7 (S); S0 (claim) |
| Dynamic re-routing | Routes adjusted in real time under predefined rules when orders change or cancel; re-optimisation prompt to the driver is "next release", not shipped | Planner; driver app | T6 (S); A8 (F, roadmap line) |
| Driver app, task list | Linear task list, "never a map-first view"; biometric login; next task highlighted from a server-side micro-clustered route; shift ends with a handoff when all stops are done | Driver app | A8 (F) |
| Offline driver app | Every screen works without data; data encrypted on device; synced later with per-event-type merging | Driver app | A8 (F) |
| Proof of delivery | Geofence check ("within N meters of the consignee pin", N unpublished); OTP to the consignee; signature; photos mandatory for configured triggers (failure, damage, COD handover); Deliver disabled while a mandated proof is missing; barcode decoder for damaged labels | Driver app | A8 (F) |
| COD capture | Amount auto-captured from the shipment, no manual typing; tamper-evident receipt; cash reconciliation at route close by an agent named Nexa | Driver app; finance module | A8 (F); S0 (remittance and invoicing module) |
| Incident and NDR handling | Drivers pick incidents from a structured list, not free text; the list feeds an agent (Clara) that runs an NDR-rescue workflow | Driver app; agents | A8 (F); A1 (agent roles, F) |
| Calls and messages | Masked calling through a proxy, calls recorded; templated in-app messages in the consignee's preferred language | Driver app | A8 (F) |
| Driver app platforms and languages | Primary build Android; iOS build for "specific segments"; language configured per carrier; Arabic, English and Hindi listed on Capterra India | Driver app | A8 (F); T3 (S); techjockey claims Android-only, which conflicts (T11, S) |

### 2.2 Hub and middle mile (linehaul)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Scan-driven sorting | Parcels scanned at intake; audio and visual sort instructions; routed to a cage and loading group by destination and route sequence | Hub app; hub screens | A3 (F); A4 (F, hub-ops app for bagging and sorting) |
| Inscan with weight and volume | Consignment, weight and volume checked at scan-in; device integration for automatic capture (device types not named) | Hub app; devices | A4 (F); S0 (device integration) |
| Hub-to-hub trip creation | "AI-driven trip creation, vehicle loading and route planning" for land and air movements | Web (hub planner) | A3 (F); A4 (F) |
| Load balancing | Parcels distributed across vehicles by capacity, destination and SLA | Web | A3 (F) |
| Linehaul tracking and delay | Real-time tracking with predictive ETAs; CT Agent detects delays, alerts destination hubs, adjusts downstream sequences and notifies customers | Control tower | A3 (F) |
| Hub set-up | "Active and Disabled Hub setup" help article; hub and rider master data | Web admin | A5 (F, article titles) |
| Outcome claims | 40% hub processing time, 99% sort accuracy, 30% linehaul cost, 2 hours faster hub-to-hub; Teleport: 164 hubs visible in real time; all vendor or customer claims, not verified | Marketing | A3 (F, vendor claims) |

### 2.3 First mile, pickup and returns

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Pickup allocation | Pickups "allocated automatically to hubs and drivers"; scalable pickups | Web; driver app | A4 (F) |
| PUDO and partner networks | "Grow reach through PUDO points, partner and franchise networks" | Not described | A1 (F, one line) |
| Reverse pickups and returns | "Drive seamless reverse pick-ups"; ClickPost lists return webhooks and a cancellation API | API; web | A4 (F); T1 (F) |

### 2.4 Warehouse management (WMS)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Inventory controls | Cycle counting; batch and serial control; shelf-life and FEFO controls; multi-warehouse visibility; AI slotting | Web | A9 (S) |
| Operator mobile apps | Android apps for picking, putaway, cycle count, inventory moves and QC; work offline and sync when connected | Mobile | A9 (S) |
| Agents | One agent guides pick and pack on the floor; another reconciles inventory and adjusts stock | Mobile and web | A9 (S) |
| Accuracy claim | 99.9% inventory accuracy in practice (vendor claim, no independent check) | Marketing | A9 (S) |

### 2.5 Multi-carrier, TMS and out-of-scope modules

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Carrier selection and allocation | Automates carrier selection and order allocation across providers | Platform | A1 (F) |
| TMS and freight | Plan, procure, execute and track shipments; freight procurement; invoice audit and settlement; international, customs and container tracking | Platform | A1 (F) |

### 2.6 Customer experience, integrations and analytics

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Tracking and validation | Real-time tracking; non-delivery reasons validated with the customer; multi-channel communication (channels not named) | Recipient; web | A4 (F) |
| Geocoding and address | "Validate and enrich addresses to cut failed deliveries" | Platform | A1 (F) |
| Integration marketplace | "240+ integration marketplace" (homepage claim); marketplace with webhooks tab behind login | Platform | A1 (F); A15 (login) |
| Shopify app | Listed, but "currently not available in the Shopify App Store" | Shopify | A18 (F) |
| Control tower and AI | Atlas control tower; AgentFleet (Clara, Astra, Nexa, Vera); AgentFlow no-code agent builder; Iris website assistant | Web | A1 (F) |
| Analytics | "Shipsy BI, Advanced" knowledge module (one article) | Web | A5 (F) |

### 2.7 Finance and rider pay (knowledge base)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Finance operations | Remittance, bank deposit transactions and related finance modules (six and eleven advanced articles) | Web | A5 (F, titles); S0 (remittance and invoicing) |
| Rates and contracts | Six knowledge articles on rates and contracts; rider payout and incentive (one article) | Web | A5 (F, titles) |

### 2.8 Platform, security and admin

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Access control | Role-based access with field-level permissions; MFA; SAML 2.0 and OAuth 2.0 single sign-on (Azure AD, Okta, Google Workspace named) | Web | A7 (F) |
| Audit and agent logs | "Complete audit trails"; "every agent decision logged" | Web | A7 (F) |
| Certifications (claims) | SOC 2 Type II and ISO 27001 stated; GDPR-ready; EU data residency option; documents "available on request" | Trust page | A7 (F, vendor claims) |
| Encryption and uptime | AES-256 at rest; TLS 1.3 in transit; 99.9% uptime SLA | Trust page | A7 (F) |

## 3. API and integration anatomy

3.1 Public surface. The homepage says the public OpenAPI specification covers only the Iris website assistant; the enterprise API (TMS, WMS and AgentFleet) is private and sales-gated; "Live Tracking ... available via API" (A1, F). The census's "private, sales-gated" finding holds.

3.2 Where documentation lives. The developer link redirects to a knowledge base of 315 articles; its visible content has no API, authentication, webhook or rate-limit pages (A6, A5, F). The help centre returned only a page title (A17, F-partial). The Atlassian HELP space has pages titled "Consignment Webhooks", "Integration Marketplace" and "Rider Mobile Application"; the first two redirect to Atlassian login (A14, A15, F-redirect), and the third is known by title only (A16, S).

3.3 Partner view of the API (third-party documentation, not Shipsy's reference). ClickPost lists these Shipsy APIs by name: manifestation and label generation; track shipment; cancellation; EDD; NDR action update; return webhooks. It names polling and webhook tracking, but the checkmarks do not map cleanly to the columns (T1, F). ClickPost gives no endpoints, auth or status mapping.

3.4 Carrier configuration. EasyEcom registers Shipsy as a carrier with two values from the Shipsy team: a customer code (in the Username and Extra Credentials 1 fields) and an API key (in the Token field). The page gives no base URL, operations, limits or error model (T2, F).

3.5 Authentication (inferred). A static API key with a customer code, sent by the partner's carrier configuration. Whether the key is a header or body field, whether it expires, and whether it is scoped per customer are not stated in any source read.

3.6 Webhooks. A "Consignment Webhooks" page exists (title only, A14) and the marketplace names a webhooks tab; both say webhooks give real-time consignment status updates (S0). Payload, delivery method, signing, retry policy and ordering were not readable.

3.7 Not found in any public source read: rate limits, sandbox, versioning, SDKs, error model, idempotency, pagination, or the OpenAPI document for the enterprise API.

3.8 Engineering signals (weak, dated job posts). Cutshort's company page lists React.js, Node.js, AWS, Kafka, PostgreSQL and MongoDB (T8, S); a full-stack posting asks for Node.js, React.js, PostgreSQL, MongoDB and AWS (T9, S). No Shipsy posting mentions Kubernetes; the search found Java only as one language option among several (T8, S). No engineering blog was found.

## 4. Operational model

4.1 Customers and tenancy. The company names retailers, LSPs, manufacturers, carriers and 3PLs as users (A1, A4, S0). Its multi-provider portal manages several logistics providers in one place (A4, F). Public pages do not describe how tenants are isolated (not found).

4.2 Named customers. Carriers and 3PLs on the courier page: Zajil Express (General Manager testimonial), GoWithDot and DTDC (A4, F). Retail, QSR and pharmacy case studies with MENA and GCC names: Kout Food Group (GCC QSR delivery), GMG (MENA and Asia) (A1, F). The case-study figures are vendor-stated and unverified (A1, A3, A4).

4.3 Roles. Field-level permissions and MFA (A7, F). Knowledge articles include rider and hub set-up, deactivating employees and "defining constraints at multiple levels" (A5, titles only; contents not read).

4.4 Billing. Pricing is custom and sales-led (A1, F). Capterra lists a per-feature model with a free trial (T3, S). GetApp shows "starting from 49 per user per month" on one line and "No pricing info" on another, so the figure is unverified (T4, S). G2 shows no pricing (T5, S). No public rate card, per-shipment fee or COD fee was found.

4.5 Automation. Rule-based dispatch and allocation (S0, F in part); AgentFleet agents with three-tier confidence routing that escalates high-risk actions; "500+ simulated conversations tested before go-live" (A7, F; A1, F). The rules behind the agents are not published (inferred: no public rule schema).

4.6 Data handling. Data residency controls and EU storage option; data retention periods not stated; hosting regions and cloud providers not named; PDPL not mentioned (A7, F). Data processing agreements and right-to-erasure support are listed (A7, F).

4.7 Saudi footprint, dated.
- Monsha'at MoU, 14 March 2023, signed at the Biban 23 forum; $10 million over five years "in the region" for technology and R&D; a "significant concession" for customers referred by Monsha'at, with no value (A13, F; A11, F; undated page).
- Riyadh regional HQ "to aggressively onboard local talent", announced 20 April 2023; the Gulf is 35% of revenue (per that release) (A10, F).
- Seamless Saudi Arabia 2023 in Riyadh, 4 to 5 September: associate sponsor; the LIA co-pilot is shown to retailers, LSPs and manufacturers in Saudi Arabia (A12, F).
- No published Saudi case study or Saudi-hosted deployment was found. The homepage and trust page list no Saudi office; the Riyadh HQ appears only in the 2023 release (A10). Current office status is unverified (inferred from absence on A1 and A7).

4.8 Corporate. Offices listed on the trust page: Gurugram, Dubai, Amsterdam and Singapore (A7, F). Zawya's dateline is Dubai and it lists teams in India, Dubai and Indonesia (A11, F).

## 5. Mapping to eeasy-logistics

"Today" means a roadmap row or an architecture section. No Delivery or WMS feature is built yet (wave 0). Borrow values: **Yes** (take the shape), **Adapt** (take part of it, with the change named), **No** (with the reason and the ADR or source).

| Feature | Shipsy | eeasy-logistics today (id or gap) | Borrow? |
|---|---|---|---|
| Rule-based auto dispatch | Rule and ML allocation; 3PL allocation by cost, speed, rating (S0, T6) | DEL-6 manual offers (wave 1); DEL-10 rule-created offers in waves (wave 2) | Yes, shape: waves of offers (domain-model §3.8). No ML: no evidence on quality and no data yet |
| Multi-stop route planning | Priority, capacity and time windows (A4, T7) | INT-5 and INT-6 VROOM (ADR-0010); DEL-16 re-solve (wave 4) | Yes, existing. Check that time windows and priority are inputs in the INT-6 plan |
| Dynamic re-routing with driver prompt | Re-plan on change; driver accepts a re-optimisation (A8, T6) | DEL-16 "commit through offers" (wave 4) | Adapt: fits the offer path; earlier only if INT-6 lands cleanly |
| Linear task list, not map-first | Server-sequenced linear list (A8) | DRV-4 run list; DRV-7 run list in server sequence (wave 2) | Yes, already in doc 8 §5; A8 corroborates |
| Offline driver app | Offline screens; per-event merge (A8) | DRV-2 outbox with lanes and replay rules (ADR-0008) | Already ours; our replay rules are the stronger design |
| Geofence check before Deliver | Within N metres of the consignee pin (A8) | Only a parked geofence (DRV-3, ADR-0039); no arrival check at delivery | Adapt: owner decision. Needs a per-account radius, a DRV-4 amendment, and a privacy review (no PDPL source read) |
| Recipient OTP at the door | OTP to consignee completes POD (A8) | Proof kind recipient_otp (domain-model §3.10); recipient messages as WhatsApp templates (ADR-0037, ADR-0041) | Yes, already modelled; the channel is WhatsApp, not SMS |
| Proof gating per trigger | Deliver disabled until mandated proofs are present; photo for failure, damage, COD (A8) | DEL-7 proofs by upload; DRV-4 "deliver with proof queue" | Yes, shape: required proof set per reason, enforced by the server on replay (inferred that the server must enforce it) |
| Structured incident list | Drivers choose from a list; feeds NDR rescue (A8) | Attempt reason code from the account's list (domain-model §3.10); coverage reason codes (DEL-1) | Yes, existing shape; extend to exceptions (row 14) |
| Masked and recorded calls | Calls proxied and recorded (A8) | None; no telephony port in integrations.md | No, for now: recording calls is personal-data handling with no ADR, and masked calling needs a provider not on the roadmap |
| COD amount from the shipment | Auto-captured; no typed amount; tamper-evident receipt (A8) | CodCollection amount in halalas, insert-only (domain-model §3.11); PIN at replay (DEL-7, ADR-0034) | Yes: state in DEL-7 that the amount comes from the order and the driver confirms it |
| Cash reconciled at route close | Agent reconciles at route close (A8) | CashHandover and CashReport per site and business date (DEL-11, DEL-12, ADR-0007) | Yes, shape: the system computes expected cash at close; a person confirms (ADR-0007) |
| Merchant remittance and invoicing | COD remittance; automated customer invoicing (S0) | DEL-13 driver pay only; no merchant remittance or invoice row | Owner question, BIL-1 (section 6). The mechanism is not in any source |
| NDR automation and exceptions | NDR rescue agent; control-tower exception management (A8, A3) | DEL-14 reschedule and pin (wave 2); DEL-18 returns (wave 4); no exception queue; DEL-15 is internal only | Adapt: rule set DEL-19 over DEL-14 and DEL-18; no agent |
| Hub network, scan-in and sort | Scan-driven sort to cages; sort-zone routing; inscan weight and volume (A3, A4) | None. ADR-0018 site kinds are branch, warehouse or both; K-4 names no hub | Yes, shape: scan-driven sort. Needs HUB-1 and a new ADR superseding ADR-0018 K-4 (section 6). Highest priority |
| Hub-to-hub linehaul trips | Trip creation by AI; load balancing by capacity, destination and SLA; linehaul tracking (A3) | None | Yes, shape, deterministic first: bins by destination and capacity; no AI until there is data. HUB-2 |
| Delay control tower | CT Agent alerts downstream hubs and resequences (A3) | DEL-5 stale-tracking alert only; DEL-17 scorecards (wave 4) | Adapt after HUB-2 |
| Pickup allocation, first mile | Auto-allocation of pickups to hubs and drivers (A4) | Domain kind pickup_request exists (domain-model; integrations.md); no roadmap row | Adapt: needs a roadmap row (owner) |
| PUDO points | Partner and franchise drop points (A1) | None | No: a network product outside the two modules (ADR-0002) |
| Multi-carrier selection | Carrier selection and allocation across providers (A1, S0) | Carrier pricing, coverage and selection stay in Eeasy shipping (integrations.md; ADR-0001, ADR-0014); INT-8 cards behind allowlist | No: out of this product. Borrow only tracking-webhook mapping (INT-8) |
| TMS, freight procurement, invoice audit, customs | Full TMS set (A1) | Out of scope: Delivery and WMS only (ADR-0002) | No, out of scope (ADR-0002) |
| Same-day and on-demand | "Instant dispatch" for same-day and express (A1) | Slots (DEL-9) cover scheduling; no on-demand row | No for now; revisit on pilot evidence |
| Address validation and geocoding | Validate and enrich addresses (A1) | INT-2 Hudhud geocoder and National Address short code; DEL-2 geocode at intake | Yes, existing; no Shipsy KSA evidence to copy |
| Live ETA on tracking page | Live tracking and predictive ETAs via API (A1) | DEL-8 and WEB-8 tracking; per-stop ETA in INT-6; public view (D-24) | Adapt: show ETA only after INT-6; "predictive" needs data we do not have |
| Multi-channel messages | Multi-channel, channels unnamed (A4) | INT-3 WhatsApp templates (ADR-0037, ADR-0041); no SMS before wave 3 | Already ours: template-only WhatsApp |
| Warehouse operator app, offline | Android picking, putaway, count, QC; offline sync (A9) | WMS-5 and WMS-6 on the server; WEB-15 scanner-first web bench; no warehouse handheld app | Yes, shape: offline operator app. New order WH-APP; ADR-0021 covers the driver app only |
| FEFO and shelf-life | FEFO and shelf-life controls (A9) | Lot carries expiry date (domain-model §4.2); WMS-6 allocation rule does not state FEFO | Yes: amend WMS-6 (section 6) |
| Cycle counts, batch and serial | Cycle counts; batch and serial control (A9) | WMS-2 tracking mode with lots and serials; WMS-5 count sessions (domain-model §4.15) | Already planned; no change |
| Inventory accuracy claim | 99.9% in practice (A9, vendor) | ADR-0011 append-only ledger; nightly stock assertions (WMS-3) | No need to copy a claim; ours is the stronger model |
| Analytics and BI | BI Advanced module; control tower (A5, A1) | DEL-17 scorecards over reporting views (wave 4) | Adapt later |
| Public API and webhooks | Enterprise API private; webhook page login-gated (A1, A14) | INT-9 public API; INT-10 webhooks under Standard Webhooks (ADR-0040) | No to a private API: we publish. Ours is stronger for integrators |
| Integration marketplace (240+) | Marketplace claim (A1); two KB articles (A5) | INT-11 Salla and Zid only (ADR-0013); no marketplace | No for now; revisit after INT-11 |
| Shopify app | Listed but not available (A18) | None | No: no demand evidence; Salla and Zid are the KSA channels (INT-11) |
| SSO and field-level roles | SAML 2.0, OAuth 2.0, field-level RBAC (A7) | Own identity (ADR-0023), TOTP for staff (domain and identity docs); custom roles deferred (roadmap §6) | Adapt later: no SSO row; field-level roles deferred |
| Certification claims | SOC 2 Type II, ISO 27001, GDPR-ready, EU residency (A7) | Gulf-region host (ADR-0022); no certification row | No: copying certificates is not a design choice; note that Shipsy's residency option is EU, not KSA |
| AI agents with confidence tiers | Three-tier routing; simulation before go-live; decisions logged (A7, A1) | No agent in roadmap; AuditLog (domain-model §2.5) | No for now: no ADR or order. Keep the audit log, which we have |
| Rates and contracts | Six KB articles (A5) | None | Owner question, BIL-1 |

## 6. Proposed order amendments and new orders

At most eight. Hubs and linehaul first. Each needs an owner ruling before a plan; none is drafted here.

1. **HUB-1 (new, wave 4 "Network", owner ruling first).** Hub as a site kind, with inscan and outscan, sort cages and scan-driven sort. Needs a new ADR superseding ADR-0018 K-4, since K-4 names only branch, warehouse or both. Depends on DEL-2 and DEL-6. Shape: A3 and A4 (scan-driven sort, cage routing).
2. **HUB-2 (new, wave 4).** Hub-to-hub trips: manifest and load balancing by capacity, destination and SLA; deterministic first version. Depends on HUB-1, DEL-5 for vehicle position and INT-6 for sequencing. No AI trip creation.
3. **DRV-4 amendment (wave 1).** Proof gating per reason: the Deliver action is server-validated against a required-proof set per reason; optional arrival check within an account-set radius, computed at the event and not stored as a trail. Owner decision: location in the delivery path, and ADR-0039 and ADR-0028 wording. Source: A8.
4. **DEL-7 amendment (wave 1).** COD amount comes from the order; the driver confirms rather than types it. Source: A8; domain-model §3.11.
5. **DEL-19 (new, owner chooses wave 2 end or wave 4).** NDR and exception rules: per-account reason catalogue, rules that reschedule (DEL-14), return (DEL-18) or alert, and an exception list on the dispatch board (WEB-7). Rules, not an agent. Source: A8, A3.
6. **WMS-6 amendment (wave 3).** FEFO allocation from lot expiry, with short-pick handling. Source: A9 (S); domain-model §4.2.
7. **WH-APP (new, wave 3, owner decision).** Offline warehouse operator app for picking, putaway, count and QC, on the DRV-2 outbox pattern. Needs a new ADR, since ADR-0021 covers the driver app only. Source: A9 (S).
8. **BIL-1 (owner question, not an order).** Merchant rate cards, remittance statements and invoicing. No roadmap row; the mechanism is not in any source read. Source: A5 (titles), S0.

## 7. Unanswered (owner questions)

1. Is a hub a new site kind (a new ADR superseding ADR-0018 K-4), or a separate entity? Which hub functions are in scope: inscan and outscan, sort cages, linehaul trips?
2. Should the NDR and exception rules (DEL-19) land at the end of wave 2 or in wave 4?
3. Do we want a delivery arrival check (radius, server-enforced, not stored as a trail)? It needs a privacy review; no PDPL source was read.
4. Is an offline warehouse operator app needed for the pilot? It needs a new ADR.
5. Do merchants need rate cards, remittance statements and invoices? The roadmap has no row (BIL-1).
6. Is Zajil Express a current Shipsy customer in KSA? The testimonial is the only evidence; a sales call would settle it.
7. Is the Riyadh regional HQ still open? Shipsy announced it in 2023 (A10); no current source was found.
8. The enterprise API: auth, webhook signing, rate limits and sandbox. Only a sales call or trial would show these.
9. Shipsy's price. GetApp's $49 per user is unverified; a quote is needed.
10. Shipsy's driver app: no store listing was found, so its platforms and languages rest on A8 and T3. Does the owner want a store check?
11. Pickup allocation (pickup_request) and PUDO: should a first-mile row be added to the roadmap?
12. PDPL: Shipsy's trust page does not mention PDPL (A7). Does the pilot need a PDPL statement from us before the driver app captures proofs and locations?

## 8. Source registry

All reads 2026-11-02. [F] fetched and read; [S] search-result summary or third-party page only; [F-redirect] redirected to a login page; [F-fail] fetch failed; [F-partial] only the title was returned.

**Shipsy first-party (A)**
- A1 https://shipsy.ai/ [F]. Homepage: modules, customers, geography, pricing, developer and security summary.
- A2 https://shipsy.io/last-mile-delivery-software [F-fail, HTTP 404].
- A3 https://shipsy.ai/middle-mile-hub-operations [F]. Hub, sorting, linehaul and agents.
- A4 http://shipsy.io/solutions/courier-express-parcel/ [F]. Courier, first mile, last mile, hub ops, testimonials. The https URL 301-redirects to http.
- A5 https://knowledge.shipsy.ai/ [F]. Knowledge base: 315 articles, 22 modules, article titles.
- A6 https://www.shipsy.ai/developers [F-redirect to A5].
- A7 https://shipsy.ai/data-security [F]. Security, compliance, access control, residency.
- A8 https://www.shipsy.ai/insights/driver-app-execution-design [F]. Driver app mechanics (vendor article).
- A9 https://www.shipsy.ai/warehouse-management-system [S]. WMS page, search summary only; the page was not fetched.
- A10 https://shipsy.io/news/shipsy-records-around-100-top-line-growth-opens-another-rhq-in-middle-east-to-onboard-top-regional-talent/ [F]. Release credited to MENAFN, dated 20 April 2023.
- A11 https://www.zawya.com/en/press-release/companies-news/shipsy-signs-mou-with-monshaat-qby2rd7l [F]. MoU release; page undated (footer "2026").
- A12 https://www.zawya.com/en/business/transport-and-logistics/saudi-shipsy-to-showcase-its-ai-powered-innovations-at-seamless-xk6d0zqw [F]. Seamless Saudi Arabia 2023, Riyadh, 4 to 5 September.
- A13 https://intlbm.com/2023/03/14/shipsy-and-monshaat-signs-mou-to-support-saudi-vision-2030 [F, third-party]. Dated 14 March 2023; event Biban 23.
- A14 https://shipsy.atlassian.net/wiki/spaces/HELP/pages/3646914746/Consignment+Webhooks [F-redirect, Atlassian login].
- A15 https://shipsy.atlassian.net/wiki/spaces/HELP/pages/3647013011/Integration+Marketplace [F-redirect, Atlassian login].
- A16 https://shipsy.atlassian.net/wiki/spaces/HELP/pages/3105915352/Rider+Mobile+Application [S, title only].
- A17 https://helpcentre.shipsy.io/ [F-partial, title only].
- A18 https://apps.shopify.com/shipsy?locale=de [F]. Listing: not currently available.
- A19 https://www.gccbusinessnews.com/monshaat-signs-mou-with-shipsy-to-digitize-saudis-supply-chain-logistics-industry/ [F-fail, HTTP 403].

**Search summaries (S0)**
- S0 WebSearch results on shipsy.io and shipsy.ai pages, 2026-11-02. Used for: ML allocation, rule allocation across 3PLs, 35% planning claim, device integration, COD remittance and invoicing, and the WMS claims where A9 is the page. Each use is marked (S) or S0.

**Third-party (T)**
- T1 https://www.clickpost.ai/tracking-api/shipsy [F]. ClickPost integration page: API names; polling and webhook columns.
- T2 https://support.easyecom.io/portal/en/kb/articles/integrating-shipsy-with-easyecom [F]. Carrier setup: customer code and API key.
- T3 https://www.capterra.com/p/164099/Shipsy/ and https://www.capterra.in/software/164099/shipsy [S for the search snippets; capterra.in [F-fail, HTTP 403]]. Per-feature pricing, languages (Arabic, English, Hindi), ratings.
- T4 https://www.getapp.com/transportation-logistics-software/a/shipsy-1/ [S]. "Starting from 49 per user per month" and "No pricing info" on the same listing.
- T5 https://g2.com/products/shipsy-shipsy/pricing [S]. Pricing not provided.
- T6 https://www.g2.com/products/shipsy-shipsy/features [S]. Feature list: auto dispatch, dynamic routing.
- T7 https://www.gartner.com/reviews/product/shipsy [S]. Reviewer quotes on automatic routing and rescheduling.
- T8 https://cutshort.io/company/shipsy [S]. Company technology list.
- T9 https://builtinbengaluru.in/job/software-engineer-fullstacknodejsreactjs/2974151 [S]. Job posting: Node.js, React, PostgreSQL, MongoDB, AWS.
- T10 https://www.ordertracker.com/carriers/zajil-express-company [S]. Zajil Express: Riyadh-based; directories disagree on the street address.
- T11 https://www.techjockey.com/ae/detail/shipsy [S]. Claims Android-only and web-based (conflicting).
