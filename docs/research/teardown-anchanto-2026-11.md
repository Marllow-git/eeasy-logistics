# Anchanto teardown, 2026-11

Date: 2026-11-02. Branch `docs/teardown-anchanto` from `origin/main` at `1e0c184`. Author: researcher agent for the lead.
Roadmap basis: `docs/roadmap.md` §1.4 (WMS-1 to WMS-7, INT-8, WEB-13 to WEB-15, OPS-6), §1.5 (INT-9 to INT-12, DEL-16 to DEL-18, WMS-8, WEB-16 to WEB-18, OPS-7), §4 (Q-register), §6 (deferred). Domain basis: `docs/architecture/domain-model.md`, `docs/architecture/identity-and-tenancy.md`. Decisions: `adr/`. Census shape only: `docs/research/ksa-platform-census-2026-11.md` (branch `docs/ksa-platform-census`, Anchanto row). Teardown shape only: `docs/research/shiphero-teardown-2026-11.md` (branch `docs/shiphero-teardown`).

Grades: **[F]** page fetched and read on 2026-11-02; **[S]** search excerpt, aggregator or a page that returned 403 or no answer, so its text is not verified; **(inferred)** my reading, not a source statement. Source IDs (A, S) map to the registry in section 8. Vendor claims are marked "claim".

Method: WebFetch and WebSearch on 2026-11-02. The help centre at `support.anchanto.com` returned HTTP 403 to every fetch, so its text is used only from search excerpts [S]. `help.anchanto.com` did not resolve. No logged-in or trial access, so UI behaviour comes from marketing pages and support excerpts. Anchanto numbers conflict across pages (section 5, row 52); all are vendor claims.

## 1. Summary for the lead

1. Anchanto (Pte Ltd, Singapore HQ) sells five products: Order Management, Warehouse Management, Control Tower, Operations Experience and Parcel Tracking (A1). Its KSA WMS page gives a Riyadh office and "Enterprise Warehouse Management System for Saudi Arabia" (A3).
2. KSA evidence is thin and vendor-sourced: named Saudi clients are PPTCO (WMS; claim of 50% faster order processing, S7), MR DIY and iStyle (A3). A Naqel Express carrier connection was announced on 2026-09-08 (A15). Salla and Zid are webstore connectors for Saudi and UAE stores (A11, A12).
3. The public developer docs are behind a project password (A20). No endpoint, auth scheme, webhook catalogue, rate limit or sandbox could be read, so API anatomy in section 3 is mostly unverified.
4. Borrow 1, shape of site routing: an ordered list of first-match rules (warehouse priority, postcode-to-site map, highest availability, lowest logistic cost) with a primary-site fallback and auto transfer orders for out-of-stock lines (A17, S1). Fits WMS-6 plus a proposed WMS-9, after an owner ruling on multi-site fulfilment.
5. Borrow 2, shape of carrier events: a visible table that harmonises raw carrier events into standard statuses (claim of 150+ events) and AWB and status sync back to the channel (A8, A13). Fits INT-8.
6. Borrow 3, shape of exception alerts: KPI panels with week-on-week and month-on-month change, missed-SLA counts and alerts for delayed or critical parcels, cut by carrier, country and retailer (A7, A8). Fits DEL-17.
7. Gap the owner should see: Anchanto's floor surface is a handheld (Android PDA or camera scanning) for receive, put-away, pick, pack and dispatch (A2, S3, A18). Our pick and pack bench is web only (WEB-15). A 3PL client-billing model (rate cards, per-customer billing, billing reports) is also absent from our plan (A4, A10).
8. Stronger 1: stock is an append-only double-entry ledger with a separation-of-duties threshold (ADR-0011, Q-17, W-16). Anchanto publishes no stock-ledger model; its adjustment controls are not described (inferred from absence).
9. Stronger 2: tenancy is by `account_id` from the token (ADR-0025, ADR-0002 scope). Anchanto's public pages describe no tenancy model. One support excerpt says saving Company Settings breaks a webhook URL (S6, unverified).
10. Stronger 3: Gulf-region hosting and Arabic-first UI (ADR-0022, ADR-0016). Anchanto names no Arabic UI and no hosting region; its Shopify app lists English only (A4, A18). Evidence limits: no pricing, no API docs, help centre 403 on fetch (section 7).


## 2. Product map

"Web" is the merchant or warehouse console. "Handheld" is the Android PDA or camera scanning app. "Evidence" cites the registry.

### 3.1 Order Management (OMS)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Channel order intake | Orders from marketplaces and webstores land in one order flow; Salla and Zid use "a single order process flow" | Web; channel connectors | A5, A11, A12 |
| Pending gate | New orders sit in a Pending tab until checks pass; pending orders are not sent to WMS or any API until they reach "Ready for Pickup"; the change is live for non-multi-warehouse accounts | Web | S2 |
| Multi-warehouse routing | Routing is set per sales channel under Warehouse Configuration; four automatic rules (warehouse priority, location with zip mapping, highest availability, logistic cost); a primary warehouse receives unmatched zips | Web | A17, S1 |
| Order splitting | "Order split functionality" when no single warehouse can fulfil; mechanics not described | Web | A17 |
| Auto transfer orders | Out-of-stock lines at the primary warehouse are transferred to other warehouses | Web | A17 |
| Channel allocation and sync | "Allocate inventory to sales channels in real time to avoid overselling"; stock synced across online and offline channels | Web, connectors | A5 |
| Buffer and safety stock | Buffer stock is set in OMS for Salla and Zid listings; push to channel not stated | Web | A11, A12 |
| Promotions and pre-booking | Absolute discount, MRP adjustment, gift with purchase, pre-booking; inventory can be reserved for campaigns | Web | A5 |
| Cancellations and returns | "Manage order cancellations and returns centrally" | Web | A5 |
| Click and collect | BOPIS and BORIS fulfilment models named | Web | A5 |

### 3.2 Warehouse Management (WMS), inbound and stock

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Warehouse layout | Virtual racks, shelves and bins; carriers configured per warehouse | Web | A2 |
| Purchase orders and QC | PO tracking, quality checks, "intelligent put-away recommendations"; inbound items allocated to recommended racks or shelves | Web, handheld | A2, A4 |
| Put-away | Scanned put-away on handheld; recommendations as above | Handheld | A2, S3 |
| Batch, expiry, serial | Batch and expiry control for GCC compliance; serialised inventory for electronics and pharma; FEFO and FIFO listed as Shopify app pick strategies | Web, handheld | A2, A4, A18 |
| Stock adjustments and periodic check | Periodic Inventory Check sets a per-SKU count and a routine cycle | Web | A4 |
| Transfers between stores | Stock moved between stores and warehouses by transfer orders | Web | A2 |
| Dashboards and reports | Orders, inventory, billing, stock ageing; scheduled reports to download | Web | A2 |

### 3.3 WMS, outbound (pick, pack, dispatch)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Picking strategies | Pick by pool, partial pick, pick in bulk, pick by location, batch pick, wave pick (zone, cluster and discrete not named) | Handheld | A2, A4 |
| Paperless pick pools | Pools of orders for pickers; scan-driven steps | Handheld | S4 (403 on fetch) |
| Packing | Customisable packing lists; selectable packaging materials; skip multi-step packing and per-order pick-list printing | Handheld | A2, A4 |
| Labels and documents | Shipping labels, packing lists, delivery slips, manifests generated automatically; Bill of Entry and Exit kept for free-zone compliance | Web, handheld | A2, A4 |
| Dispatch | Dispatch module for outbound moves; detail not published | Handheld, web | A2 |
| Handheld device | Android app with camera scanning across receiving, put-away, picking, packing, dispatch and returns; iOS not found | Handheld | S3, S11, A18 |

### 3.4 Control Tower, Parcel Tracking and Operations Experience

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Control Tower dashboards | Trends by country, carrier, service and retailer; KPI panel with WoW and MoM change for live parcels and missed SLA | Web | A7 |
| Scorecards and SLA | Carrier, country and retailer scorecards; missed-SLA reports; export of parcel data | Web | A7 |
| Exception alerts | Exception alerts and bottleneck identification; alert configuration not shown | Web | A7 |
| Multi-carrier tracking | Carrier events harmonised to standard formats through a UI ("150+ harmonized events", claim); 100+ carriers (claim); 30k or 60k events a minute (two claims, conflict) | Web, API | A8 |
| Branded tracking page | Custom domain, logo, colours, promotions on the page; feedback surveys on the page, email or SMS (claim: 110M monthly visitors) | Public web | A8 |
| Notifications | Branded email, SMS or WhatsApp; alerts for critical orders or delayed deliveries | Messaging | A8 |
| Open API hub | Share tracking data with partners through an "Open API hub"; no endpoints published (claim: 210M data points a month) | API | A8 |
| Customer dashboard and self-service | Customers manage labels, carriers and order rules; user roles, printer set-up, invoices and tickets; multilingual help | Web | A6 |
| Branded operations portal | Custom domain, colours and typography for the customer's portal | Web | A6 |

### 3.5 Integrations and connectors

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Marketplace and webstore catalogue | Marketplaces (Shopee, Lazada, Amazon, Tiki and others); webstores (Salla, Zid, Shopify, WooCommerce, Wix, Magento and others); claims of 80+ to 200+ connectors | Connectors | A9, A1, A6 |
| Salla connector | Order flow, bulk product upload to Salla, pull of existing listings, inventory from Salla into OMS, labels and invoices, multi-store dashboard; Saudi Arabia and UAE | Web | A11 |
| Zid connector | As Salla, but inventory pushed from Anchanto to Zid; the page states no sync frequency | Web | A12 |
| Carrier integrations | About 130 carriers listed, including SMSA Express, Aramex, Naqel Express, J&T, DHL, Saee, Tamex, Stapo, Shipa and Amazon Shipping | Connectors | A9, A14 |
| Shipa carrier flow | Orders processed in WMS are created on Shipa automatically; AWB and tracking ID synced back to WMS and channels; labels generated by Shipa and printed from WMS; status sync; Multiparcel for splits; GCC cross-border | Web, WMS | A13 |
| Amazon Shipping | Uses the Amazon Shipping API; syncs AWB and tracking to channels | Connectors | A14 |
| Naqel Express | Announced 2026-09-08; connects Naqel to OMS, WMS, Operations Experience and tracking; mechanics not stated | Connectors | A15 |
| Shopify app | Free listing, English only, launched 2020-12-11, 0 reviews on read date; requests view and edit on broad store data | Shopify app store | A18 |
| ERP and POS | Xero, SAP, Oracle, Lightspeed, Vend and others | Connectors | A9 |

### 3.6 Platform pages

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Developer portal | "API Developer Portal" link; the portal loads as a shell on read; OMS and WMS reference pages sit behind a project password (Theneo) | Developer web | A19, A20 |
| Certifications | ISO 27001 certified (claim, on several pages); a job post says annual ISO 27001 re-certification (S13) | Public | A1, A3, A4 |

## 3. API and integration anatomy

Most of this section is unverified. The developer reference is not public (A20).

- **Access.** The OMS and WMS API reference pages ask for a project password and redirect to a Theneo project (A20, read 2026-11-02). A support FAQ names three API sections: OMS, WMS and OXM (S10, search excerpt, 2026-11-02).
- **Auth, marketplace connection.** A support article for an Amazon SG connection lists "API Key", "API Signature" and "Retailer admin email" as required, and says to get the key and signature from Anchanto support (S5, search excerpt). This is a connector setup, not the public API, and I did not confirm the scheme for the public API.
- **Webhooks and callbacks.** A support excerpt names "Call-back Event Configuration" in the developer portal (S6, search excerpt). A second excerpt says that when an order status sync callback fails, Anchanto sends several emails per shipped order (excerpt with no URL returned, S-support). A third reports that saving Company Settings breaks the API connection and needs the webhook URL re-entered (S6, a user-guide excerpt). Inferred from these: callbacks are retried, and a receiver must answer quickly and return success. These are not documented retry rules.
- **Tracking API.** "Open API hub" with no endpoints, auth or rate limits on the product page (A8).
- **Rate limits, sandbox, versioning, SDKs, webhook event catalogue.** Not found (see section 7).
- **Carrier pattern.** Amazon Shipping syncs AWB and tracking through the carrier API (A14). The Shipa page creates shipments automatically and syncs AWB and status back, but does not state the mechanism (A13).
- **Channel pattern.** Salla and Zid pages describe order import, inventory sync, product upload and pull, and labels and invoices. They state no COD flow and no fulfilment or tracking push-back to the store (A11, A12). The inventory direction conflicts: Salla is "from Salla" into Anchanto, Zid is Anchanto to Zid (A11, A12).
- **Shopify scopes.** The Shopify listing requests view and edit on customers, orders, products, inventory, discounts, gift cards and payments (A18). Inferred: a broad scope set; our connectors (INT-11) should request the minimum.
- **Engineering stack, weak evidence.** One third-party profile names Java, Spring Boot, Kafka and AWS (S8). Job aggregators list Node.js engineering-manager roles in Pune and mention AWS and Kubernetes (S-jobs). None is from Anchanto's own careers page, which lists no roles (A21).

## 4. Operational model

- **Tenancy.** A seller account can run several warehouses and several sales channels under one OMS account (A17). The 3PL track sells "one solution suite for multi-brand logistics services" and onboards each client "on a branded platform" (A10). Staff roles are per warehouse (A4).
- **Who it serves.** Brands and retailers (A1, A4); 3PLs, 4PLs and postal operators (A10). Our product is merchant only with its own stock and drivers (ADR-0002, ADR-0005).
- **Billing.** Billing parameters "configured per customer with flexible pricing structures" and "accurate and timely billing reports for each customer" (A4). Also "generating accurate and timely billing reports for each customer" and central SLAs and contracts (A2). Rate cards, invoices, storage and handling charges are not described on any page read (see section 7).
- **Roles.** User roles appear under self-service with invoices and tickets (A6). No role matrix found.
- **Automation.** Auto-routing per channel (A17); auto transfer orders for out-of-stock lines (A17); per-SKU periodic counts (A4); carrier shipment creation on WMS processing (A13); pending gate before WMS sync (S2).
- **Allocation.** The rule list is in A17. Support excerpts say the warehouse-priority rule moves to the next warehouse when the top one cannot fulfil the whole order, and that stock is summed across the order's SKUs (S1). The nearest-warehouse rule is also described in S1. The two excerpts do not say how priority combines with distance; the full article was not readable.
- **Holds.** No hold model is documented. The Pending tab is the only gate found (S2).
- **Pricing.** None published. Third-party sources say Anchanto quotes per deployment (S9). Treat pricing as unknown.
- **Customers.** Clarion Shipping (UAE) moved from one to four warehouses in six months on OMS and WMS (claim, A16). TP MENA unified B2B and e-commerce across the GCC with no figures (A16).
- **Scale claims conflict.** Home page: 200M+ orders a year and 700+ warehouses (A1). KSA WMS page: 70M+ orders a year, 700+ warehouses (A4). Order Management page: 42M orders a year (A5). Logistics page: 750+ warehouses (A10). These are vendor claims, not audited.

## 5. Mapping table

Borrow column: **Yes, shape** (adopt the shape in our order), **Adapt** (take part, change the rest), **No** (reason and the ADR or roadmap row that decides it). "Stronger" means our written design is more explicit on the point; it is not a claim about Anchanto's runtime.

| # | Feature | Anchanto | eeasy-logistics today (order id or gap) | Borrow? |
|---|---|---|---|---|
| 1 | Channel order intake | Marketplaces and webstores in one flow (A5) | Manual and CSV orders (DEL-2, WEB-5); Salla and Zid only (INT-11, wave 4); no other connectors | No for broad connectors (Q-30, owner scope); Salla and Zid pattern already planned |
| 2 | Order gate before fulfilment | Pending tab; nothing sent to WMS until Ready for Pickup (S2) | Receive as pending with typed reason `outside_coverage` (DEL-2, D-3, ADR-0015) | No; ours is explicit and typed |
| 3 | Multi-site routing rules | Four ordered rules with primary fallback and zip map (A17, S1) | Gap. Sites exist (ADR-0018); no routing rule in the roadmap | Yes, shape: ordered first-match rules with primary fallback. New WMS-9, needs an owner ruling and an ADR |
| 4 | Transfer between sites | Auto transfer of out-of-stock lines (A17) | Gap. Transit per site at pickup (Q-2); no transfer order | Yes, shape: one transfer as one ledger transaction (inferred). WMS-9 |
| 5 | Split across sites or parcels | Split when no single warehouse can fulfil (A17); Multiparcel (A13) | Parcels: WMS-7 packages (domain §4.14). Site split: gap | Adapt in WMS-9 and WMS-7 |
| 6 | Allocation | Stock summed over the order's SKUs for routing (S1) | Reservation per fulfilment-order line, atomic with pick (domain §4.5, §4.10, W-8) | No; ours is line-level and stated |
| 7 | Holds | No hold model documented (S2) | `on_hold` on short pick (W-9, domain §4.10), `outside_coverage` pending (D-3) | No; ours is stronger and typed |
| 8 | Promotions, campaign reservations, pricing | Discounts, MRP, pre-booking (A5) | Not in scope (ADR-0002) | No; not our product |
| 9 | Returns and cancellations | Central cancel and return (A5) | DEL-18 return pickup and exchange; WMS-8 dispositions | No change; already planned |
| 10 | Buffer stock on channel | Buffer set in OMS for Salla and Zid (A11, A12) | INT-12 one-way publish with drift reconcile (ADR-0013); no buffer rule | Yes, shape: buffer applied at publish time. Amend INT-12 |
| 11 | Stock direction to channels | Salla in, Zid out (A11, A12), conflicting | One way, WMS to channel, through the outbox (ADR-0013) | No; ours is explicit |
| 12 | Customer self-service | Carriers, rules, labels, users, invoices, tickets (A6) | Settings in WEB-3; custom account roles not scheduled (identity-and-tenancy §2; roadmap §6) | No now; revisit with WEB-3 |
| 13 | Connector breadth | 80+ to 200+ claimed (A1, A6, A9) | Two webstores (INT-11) | No; owner scope and Q-30 |
| 14 | Warehouse structure | Virtual racks, shelves, bins; per-warehouse carriers (A2) | Location tree with types, path and pickable (WMS-1, domain §4.1, ADR-0012, ADR-0018) | No; ours is more explicit |
| 15 | Lots, serials, batch and expiry | Batch, expiry, serial; FEFO and FIFO in Shopify app (A2, A4, A18) | WMS-2 lots and serials (domain §4.2); no FEFO or FIFO rule in the roadmap | Yes, shape: pick strategy as an account setting. Amend WMS-6 |
| 16 | Put-away recommendation and QC | Recommended racks, QC checks (A2, A4) | WMS-4 put-away (no recommendation logic, no QC hold status) | Adapt in WMS-4 design |
| 17 | Pick strategies | Pool, partial, bulk, location, batch, wave (A2, A4) | WMS-6 pick tasks and short picks; batch and wave absent | Yes, shape. Amend WMS-6 (proposal P1) |
| 18 | Paperless pick on handheld | Android camera scanning and PDA (S3, S4) | Scanner-first web bench (WEB-15); driver app only (DRV-1) | Yes, shape; owner ruling on device surface (proposal P7) |
| 19 | Packing lists and materials | Custom lists and materials; skip steps (A4) | Packages (WMS-7, domain §4.14); materials not planned | Adapt later in WMS-7 |
| 20 | Labels, manifests, slips | Auto labels, slips, manifests (A2, A4) | Labels in WMS-7 and INT-8; manifests not planned | Adapt in INT-8. Free-zone Bill of Entry: No, no demand in our docs; owner question |
| 21 | Cycle counts and periodic check | Per-SKU routine checks (A4) | Count sessions (WMS-5, domain §4.15) with no per-SKU schedule | Yes, shape. Amend WMS-5 (proposal P6) |
| 22 | Adjustments and separation of duties | Not described | Threshold per account (Q-17, WMS-5), approver is not the counter (W-16) | No; ours is stronger |
| 23 | Kitting and bundles | Bundles on Salla listings (A11); kitting not on the WMS page (A2) | Not in the roadmap; assembly and kits absent | No for now; revisit at WMS-2 |
| 24 | Stock transfer between stores (B2B) | Transfer orders across stores (A2) | Gap, no B2B order type | Yes, shape within WMS-9; B2B orders are an owner question |
| 25 | Dispatch and handoff | Dispatch module (A2) | Pack-time handoff to own fleet (ADR-0014) and carriers (INT-8) | No change; decided |
| 26 | Multi-client 3PL tenancy | Multi-brand suite, client onboarding (A10) | Merchant only (ADR-0002); tenancy by account (ADR-0025) | No now; needs an ADR to change scope |
| 27 | Client billing (rate cards, invoices) | Billing per customer, billing reports (A2, A4) | Gap; pricing for our own SaaS open (Q-33) | No now; owner question (proposal P8) |
| 28 | Staff roles per warehouse | Per-warehouse staff roles (A4) | Membership `site_ids` with site-scoped permissions (identity-and-tenancy §2) | No; equal |
| 29 | KPI dashboards and scorecards | Control Tower by carrier, country, retailer, WoW and MoM (A7) | DEL-17 SLA and scorecards; WEB-18 screens | Yes, shape. Amend DEL-17 (proposal P5) |
| 30 | Exception and missed-SLA alerts | Exception alerts; missed SLA; delayed deliveries (A7, A8) | DEL-5 stale-tracking alert (5 minutes) only | Yes, shape. Amend DEL-17 |
| 31 | Branded tracking page | Domain, logo, colours, promotions (A8) | Public token view (DEL-8, D-24), WEB-8; embedding off (Q-20) | Adapt later: per-account branding behind a flag (ADR-0006) |
| 32 | Carrier event harmonisation | Raw events mapped to standard formats, 150+ (A8) | Tracking webhook mapping (INT-8), no published table | Yes, shape: visible per-carrier mapping. Amend INT-8 (proposal P4) |
| 33 | Carrier ingestion | Pre-built integrations, "sync regularly" (A8); mechanics not given | Polling and SSE for tracking (ADR-0009); carrier webhook mapping (INT-8) | No; ours is specified |
| 34 | Customer notifications | Email, SMS, WhatsApp (A8) | Templates only (INT-3, ADR-0037); WhatsApp via engine (ADR-0041); no SMS before wave 3 | No; decided by ADR-0037 and ADR-0041 |
| 35 | Tracking feedback surveys | Surveys on page, email, SMS (A8) | Not planned | No; out of scope |
| 36 | Partner tracking API | Open API hub (A8) | Public tracking read (INT-9, DEL-8) | Yes, shape; not their claimed volumes |
| 37 | Saudi carriers | About 130 carriers, many KSA (A9, A14) | Eeasy shipping API carriers with per-account keys (INT-8, ADR-0014); allowlist (ADR-0006) | No on breadth; aggregator model decided against by ADR-0014 |
| 38 | Carrier shipment flow | Shipa: create on WMS process, AWB back, labels (A13) | Pack-time shipment (WMS-7, INT-8); AWB and status sync back not stated in the acceptance | Yes, shape. Amend INT-8 (proposal P4) |
| 39 | Naqel connection | OMS, WMS, tracking; mechanics not stated (A15) | Carrier go or no-go (Q-29) | No; signal only |
| 40 | Salla and Zid intake | Order flow, product sync, labels and invoices (A11, A12) | INT-11 (install, OAuth, claim, refresh, intake, reconcile); INT-12 publish | Yes, already planned; adapt labels and invoices (see Unanswered on e-invoicing) |
| 41 | Shopify app | Free, English, broad scopes (A18) | Not in plan | No; our connectors request minimum scopes (inferred) |
| 42 | COD | Not in the Salla, Zid or Shipa pages read | COD custody (DEL-7, ADR-0007, ADR-0017, ADR-0034) | Stronger; evidence-limited, Anchanto may have COD elsewhere |
| 43 | Public API and keys | Key plus signature via support (S5); portal behind password (A20) | Static `X-API-Key` default (Q-13, INT-9), sandbox keys | Adapt later once Anchanto's scheme is known; no borrow now |
| 44 | Merchant webhooks | Callbacks in portal; retries inferred (S) | Standard Webhooks signing (ADR-0040, Q-43), retries with `410` and `Retry-After` (INT-10) | Yes, one idea: subscription edits must not touch unrelated settings (S6, inferred) |
| 45 | Tenancy in the data model | Not documented | Account id from token, enforced structurally (ADR-0025, PLAT-16) | Stronger on documentation; no evidence on Anchanto's build |
| 46 | Hosting, certification | ISO 27001 claimed (A1, A4), re-cert in job post (S13); no SOC 2 or PDPL statement; hosting not named | Gulf-region containers (ADR-0022); no certification decided | No borrow of a certificate without owner decision; owner question |
| 47 | Languages | Support "in your language and region", none named (A4); Shopify English (A18) | Arabic and English everywhere (ADR-0016); Arabic default and RTL (WEB-1) | Stronger in stated commitment; Anchanto's Arabic UI not verified |
| 48 | Warehouse mobile app | Android PDA; iOS not found (S3, S11) | No warehouse app; driver app Expo (DRV-1, ADR-0004) | Gap; proposal P7 |
| 49 | Engineering stack | Java, Spring Boot, Kafka, AWS, Node.js (S8, S-jobs); weak | NestJS API (ADR-0003), PostgreSQL with PostGIS (ADR-0019), Drizzle (ADR-0020) | No; not a borrow; weak evidence |
| 50 | Scanner app languages | Not found | Arabic and English (ADR-0016) | Unknown; check on a demo |
| 51 | Free-zone compliance | Bill of Entry and Exit records (A4) | Not in roadmap | No for now; owner question |
| 52 | Scale claims | Conflicting: 200M, 70M, 42M orders a year; 700 and 750 warehouses (A1, A4, A5, A10) | Not comparable | Not a borrow; treat as claims |

## 6. Proposed order amendments and new orders

At most eight. Each is a proposal for the lead; none changes `docs/roadmap.md`. Each cites its evidence rows in section 6.

- **P1. Amend WMS-6, pick strategies.** Add a per-account pick strategy: single order, batch, wave by pool, and FEFO or FIFO for lots (rows 15, 17). Zone, cluster and discrete picking are not evidenced in Anchanto's pages and are not proposed. Depends on WMS-3. Adversary: no (no auth or money change), owner call on wave scope.
- **P2. New WMS-9, site routing and transfers.** Ordered rules (priority, postcode-to-site map, highest availability, lowest logistic cost only when carrier costs are entered), a primary-site fallback, auto transfer for out-of-stock lines and split across sites (rows 3 to 5). Depends on WMS-6, WMS-3 and DEL-2. Needs an owner ruling that one account may fulfil from several sites, and a new ADR for cross-site routing (ADR-0018 defines sites, not routing). Adversary: yes if it moves stock across sites with money or custody consequences.
- **P3. Amend INT-12, buffer stock at publish.** A per-channel buffer applied when publishing stock, kept one way and through the outbox (rows 10, 11; ADR-0013). Adversary: no.
- **P4. Amend INT-8, carrier events and AWB sync.** A visible, versioned per-carrier table that maps raw events to our statuses; AWB and status sync back to the channel; label download; multi-parcel mapping onto WMS-7 packages (rows 32, 38). Adversary: yes if it touches the per-account carrier key (secret handling).
- **P5. Amend DEL-17, exceptions and missed SLA.** KPI panel with week-on-week and month-on-month change, missed-SLA counts, exception alerts for delayed orders, cut by carrier, site and zone (rows 29, 30). Adversary: no.
- **P6. Amend WMS-5, per-SKU count schedule.** Count frequency per SKU and a routine cycle; count variances still post as adjustments under the threshold (rows 21, 22). Adversary: no change to the separation-of-duties rule, which stays as Q-17.
- **P7. New WH-1, warehouse handheld app (owner decision first).** Receive, put-away, pick, pack and dispatch on Android handhelds, Arabic and English, with the same outbox pattern as the driver app (rows 18, 48; ADR-0004, ADR-0008, ADR-0021 precedent). The owner must choose between a web scanner-first bench on handhelds and a native app. Not before WMS-6 design. Adversary: yes at the device-binding and sign-in step (inferred; rule covers auth and tokens).
- **P8. BILL-1, client billing for 3PL operators (gated, not scheduled).** Rate cards per client, storage and handling charges from WMS events, invoices, per-client reports (rows 26, 27). Blocked by an ADR changing ADR-0002 and by Q-33. Adversary: yes, money.

## 7. Unanswered

1. Public API: endpoints, auth header or signature scheme, token lifetime, webhook event list, retry policy, rate limits, sandbox and versioning. The developer reference is behind a project password (A20). Owner could ask Anchanto for access or the portal password.
2. Pricing: no SAR figure, per-user or per-order. Third-party sources say quote per deployment (S9). Owner needs a quote or demo for a comparison.
3. Hold model: whether Anchanto has holds beyond the Pending gate (S2 is one excerpt).
4. Routing precedence: how warehouse priority combines with distance, and whether lowest-cost needs carrier rates entered (S1 snippets and A17 differ in detail; full articles not readable, 403).
5. Pick mechanics: pool definitions, wave release and batch size (S4 and A2 only; the article returned 403).
6. Handheld: iOS availability and scanner languages (Arabic?). Not found. A demo or the Play listing would settle it.
7. Salla and Zid: inventory direction conflict (A11 vs A12); whether fulfilment and tracking are pushed back to the store; COD handling.
8. Naqel: what the connection carries (labels, pickup, COD, status events) (A15 gives none).
9. Certification: ISO 27001 certificate number, scope and expiry (only a job-post excerpt with no URL, S13); no SOC 2 or PDPL statement found.
10. Hosting region for KSA customers and data residency; not stated on any page read.
11. 3PL billing: rate cards, storage and handling charges, invoice format and client portal. Not on any page read; help centre 403.
12. E-invoicing (ZATCA): not on any Anchanto page read, and not in our roadmap or ADRs. Owner question for the Salla and Zid invoice flows.
13. Free-zone compliance: whether KSA free-zone merchants are a target. Anchanto markets Bill of Entry records (A4).
14. Customer evidence: PPTCO's 50% figure is a vendor claim from a press release excerpt (S7); the case study page was not opened. MR DIY and iStyle locations and use are unknown.
15. Engineering stack: only aggregator profiles (S8, S-jobs). Anchanto's careers page lists no roles (A21).
16. Scanner app languages and the 'Reducing Clicks' WMS mobile flow (S11) need the help centre, which returned 403.

## 8. Source registry

Read date for every entry is 2026-11-02 unless marked. Sources were read through WebFetch and WebSearch; every fetched page is listed below.

**Fetched [F]**
- A1 https://anchanto.com (home; five products, integrations, clients, office list, numbers)
- A2 https://anchanto.com/products/warehouse-management/ (WMS features and claims)
- A3 https://explore.anchanto.com/en-sa/?p=135680 (KSA WMS page; Riyadh office; clients; integrations named)
- A4 https://explore.anchanto.com/en-sa/?p=130843 (WMS mechanics page: receiving, picking, packing, billing, numbers)
- A5 https://anchanto.com/products/order-management/ (OMS features)
- A6 https://anchanto.com/products/operations-experience/ (customer portal, self-service)
- A7 https://anchanto.com/products/control-tower/ (dashboards, SLA, scorecards)
- A8 https://anchanto.com/products/parcel-tracking/ (tracking, harmonised events, alerts, API hub)
- A9 https://anchanto.com/integrations/ (connector and carrier lists)
- A10 https://anchanto.com/solutions-for-logistics-service-providers/ (3PL offer; no billing detail)
- A11 https://anchanto.com/integration/salla/ (Salla connector)
- A12 https://anchanto.com/integration/zid/ (Zid connector)
- A13 https://anchanto.com/integration/shipa/ (Shipa carrier flow)
- A14 https://anchanto.com/anchanto-integrations-update-november-2023/ (dated 2023-11-30; six integrations added)
- A15 https://anchanto.com/anchanto-connects-with-naqel-express-to-streamline-logistics-in-saudi-arabia/ (dated 2026-09-08)
- A16 https://anchanto.com/anchanto-bridge-korea-to-middle-east-e-commerce-with-proven-technology-success/ (dated 2025-12-03; Saudi and UAE customers; PPTCO 50% claim)
- A17 https://anchanto.com/presenting-the-multi-warehousing-feature-for-anchanto-oms/ (dated 2022-05-31; routing rules list)
- A18 https://apps.shopify.com/anchanto-wms (free listing; scopes; English; launch 2020-12-11)
- A19 https://developer.anchanto.com (loading shell on read)
- A20 https://developer.anchanto.com/oms/oms-api-operation-mapping and https://developer.anchanto.com/wms/wms-api-mapping (project-password gate, redirect to app.theneo.io)
- A21 https://anchanto.com/careers/ (no roles or stack listed)

**Search excerpt or not opened [S]**
- S1 https://support.anchanto.com/hc/en-us/articles/25927599606161-OMS-Multi-Warehousing-Order-Routing (search excerpt; not opened)
- S2 https://support.anchanto.com/hc/en-us/articles/25927738907409-Pending-Orders-Tab-Frequently-Asked-Question (fetch 403; excerpt used)
- S3 https://support.anchanto.com/hc/en-us/articles/29511264865041-Barcode-Scanning-with-Android-Camera-WMS-Mobile-Application (fetch 403; excerpt used)
- S4 https://support.anchanto.com/hc/en-us/articles/34951516453649-Paperless-Pick-Pools (fetch 403; excerpt used)
- S5 https://help.anchanto.com/support/solutions/articles/44002443149-how-to-get-api-keys-for-amazon-sg- (host did not resolve on fetch; excerpt used)
- S6 https://support.anchanto.com/hc/en-us/articles/25927715717393-User-Guide (fetch 403; excerpts used for the callback configuration and the Company Settings note)
- S7 https://anchanto.com/pptco-reduces-order-processing-time-by-50-with-anchanto-wms/ and https://tools.prnewswire.com/en-us/live/20823/release/20260114EN60902 (search excerpts; PPTCO claim)
- S8 https://theorg.com/org/anchanto/org-chart/rishu-gupta (third-party profile; stack)
- S9 https://www.g2.com/products/anchanto-warehouse-management/pricing and https://erpresearch.com/erp-add-ons/marketplace/anchanto/pricing (search excerpts; no public price)
- S10 https://support.anchanto.com/hc/en-us/articles/25927724676881-FAQs (fetch 403; excerpt names OMS, WMS and OXM API sections)
- S11 https://support.anchanto.com/hc/en-us/articles/25927735513489-Reducing-Clicks-for-Enhanced-Efficiency-for-WMS-Mobile-APP (search excerpt; Android PDA)
- S13 Job-post excerpt on annual ISO 27001 re-certification; no URL returned by search (aggregator); not verified
- S-jobs Job-aggregator listings naming Node.js and Java roles tied to Anchanto; no URL verified; weak
- S-support Search excerpt on sync-callback emails per shipped order; no URL returned, not verified

**Background, not Anchanto**
- Generic 3PL billing guidance (rate cards, storage per pallet) from search results; not used as Anchanto facts.

**Eeasy references (repository)**
- ADR-0002, 0003, 0004, 0005, 0006, 0007, 0008, 0009, 0011, 0012, 0013, 0014, 0015, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0025, 0030, 0034, 0037, 0040, 0041, `adr/`
- `docs/roadmap.md` §1.2, §1.4, §1.5, §4 (Q-2, Q-13, Q-17, Q-20, Q-29, Q-30, Q-33, Q-43), §6
- `docs/architecture/domain-model.md` §3.2 to §3.4, §4.1, §4.2, §4.5, §4.10, §4.14, §4.15, W-8, W-9, W-16, D-3, D-24
- `docs/architecture/identity-and-tenancy.md` §2 (roles and site restriction)
