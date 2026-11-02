# Fulfillor teardown, 2026-11

Date: 2026-11-02. Branch `docs/teardown-fulfillor` from `origin/main` at `1e0c184`. Author: researcher agent for the lead. Site: `fulfillor.com` (census row, `docs/ksa-platform-census`, read from `origin/docs/ksa-platform-census:docs/research/ksa-platform-census-2026-11.md`).
Roadmap basis: `docs/roadmap.md` §1.4 (WMS-1 to WMS-8, INT-8, WEB-13 to WEB-15, OPS-6) and §1.5 (INT-9 to INT-12, DEL-16 to DEL-18, WMS-8, OPS-7). Decisions: `adr/`. Domain basis: `docs/architecture/domain-model.md` §3.1, §3.10 to §3.16, §4.1 to §4.15.

Grades: **[F]** page fetched on 2026-11-02 through the fetch tool, which returns a model-written summary, so quoted phrases are as the tool returned them and should be re-checked before external use. **[S]** search-result or third-party page only. **(inferred)** my reading. Source IDs (F, S) map to section 8. Fulfillor publishes no API reference, no developer docs and no app-store listing that I could reach, so the integration anatomy in section 3 is thin by necessity.

## 1. Summary for the lead

1. Fulfillor is a cloud WMS for 3PLs and multi-client warehouses, operated by NOI Technologies LLC with a Wilmington, DE address (F1). It sells on the Gulf: its homepage lists Oman, Qatar, Saudi Arabia and UAE (F1). Its KSA page is a regional landing page, not a Saudi-only product (census row corrected).
2. Who it serves in KSA: 3PLs and fulfilment centres that hold several clients' stock, with Salla, Aramex, ASYAD and Zajil couriers and COD (F2, F3, F6). No Saudi customer is named on its logo or case-study pages (F1, F7).
3. Borrow 1, lot and expiry shape: a lot record with distinct dates, FEFO or FIFO pick order, and the lot actually picked written at pick time (F11, F19). Fits WMS-2 and WMS-6 (section 6, A1).
4. Borrow 2, COD settlement shape: expected COD follows the delivery outcome, matching starts from the order not the courier statement, and each gap gets one of seven classes (F14). Fits DEL-7, DEL-12 and a new INT-13 (section 6, A3).
5. Borrow 3, intake shape: orders are checked for SKU and stock at import, and an asynchronous order-creation API queues requests (F6, Mar and Aug 2026). Fits DEL-2 and INT-11 with our outbox and idempotency keys (A4).
6. Stronger 1: stock is an append-only ledger with database-enforced invariants (ADR-0011, domain §4.4). Fulfillor's public material describes lot history but no ledger model (F11); this is inferred, not a competitor fact.
7. Stronger 2: Arabic and English are a rule with RTL, logical CSS and census (ADR-0016, WEB-1). Fulfillor offers 17 interface languages and says nothing about RTL (F5); its Arabic invoices and labels claim conflicts between pages (section 7).
8. Stronger 3: own-fleet COD custody with cash-blocked drivers and PIN-gated handovers (ADR-0007, ADR-0017, domain D-11, DEL-11). Fulfillor's driver side is a records list only, "the first step toward a Transport Management System" (F6, Sep 2026).
9. Gaps Fulfillor shows that we do not plan: a handheld warehouse app (our WMS screens are web-only), kitting and bundles, expiry alerts, scheduled count plans, inter-site transfer shipments, and tracking push-back to channels (section 5).
10. Evidence limits: marketing and changelog only, no API docs, no public pricing figures, no security page reached (section 1.1).

### 1.1 Method and limits

- Read on 2026-11-02: homepage, KSA landing page, integrations, pricing, multilingual, changelog (month-level dates, Oct 2025 to Sep 2026), case studies, comparison, blog index and 5 blog articles, WMS and billing module pages, Salla and Shopify integration pages, glossary (F1 to F19).
- Not reachable (HTTP 400, 403 or DNS): `/api`, `/3pl-wms`, `/mobile-warehouse-operations`, `/client-portal`, `/labor-management`, `/security`, `/pick-pack-ship`, `/integrations/aramex`, `/integrations/zatca`, `/ar`, `docs.fulfillor.com` (DNS failure). GetApp (.com and .com.au), SoftwareAdvice and TrustRadius returned 403.
- Searches (S2, S4) found no Fulfillor app-store listing, no Fulfillor job posts, no Salla app-store listing and no case study beyond the four summaries on F7.
- Arabic: the site has no Arabic version reached; one Arabic search returned third-party context only (S2).
- No logged-in access, so no UI, handheld or billing behaviour was seen first-hand. Module behaviour comes from module pages, the changelog and the blog.

## 2. Product map

Feature | How it works | Where it lives | Evidence
---|---|---|---
**Warehouse structure** | Inventory tracked by warehouse, zone, aisle, rack, bin, SKU, lot and serial. | Web (WMS) | F16
Locations and bins | Storage structure is whatever the operation defines. Routing rules choose a site. | Web | F16, F19
Multi-warehouse | Manages Riyadh, Jeddah, Dammam and other sites; proximity-based routing to the nearest warehouse (Oct 2025). | Web, routing engine | F2, F6
**Inbound** | | |
Receiving | Receipts recorded so stock is available downstream. Direct receiving by 2D barcode (Jan 2026); QR receiving tags replace barcodes (Jun 2026); handheld receiving made more reliable (Feb 2026). | Handheld app, web | F16, F6
ASN and partial receipt | ASN and partial receipt are glossary terms; no ASN workflow is described on a product page. | Glossary only | F19
Putaway | Listed as connected to receiving; putaway rules are described only in a blog guide. | Web, handheld | F16, F19
Purchase orders | Not described on any reached page. | (not found) | –
**Orders and channels** | | |
Order intake | Shopify orders sync on triggers such as payment status, or are controlled manually. Salla orders are pulled through "a secure API connection". Orders created from PDFs with SKU checks (Aug 2026). Inventory validated on import to reduce overselling (Mar 2026). | Integrations, API | F18, F17, F6
Order edits and cancels | Shopify edits and cancels sync in. Edits to orders already picked, packed or shipped need review. | Integrations | F18
Async order creation | Order-creation API queues requests so external systems do not wait (Aug 2026). | API | F6
Allocation and picking rules | Rules by warehouse, sales channel, order type, shipping method, inventory status and priority. | Web | F16
**Picking** | | |
Picking modes | Single and batch named on the WMS page. Bulk, single-bulk, order-level and wave picking (Dec 2025). Pickruns can be assigned to different pickers. | Handheld app, web | F16, F6
Pick-list automation | Picklists created automatically by carrier (Nov 2025). Reusable picklist templates (Jul 2026). | Web | F6
Barcode and 2D picking | Barcode scanning confirms products and locations. QR picking; audio alert on a wrong-item scan (Apr 2026). | Handheld app | F16, F6
Lot-based picking | Lots picked on the handheld (Jul 2026). Lot substitution recorded before shipment confirmation (recommended practice). | Handheld app | F6, F11
Pre-assembled kit picking | Handheld picking of pre-assembled kits with component consumption recorded (Oct 2025). | Handheld app | F6
**Packing and shipping** | | |
Packing | Clearer handheld packing screen; bulk packing labels (Apr 2026). Unnecessary packing-slip and label actions removed (Mar 2026). | Handheld app | F6
Labels | Labels created during packing; bulk label printing (Sep 2026). Quick Fulfillment auto-creates shipments and packages (Jun 2026). | Web, handheld | F6
Carrier rules | Carrier and service rules applied when an order reaches shipping; shipping documents generated. | Web, carrier integrations | F16
Cartonization | Glossary term; no product description of the algorithm. | Glossary only | F19
**Counts, adjustments, lots and expiry** | | |
Cycle counts | Scheduled or on-demand cycle counts across clients, warehouses and locations. Blind counts "where supported". Count plans by ABC class or handling frequency described in the blog. | Web | F16, F12
Lots and serials | Lot record: owner, SKU, supplier, dates kept as distinct fields, stock position, history, dispatch link. Lot and serial tracking adapts to warehouse capture settings (Jan 2026). | Web, handheld | F11, F6
FEFO and FIFO | Defined in the glossary; the blog says they can produce different pick sequences. The product page does not say which rule the product applies. | Glossary, blog | F11, F19
Expiry | "Batch, lot, and expiry tracking from receiving through dispatch" (the blog's claim). Configurable email alerts for lot-controlled stock nearing expiry (Oct 2025). | Web, email | F11, F6
Low-stock thresholds | Facility-level low-stock thresholds (Jul 2026); in-app alerts for new orders, ASNs, low stock and returns (Sep 2026). | Web | F6
**Kitting and bundles** | | |
Kitting | Shopify bundles import with component SKU relationships intact (Jul 2026). Production-run search separates pre-assembled from on-the-fly kits (Apr 2026). Kit billing at $0.85 per kit in a sample rate card. | Web, handheld | F6, F15
**Returns** | Returns Management is a module (F1). Return inspection billed per item in a sample card (F13, F15). Restock and disposition are not described in detail. | Web | F1, F13, F15
**Pallet and carton** | Pallet and carton management is a module; storage billed by pallet, bin, carton or time period. | Web | F1, F15
**Transfers and multi-site** | Transfer Shipment workflow for inter-warehouse moves (Jan 2026). Transfer inventory between facilities (FAQ). | Web | F6, F16
**Mobile (handheld) app** | Redesigned handheld app with receiving, barcode and 2D scanning for picking, receiving and packing (Dec 2025). Branding (logo and colours) on web and handheld apps (Sep 2026). Platform (Android, iOS) not stated on any reached page; one listing names iPhone and iPad (search summary, S2). | Handheld app | F6, S2
**Labor** | Supervisors review open work and assign tasks; labour module exists. Productivity metrics not described. | Web | F16, F1
**COD** | Tracks COD orders, delivery statuses, failed attempts and reattempts. Courier settlement matching described in a blog guide, not as a product feature. | Web | F1, F14
**Client portal** | "Visibility into their activity and charges" for clients. Invoice download not stated. | Web | F15
**Billing (3PL)** | Client-specific rate cards: receiving, storage, pick and pack, returns, kitting, base fee; rates "apply automatically" to billable activity; invoice-ready reports by client, date range, service type and billing category. Storage by location, pallet, bin, carton or time. Invoices prepared by the team after review. Storage charges added to client invoices automatically (May 2026). | Web | F15, F6, F13
**Accounting** | QuickBooks, Xero, Sage, Zoho Books and an ERP group (NetSuite, Dynamics 365 BC, Cin7) named as integrations. Sync direction not stated. | Integrations | F3
**ZATCA e-invoicing** | Phase 2 for clearance (B2B) and reporting (B2C), QR and hash chaining, sandbox-certified; production onboarding per tenant (Aug 2026). The KSA page says it is "subject to configuration". | Web, integration | F6, F2, S3
**Roles and accounts** | Role-based permission to enable or disable accounts (Feb 2026); password-expiry warnings (Jul 2026). Client-level permissions for reporting (F8). | Web | F6, F8
**Reporting** | Global dashboard across organisations (Jan 2026); dashboard views for orders, inventory, shipments, returns, warehouse and reports. | Web | F6, F1
**Languages** | 17 named languages plus "all other"; Arabic UI for inventory, orders and reporting; "all languages use the same workflows" (F5). No RTL statement. | Web, handheld | F5

## 3. API and integration anatomy

3.1 Public API. None found. No developer or API reference page, and `docs.fulfillor.com` does not resolve (section 8). The changelog names an asynchronous order-creation API (Aug 2026) and a faster Order Details API (Apr 2026) (F6). The integrations page offers "Custom API integrations" for "custom systems, internal tools, ERPs, carriers, and proprietary ecommerce platforms" (F3). Authentication, rate limits, versioning and sandbox: not stated. (Unanswered 1.)

3.2 Webhooks. None found in the changelog or on the integrations pages (F3, F6). Shopify and Salla sync are described as automatic, not as webhook subscriptions, and the trigger is not stated (F17, F18). (Unanswered 2.)

3.3 Channel sync model, as stated:
- Shopify: orders in; inventory, fulfilment and tracking out; edits and cancellations in; each store kept separate so several stores can share a warehouse without stock overlap (F18).
- Salla: orders in "automatically" through "a secure API connection"; inventory "sync back automatically" "in real time"; tracking numbers and shipment confirmations out after dispatch; COD and prepaid orders processed "with full tracking synchronization" (F17). The page does not say how COD payment is recorded.
- WooCommerce, BigCommerce, Magento, Squarespace, OpenCart, PrestaShop, Pancake POS: generic order, inventory and fulfilment sync (F3, F6). Pancake tracking and return-status sync (Jun 2026).
- Marketplaces: Amazon, Walmart, eBay, Noon, Temu, Lazada, Shopee, TikTok Shop, AliExpress, Etsy, OnBuy, Rithum DSCO. Noon is "order and inventory" only (F3). Zid is not named on any reached page (F3, F17).
- Connector count: the integrations page lists 52 (F3); the homepage and WMS page say "150+" (F1, F16). Unresolved.

3.4 Carrier model, as stated: create shipments, generate labels and manage tracking for each carrier. Named: Aramex (most detail, F3), ASYAD Shipping, SPX Express, DHL, UPS, FedEx, USPS, Australia Post, Delhivery, Emirates Post, DPD, Canada Post, Royal Mail, iMile, Zajel, Porter, J&T Express, Ninja Van, Xpressbees, VROMO, Deliverect, ShipStation, Shippo (F3). Zajil Express "is live" (Apr 2026), Asyad Express for Oman (Jul 2026), GLS (Dec 2025), and Porter service catalogue (Aug 2026) (F6). SPL is named on F2 but not on F3 or F6 (section 7).

3.5 Cadence (changelog, F6): 11 of the 12 monthly releases from Oct 2025 to Sep 2026 carry a carrier or channel item; January 2026 has none. Carrier and channel coverage is a steady product line.

3.6 Flow patterns the sources show:
- Order arrives from channel, is checked for SKU and stock, is held if payment status says so, and is picked, packed, labelled and shipped; tracking goes back to the channel (F17, F18, F6).
- COD: the WMS keeps payment method and expected COD per order; expected collection follows the delivery outcome; differences go to classes (F14).
- Inter-warehouse: a transfer shipment moves stock between sites (F6).

## 4. Operational model

4.1 Tenancy and multi-client. One WMS holds many clients (3PL) with "client stock, orders, permissions, and reporting separated" (F1). Client-level permissions, reporting and workflows are "configurable per account" (F8). Client-specific rate cards "keep those agreed prices connected to the account" (F15). Global dashboard across organisations (Jan 2026, F6). Each Shopify store is separate (F18).

4.2 Roles. Role-based permissions for enabling and disabling accounts (F6). Supervisors review open work; managers adjust daily work (F16). Client users see activity and charges in the client portal (F15). No role matrix is published.

4.3 Billing. Activity-based with a monthly minimum. Sample card on F15 (Northbeam Apparel, a sample not a price list): receiving $1.50 per carton; storage $15.00 per pallet per month; pick and pack $1.65 per order; returns $3.00 per return; kitting $0.85 per kit; $750 monthly base fee. The activity-billing blog (F13) uses a different sample card (Harbor Lane Goods): receiving $1.50 per carton, order handling $2 per order, additional items $0.40, kit assembly $0.80, return inspection $3 per item, $2,500 monthly minimum, and the minimum adds only the shortfall. Those sample numbers come from vendor content; they are not Fulfillor's published list.

4.4 Automation. Picking rules (F16); proximity-based warehouse selection (F6, Oct 2025); automatic picklists by carrier (F6, Nov 2025); automatic storage charges to client invoices (F6, May 2026); Quick Fulfillment auto-creates shipments and packages (F6, Jun 2026); inventory validation on import (F6, Mar 2026). No rule-engine UI is described.

4.5 Pricing and commercial. No prices on the pricing page; three plans (Multichannel WMS, 3PL WMS, Custom WMS); pricing "based on usage, workflows, and complexity"; factors are order volume, users, sites, clients, integrations and billing workflows; "50% off your first two months" promotion ending 30 Oct, year not stated (F4). AlternativeTo lists "from $299 per month" (S1, page updated 2025-04-23, third-party, stale). Blog figures for 3PL WMS cost are general, not Fulfillor's ("a few hundred dollars per month" to "several thousand dollars per month") (F10, dated 2026-07-09).

4.6 Customers and market. Logos: Pak Swift Hub, Merria, Avenidas, ShipGlobal.in, Aeroxone Cargo and Fulfillment Center, Entishar, C2P Group Fulfillment (F1). Case studies: Entishar ("99% Record Accuracy", dated 2026-10-07), Pak Swift Logistics (no metric), a US 3PL (no metric), Aeroxone (5,000 to 10,000 monthly orders) (F7). Recognised by GoodFirms and SoftwareSuggest (F1). Countries: Oman, Qatar, Saudi Arabia, UAE (F1); "100+ 3PL and fulfilment clients, 80+ retail brands" (F16, self-reported).

4.7 Regions and compliance. Saudi-specific claims: ZATCA (F6, F2), SAR as billing currency not stated, COD for Saudi and GCC (F3), Riyadh, Jeddah, Dammam sites (F2). No SAR price list. No PDPL or data-residency statement reached (the security page was unreachable).

4.8 Team and stack hints. No job posts or engineering pages found (S2). Cloud-based SaaS (F1, S1). AI features named: a chatbot (Dec 2025), AI insights back end (Feb 2026), AI-powered workflows and analytics claims (F1). Nothing else is inferred.

## 5. Mapping to our roadmap and domain model

Borrow? values: **yes** (take the shape), **adapt** (take the idea with changes), **no** (reason given, with ADR), **already** (we have it or it is planned). Order ids are from `docs/roadmap.md`. "Gap" means no order and no domain row.

No. | Feature | Fulfillor | eeasy-logistics today (order id or gap) | Borrow?
---|---|---|---|---
1 | Multi-client 3PL (client stock, permissions, reporting) | Core product (F1, F8) | Gap. One account is one merchant (ADR-0002); sites are not clients (ADR-0018) | no under ADR-0002; a scope question for the owner (section 7, Q1)
2 | Multi-site routing rules | Rules by warehouse, channel, order type, shipping method, priority; proximity routing (F16, F6) | Gap. Allocation is per site over pickable locations (domain §4.10); no cross-site rule row | adapt, after Q1 (proposal A6)
3 | Inter-warehouse transfer shipment | Transfer Shipment workflow (Jan 2026, F6) | Gap. Tote transfer only inside a site (W-2); no transfer document | adapt (proposal A6)
4 | Receiving: ASN, PO, partial receipt, QR tags | ASN and partial receipt glossary terms; 2D and QR receiving (F19, F6) | WMS-4 has POs, receipts, over-receipt approval (domain §4.11); no ASN row | yes: ASN as an input to WMS-4; 2D and QR capture via WMS-9 (proposal A4)
5 | Putaway rules | Guide only (F19); "connected" to receiving (F16) | WMS-4 deliverable "put-away" (domain §4.11 put_away state); no rule list | adapt later; no new order now
6 | Picking modes: single, batch, wave, pickrun | Batch and single on product page; bulk, wave, pickrun on changelog (F16, F6) | WMS-6 pick tasks; PickTask may be "a wave of them" (domain §4.6) | yes for picker assignment (PickTask has a picker field, §4.6); adapt for batch and wave, as the ShipHero teardown already says
7 | Lot record, FEFO, lot recorded at pick | Lot record fields and FEFO defined (F11, F19); lot picked on handheld (F6) | WMS-2 lot with expiry date (§4.2); no FEFO rule in allocation (§4.10); lot captured at pick (W-9 line) | yes, adapt: FEFO or FIFO rule in WMS-6 (proposal A1)
8 | Expiry alerts | Email alerts for lot-controlled stock nearing expiry (Oct 2025, F6) | Gap | adapt: alert in WMS-6 or WMS-2 plan (proposal A1)
9 | Serial tracking | Lot and serial (F16) | WMS-2 tracking_mode serial (§4.2), W-4 | already
10 | Cycle counts and blind count | Scheduled and on-demand counts; blind where supported (F16, F12) | WMS-5 count session with blind flag and approver (§4.15, W-16) | already for the session; gap for scheduled count plans (proposal A2)
11 | Kitting and bundles | Pre-assembled and on-the-fly kits; Shopify bundles with component SKUs (F6, F19) | Gap. is_consumable flag only (§4.2) | no for wave 3 (BOM work is not in the roadmap); revisit as proposal A8
12 | Cartonization, pallet and carton | Glossary term; pallet and carton module (F19, F1) | Partial. Packages (WMS-7, §4.14) with weight and dimensions; no cartonization | adapt later; no new order now
13 | Labels at pack, bulk label print | Labels at packing; bulk print (Sep 2026, F6) | WMS-7 labels at pack with measured weight (ADR-0014, W-10) | already; bulk print goes into WMS-7 plan review
14 | Handheld warehouse app, scanning, audio alerts | Redesigned handheld app; 2D scanning; audio on wrong scan (F6) | Gap. WEB-13 to WEB-15 are web screens; DRV-* is the driver app only (ADR-0004) | yes: proposal A4 (WMS-9), owner decides the app form
15 | Order intake: SKU and stock check at import | Inventory validation at import (Mar 2026); SKU checks on PDF import (Aug 2026) (F6) | DEL-2 intake and INT-11 Salla and Zid intake; no availability check at intake in the roadmap | yes, adapt: proposal A3 (INT-11)
16 | Async order-creation API | Queued order creation (Aug 2026, F6) | DEL-3 returns 202 for CSV import; INT-9 public API (no order-create shape yet); ADR-0029 cursor pagination | yes, shape only: a 202 queue for channel and API creates (proposal A3 covers the intake part)
17 | Inventory push to channels | Automatic, in real time (F17, F18) | INT-12 and ADR-0013 (one-way stock publish through an outbox) | already
18 | Tracking and shipment push-back to channels | Tracking and shipment confirmation after dispatch (F17, F18) | Gap. INT-11 covers intake and reconcile; INT-12 and ADR-0013 name stock only | yes: proposal A3; ADR-0013 needs a ruling or a new ADR because it names stock only
19 | Channel order edits and cancels | Synced in; edits after pick need review (F18) | DEL-2 cancel and transitions (§3.13); WMS cancelled state (§4.12); INT-11 reconcile | adapt: test in INT-11 (no new order)
20 | Carrier list and shipment, label and tracking | Many carriers (F3); Aramex deepest (F3) | INT-8 one Eeasy shipping API behind `CarrierShipments` (ADR-0014) | already (one port, not per-carrier adapters); the carrier list is a market-fit input for Q-29
21 | Carrier COD settlement reconciliation | Expected COD follows the delivery outcome; seven difference classes; matching from the order (F14) | DEL-7 COD collections; DEL-11, DEL-12 cash handovers and deposits (ADR-0007); courier-side settlement not in the roadmap | yes: proposal A5 (INT-13)
22 | Driver app and own-fleet dispatch | Driver and vehicle records only, Sep 2026 (F6) | DEL-4 to DEL-6, DRV-1 to DRV-5; ADR-0005 own fleets; ADR-0007 COD custody | already, and stronger: offers, shifts, COD custody and cash blocks (domain D-11)
23 | COD at the door (collection and custody) | COD tracked, not custody-controlled (F1, F14) | DEL-7 CodCollection, custody states (§3.11, §3.16); ADR-0017 tap-to-phone | already, stronger on custody
24 | ZATCA e-invoicing | Phase 2 clearance and reporting, sandbox-certified, production per tenant (F6, F2) | Gap. No e-invoice row or ADR. Official waves not read (S3 gives no wave dates) | no build now; research order OPS-8 (proposal A7); owner question Q4
25 | 3PL billing: rate cards, activity charges, storage, minimums | Rate cards by client, storage by pallet, bin, carton or time, minimum charge (F15, F13) | Gap | no under ADR-0002 (Q1); keep the shape for a later ADR if Q1 changes
26 | Client portal (activity and charges) | Client portal (F15) | Gap | no, dependent on row 1
27 | Merchant alerts: new orders, low stock, returns, import failures | In-app and email (F6, Sep 2026; Oct 2025) | PLAT-14 is ops alerts only; WhatsApp and messaging (INT-3, ADR-0037, ADR-0041) cover recipients, not merchant stock alerts | adapt: low-stock threshold per site in WMS-3 plan review; no new order
28 | Labour management and productivity | Labour module; supervisor task review (F1, F16) | Gap | no now; revisit after WEB-15 pilot data
29 | Reporting and dashboards | Dashboards across orders, inventory, shipments, returns (F1, F6) | DEL-17 SLA and scorecards; reporting views (data §); WEB-18 | already partly; adapt later
30 | Roles and account control | Enable and disable by role, password expiry warnings (F6) | PLAT-10 roles with `x-permission`; PLAT-11 Argon2id with breached check; ADR-0025 | already
31 | Languages and RTL | 17 languages; Arabic UI; no RTL statement (F5) | ADR-0016; WEB-1 RTL and census; DRV-1 `ar` default | already, and stronger
32 | Public API, webhooks, docs | No public API docs or webhooks found (F3, F6) | INT-9, INT-10 (ADR-0040 Standard Webhooks), OPS-7 docs | already (design only; nothing shipped yet)
33 | Accounting connectors (QuickBooks, Xero, Zoho) | Named; direction not stated (F3) | Gap. Cash reports (DEL-12) are the only finance output | no now; revisit when finance asks

## 6. Proposed order amendments and new orders

Eight items at most. Each one names the order it touches or the new id. Waves follow `docs/roadmap.md` §1.4 and §1.5. None is a decision change; items that would change an ADR say so.

- **A1. Amend WMS-6 (and WMS-2): lot-aware picking.** Add a per-account FEFO or FIFO setting used by allocation (domain §4.10), capture the lot actually picked in the pick line (W-9), and an expiry alert at a set number of days. Evidence F11, F19, F6 (Oct 2025 expiry emails). Depends on WMS-2 and WMS-3. Adversary: yes (stock ledger path). Owner question: default rule.
- **A2. Amend WMS-5: scheduled count plans.** Count plans by handling frequency or value class, a tolerance kept separate from exact matches in reporting, and approval rules by quantity or value. Evidence F12, F16. The session model (§4.15) already has blind count and approver. Adversary: yes.
- **A3. Amend INT-11 and INT-12: intake checks and tracking push-back.** At intake, check SKU and available quantity and route failures to a review state (F6 Mar and Aug 2026, F18). Add a tracking and shipment-confirmation publication after dispatch (F17, F18). This is a new outbound kind beside stock; ADR-0013 names stock only, so it needs a ruling or an ADR that supersedes it, not a silent edit. Adversary: yes (channel credentials).
- **A4. New WMS-9: warehouse handheld app (wave 3).** A handheld flow for receiving, putaway, pick, pack and count, with 2D and QR capture, audio on a wrong scan, and offline outbox (ADR-0008 pattern from DRV-2). Evidence F6 (Dec 2025, Feb, Apr, Jun 2026). Depends on WMS-3, WMS-6, WMS-7. Owner decides the form: a fifth app, or web on a handheld. Adversary: yes (stock writes).
- **A5. New INT-13: carrier COD settlement reconciliation (wave 4).** Expected COD per order follows the delivery outcome; match courier settlements from the order, not the statement; classify each gap (pending settlement, overdue remittance, amount mismatch, unmatched payment, delivery exception, valid deduction, client allocation error) (F14). Depends on DEL-7, DEL-12, INT-8. Adversary: yes (cash). Uses the cash ledger rules of ADR-0007; no new custody model.
- **A6. New WMS-10: inter-site transfers and rule routing (wave 4).** Transfer shipment as a document with its own movements, and an ordered first-match rule list for site choice (shape: teardown row 1, F16). Blocked until Q1 (multi-site is in scope) and Q5 (site count per account) are answered. Adversary: yes.
- **A7. New OPS-8: ZATCA e-invoicing research (research role, before any billing decision).** Official roll-out waves, the EGS and CSID requirement, and whether our merchants are in scope. S3 (official) lists Phase 2 from 2023 "in waves" but gives no wave table. Output is a research note, not a build. Blocks any invoice work.
- **A8. New WMS-11: kitting (deferred, not proposed for a wave).** Bill of materials for kits and bundles, pre-assembled versus on-the-fly production runs (F6, F19). Listed so the lead can decline it on purpose. Adversary: yes (stock consumption).

## 7. Unanswered (owner questions)

Q1. Is a multi-client 3PL in scope? ADR-0002 says one merchant owns its drivers and stock. Fulfillor's whole product is multi-client (F1, F8). If yes, that changes ADR-0002, the tenancy model (ADR-0025) and the billing rows 25 to 26. Owner decision and an ADR, not a research answer.
Q2. Warehouse handheld: a fifth app, or web on a handheld? Fulfillor ships a handheld app (F6). ADR-0004 and DRV-* cover drivers only.
Q3. Tracking push-back to Salla and Zid: does the owner accept a new outbound kind beside stock (A3), with an ADR for it?
Q4. ZATCA e-invoicing: are our merchants in scope, and which wave? Fulfillor says Phase 2 is sandbox-certified (F6); the official wave table was not read (S3). Blocks row 24.
Q5. How many sites does one account run in the target market? Sets whether A6 is needed before wave 4.
Q6. Fulfillor's COD: do they record courier-side settlement and matching in the product, or only describe it (F14)? Not settled by the sources.
Q7. SAR pricing and the plan limits. Only "from $299 per month" from a 2025 third-party page (S1). Needed for any market-fit comparison; a sales call or trial is the only route.
Q8. Fulfillor's SPL and Zajil. F2 names SPL as supported; F3 and F6 name Zajil Express and no SPL. Is SPL a different carrier or the same company under another name? Not settled.
Q9. Integration count: 52 listed (F3) against "150+" (F1, F16). Which is current?
Q10. Arabic invoices and labels: F2 says "Support Arabic labels and invoice-related documents"; F5 says nothing about invoices or labels. Which is true for the product today?
Q11. Public API: does a key-based API with docs exist for partners? Only the changelog names an order API (F6). Needs a demo or a partner contact.
Q12. Security: no page reached (`/security` was unreachable). Certifications, data residency and PDPL position are unknown.
Q13. Handheld platforms and offline behaviour: which devices, whether it works offline, and whether it has a native scanner SDK. One listing says iPhone and iPad (search summary, S2); the changelog says nothing about platform.
Q14. Salla: is the Fulfillor Salla app public on the Salla store or private to Fulfillor partners? Salla's partner app types are documented (docs.salla.dev, S2), but no listing was found.
Q15. Customer evidence: the case studies name no Saudi customer and no order volume beyond Aeroxone (F7). Ask for KSA references.

## 8. Source registry

All reads on 2026-11-02 unless stated. [F] fetched by the fetch tool (summary text returned by a model; quotes as returned). [S] search result or third-party page. "Unreachable" means the fetch returned HTTP 400, 403 or a DNS failure.

ID | URL | Type | Used for
---|---|---|---
F1 | https://fulfillor.com | F | Modules, regions, integrations, clients, plans, ops, legal entity
F2 | https://fulfillor.com/fulfillment/saudi-arabia | F | Saudi claims, Riyadh, Jeddah, Dammam, ZATCA "subject to configuration", SPL
F3 | https://fulfillor.com/integrations | F | 52 integrations, carriers, accounting, ERP, custom API wording
F4 | https://fulfillor.com/pricing | F | Plans, no prices, promotion, pricing factors
F5 | https://fulfillor.com/multilingual-support | F | 17 languages, Arabic scope, no RTL
F6 | https://fulfillor.com/help/changelog | F | Release items Sep 2025 to Sep 2026 (month-level dates)
F7 | https://fulfillor.com/case-studies | F | Four case-study summaries
F8 | https://fulfillor.com/compare/fulfillor-vs-3pl-wms | F | Competitor comparison, client-level permissions
F9 | https://fulfillor.com/blog | F | Blog index with dates (latest 2026-11-02)
F10 | https://fulfillor.com/3pl-software-pricing | F | General WMS cost ranges (no Fulfillor figures), dated 2026-07-09
F11 | https://fulfillor.com/warehouse-lot-tracking | F | Lot record fields, FEFO and FIFO, capture points
F12 | https://fulfillor.com/warehouse-cycle-counting-guide | F | Count methods, ABC, blind count
F13 | https://fulfillor.com/3pl-activity-based-billing | F | Activity billing shape, sample card (vendor sample)
F14 | https://fulfillor.com/cod-reconciliation-middle-east-3pl | F | COD reconciliation chain and difference classes
F15 | https://fulfillor.com/3pl-billing-software | F | Rate cards, storage bases, sample Northbeam card, client portal
F16 | https://fulfillor.com/warehouse-management-software | F | WMS capabilities summary, picking rules, counts, numbers
F17 | https://fulfillor.com/integrations/salla | F | Salla sync directions and gaps
F18 | https://fulfillor.com/integrations/shopify | F | Shopify sync directions, store separation
F19 | https://fulfillor.com/glossary | F | Terms list (kitting, FEFO, cartonization, slotting)
S1 | https://alternativeto.net/software/fulfillor/about | F, third-party (page updated 2025-04-23) | "from $299 per month", platform hints
S2 | Search results, 2026-11-02, queries on Fulfillor app stores, handheld apps, API, jobs, NOI Technologies, Salla app | S | Negative search results (no listing, no job, no API); Arabic query
S3 | https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/Roll-out-phases.aspx | F, official | Phase 1 date 2021-12-04; Phase 2 from 2023-01-01 in waves, six months' notice
S4 | Search results, 2026-11-02, ZATCA sandbox and onboarding | S, third-party | Sandbox and onboarding context only; not official
Census | `origin/docs/ksa-platform-census:docs/research/ksa-platform-census-2026-11.md`, Fulfillor row | repository | Starting row; corrections in section 1 and Q10
Repo | `docs/roadmap.md` §1.4, §1.5, §0; `docs/architecture/domain-model.md` §3.1, §3.10 to §3.16, §4.1 to §4.15; `docs/architecture/data.md`; `adr/0002, 0004, 0005, 0007, 0008, 0011, 0013, 0014, 0016, 0017, 0018, 0025, 0029, 0037, 0040, 0041` | repository | Our side of section 5
Teardown | `origin/docs/shiphero-teardown:docs/research/shiphero-teardown-2026-11.md` §5 rows 1 and 5 | repository | Shape reference for multi-site rules and wave batching only

Unreachable during this pass (not read): `https://fulfillor.com/api`, `/3pl-wms`, `/mobile-warehouse-operations`, `/client-portal`, `/labor-management`, `/security`, `/pick-pack-ship`, `/integrations/aramex`, `/integrations/zatca`, `/ar`; `https://docs.fulfillor.com` (DNS); `https://www.getapp.com/all-software/a/fulfillor/` and `.com.au` (403); `https://www.softwareadvice.com/product/519869-Fulfillor/` (403); `https://www.trustradius.com/products/fulfillor/reviews` (403).

## Unanswered

Listed in section 7 (Q1 to Q15). In short: scope (multi-client, sites), handheld form, tracking push-back ruling, ZATCA wave, pricing, API existence, security, integration count, Arabic invoices, SPL, and customers in KSA.
