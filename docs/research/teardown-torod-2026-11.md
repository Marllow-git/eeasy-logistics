# Torod teardown, 2026-11

Date: 2026-11-02 (every read on this date unless marked [S]). Branch `docs/teardown-torod` from `origin/main` at `1e0c184`. Author: researcher agent for the lead.
Roadmap basis: `docs/roadmap.md` §1.2 to §1.5 (DEL, INT, WMS, WEB, OPS ids). Census row: `docs/research/ksa-platform-census-2026-11.md` (branch `docs/ksa-platform-census`). Shape only: ShipHero teardown (branch `docs/shiphero-teardown`).
Grades: **[F]** fetched and read on 2026-11-02. **[S]** search-result summary only, or a page that could not be opened. **(inferred)** my reading, not a source statement. Source IDs T1 to T51 and R1 to R6 resolve in section 8 with URL and read date. Arabic pages were read first; English was used where the Arabic page was missing.
Limits: no logged-in access and no trial merchant account, so no screen was seen in use. The API reference at docs.torod.co is rendered in the browser; its operation list did not load. Folder pages in the help centre show titles only; "body" marks the articles read in full.

## 1. Summary for the lead

1. **What it is.** Torod (طرود; Torod Company for Information Technology, Riyadh) is a Saudi shipping aggregator with software: carrier comparison, labels, tracking, returns, COD collection and transfer, plus optional storage and pick-and-pack [T1, T4, T5, T33].
2. **Who it serves.** Saudi e-commerce merchants on Salla, Zid, Shopify, WooCommerce and Magento. The homepage shows 14 customer logos and four testimonials, and no merchant count [T14]. Places listed: Riyadh, Jeddah, Dammam, Makkah, Dubai, Abu Dhabi, "places we've been"; offices not stated [T6].
3. **Model.** Torod says it is an intermediary, not a party to the shipping contract, and disclaims liability for transport, storage and delivery. It collects and transfers COD on a plan schedule, so it appears to hold COD money in between (inferred) [T9, T24].
4. **Borrow 1, ordered automation rules.** First-match rules with conditions and actions, plus a per-rule auto-print toggle. Use the shape for pack-time carrier and label choice (A3), not for carrier pricing [T23].
5. **Borrow 2, COD status ladder and merchant statement.** Under review, collected, transferred; search by customer, tracking number or order number. Use it as a merchant view over DEL-7 and DEL-11 (A6) [T24].
6. **Borrow 3, API resource split.** Orders, shipments (list, track, cancel) and warehouses (pickup points) as separate resources. Shape for INT-9 (A1) [T28].
7. **Where we are stronger, stock and cash.** Stock is an append-only ledger with stated invariants (ADR-0011); cash custody is a PIN-verified handover with liability entries (ADR-0007, DEL-11). Torod publishes a status and a schedule, not an invariant (inferred from T9, T24).
8. **Where we are stronger, integrations and tracking.** Webhooks follow Standard Webhooks signing (ADR-0040, INT-10); recipient tracking uses an issued token (DEL-8). Torod's tracking accepts a phone number as a key, and its WordPress plugin takes the merchant's Torod password [T8, T35].
9. **Relation to ADR-0005, 0001, 0014.** Torod is the aggregator model: it compares and books 240+ carriers, and its terms call it an intermediary (T9). A search summary of a profile also says it owns no fleet (T47 [S]). ADR-0001 and ADR-0014 keep carrier pricing and booking in Eeasy shipping; ADR-0005 limits this product to merchants' own fleets. We borrow Torod's rules and statements, not its carrier-marketplace role (inferred).
10. **API status.** A reference exists at docs.torod.co (Order, Shipment, Warehouse, Courier partners), but its operations did not load. A third-party copy shows `/orders` on `api.torod.co/v1`; Torod's homepage shows `POST /v1/shipments`. Endpoint shape is unverified. This updates census Unanswered 1, which found no API section.

## 2. Product map

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Rate comparison, carrier choice | Homepage: "compare 240+ carriers per order"; System page: "260+ shipping partners". Calculator at /price. Merchant picks a carrier and creates the shipment. | Web; calculator; API sample `"carrier":"auto"` | T1, T4, T2 [F] |
| Carriers named, toggles | SMSA, Aramex, J&T, Redbox, iMile, Naqel, Barq, Thabit (homepage); SPL, Zajil, Bosta, FedEx (Salla). Any courier can be enabled or disabled; all active by default. | Web; API FAQ | T1, T32, T28 [F] |
| "Bring Your Own Contract" row | BYOC row under "Shippers & Pricing" on the price page; no values in the extract. | Pricing page | T2 [F] |
| Create shipment | Pick or add a customer, enter product value, search carriers. Weight and COD amount are not among the steps. | Web orders page | T26 [F]; folder title T17 [F] |
| Edit after creation | Customer, package size, addresses, actual weight and box count are editable. Payment method and price are locked; a change means a new order. | Web orders page | T26 [F] |
| Bulk and hide | Bulk ship or hide selected orders; soft hide with a hidden-orders filter. | Web orders page | T26 [F] |
| Store order sync | Manual "Sync orders" after the store is connected; success message only. | Web | T25 [F] |
| Returned shipment | Keeps the original order number; order source shows "مرتجع" (returned). | Web | T27 [F] |
| Automation rules | Ordered: the first rule runs first. Conditions must all match; actions: choose a company, auto-print waybills per rule. No trigger list, dry run or carrier logic. | Web, Settings | T23 [F]; folder title T19 [F] |
| Labels and printing | Labels "within seconds"; bulk printing; export, print and status are article titles only. | Web; API `label_url` | T4, T1, T21 [F] |
| Public tracking | Lookup by AWB ("tracking number printed on your label"), order ID or mobile number. Result content not shown. | Public /track page | T8 [F] |
| Branded tracking, stage SMS | Store logo on tracking and returns pages; SMS at each stage; expected delivery date for the customer. "Fewer WISMO −38%" is a mockup. | Web; Salla; WordPress | T1, T14, T32, T35 [F] |
| Returns and exchanges | Self-serve returns and exchanges, merchant-set conditions; reverse label on Salla. Return articles exist (titles only). | Web; Salla; Shopify | T1, T4, T32, T33, T20 [F] |
| COD statuses | Under review (قيد المراجعة) after delivery; collected (تم التحصيل) when cash is collected; transferred (تم التحويل) one week after collection (body). | Web wallet > COD | T24 [F] |
| COD search | By customer name, number or email; tracking number; order number. | Web | T24 [F] |
| COD transfer schedule | Free: twice a month; Premium: weekly; Pro: twice a week. Instant transfer carries a plan commission (amount not published). Transfer only for confirmed deliveries. A 2022 blog says collected amounts are visible the same day. | Pricing; terms; blog | T2, T3, T9, T43 [F] |
| Wallet | Top-up credited only after payment is verified; pays shipping; cash refund only on account closure; promotional balance non-refundable. | Web wallet | T9 [F]; folder title T18 [F] |
| Payment methods | Card or cash; SADAD "launching shortly". The how-it-works page describes SMSA drop-off and a SAR 800 slab; probably an older flow. | Web | T7 [F] |
| Fulfilment and warehousing | Receive, store, pick and pack in merchant branding, ship, "live stock across channels". Quote form; no locations, SLAs, prices or WMS features. | Web landing | T5 [F] |
| Packaging store | Sells packaging materials; help folder lists one article. | Web; help | T29, T15 [F] |
| Shipment types | Free: normal. Premium adds quick, PUDO, cold, pallets, docs. Pro adds heavy. | Pricing page | T2 [F] |
| Cross-border, GCC | Taraod International, door to door outside the Kingdom; GCC and international on Pro; Riyadh to Dubai "2–4 days" as an example. | Web; pricing | T1, T2 [F] |
| Freight, weight | Pallet and B2B freight; maximum 100 kg per order. | Web; API FAQ | T1, T28 [F] |
| Analytics and reports | Carrier and city performance; shipping, return and performance reports; on-time mockup (SMSA 96%, Aramex 94%, Naqel 92%). | Web; plugin | T1, T14, T35 [F] |
| Integration: Salla | Torod app in the Salla store: free install; city rates; merchant enters its own shipping cost to see margin; 200+ couriers claimed. | Salla app | T31, T32 [F] |
| Integration: Zid | Help articles for Zid Lite and Growth/Professional plans (titles). Zid's partner rules: commercial approval before activation. No Torod Zid App Market listing found. | Zid help; web | T16 [F]; T49, T51 [S] |
| Integration: Shopify | Free install; labels "from SAR 17" but "all fees are charged in USD"; scopes include orders from the last 60 days. Launched 23 Feb 2024. | Shopify app | T33 [F] |
| Integration: WooCommerce | Plugin v2.1.1 (WordPress 6.0+, PHP 7.4+); enter Torod email and password; 60+ installs, 3.7 from 3 reviews. | WordPress | T35 [F] |
| Magento, Zapier | Magento module needs a separate account [S]. Zapier: one "Create Order" action over OAuth; Zid not listed. | Adobe; Zapier | T50 [S]; T37 [F] |
| Platform API ("Torod for Platforms") | Shipping IaaS for platforms with a "flexible API": checkout options, branded tracking, return automation, pre-negotiated rates. Makane first (24 Jan 2023). | API; blog | T40 [F] |
| Platform partners | MYCN (Dec 2022), dal stc channels (Dec 2022), National Center for Palms and Dates (Dec 2022). | Blog | T41, T42, T44 [F] |
| Carrier partner page | Carriers join through API, dashboard, tracking and analytics; no fees, COD or rate terms stated. | Web | T11 [F] |
| Seats and roles | Team members: 5 on Free, unlimited paid. Roles: 3 on Free, unlimited paid. | Pricing page | T2 [F] |
| Licensing consulting | Paid support for people starting a shipping company; no price or timeline. | Web | T12 [F] |
| Merchant mobile app | None found on the homepage, App Store or Google Play. Salla and Shopify are the app surfaces. | - | T1 [F]; [S] searches |

## 3. API and integration anatomy

| Surface | What it says | Evidence |
|---|---|---|
| docs.torod.co | Stoplight "Torod Developers Guide". Resources: Order (list, create, update), Shipment (list, track, cancel), Warehouse (create, list, update), Courier partners. Prerequisite: partner dashboard access. "Work in progress and subject to change." Operation list did not load. | T28 [F] |
| help.torod.co API article | "Connecting via API": for stores and multi-store platforms; tracking via API or webhooks; contact Torod to set up; links to docs and a Postman collection "torod-merchant-api". | T22 [F] |
| Homepage sample | `POST /v1/shipments` with `"carrier": "auto"`; 201 with `label_url` and `tracking_no`. SDK list: GenAI, Node.js, PHP, React, Laravel, Angular, Python. | T1 [F] |
| api.torod.co | Marketing "About" page; `/docs/` and `/v1/` redirect to a torod.co 404 page (curl, 2026-11-02). | T29, T30 [F] |
| Third-party copy | "SmartShip API" 1.0.0 at `https://api.torod.co/v1`; `X-API-Key` header; createOrder, listOrders, getOrder on `/orders`. Third party; created 2026-04-03. | T38 [F] |
| Older API page | `lite.torod.co/api.php`: API dated 2018-02-08; token shown once. Host did not resolve on 2026-11-02. | T39 [S] |

- **Resources (T28, inferred flow).** Order (not yet assigned to a courier) becomes a Shipment on assignment; a Warehouse is the pickup location. Flow: warehouse, order, carrier or `auto`, shipment and label, tracking by AWB, status by webhook or polling. Torod splits order and shipment, as we do (DEL-2, WMS-7, INT-8), but takes the weight at order time; ADR-0014 waits for the measured weight at pack.
- **Auth.** Docs name partner dashboard access but no auth method (T28). The third-party copy uses an `apiKey` in `X-API-Key` (T38). Shopify asks for scopes at install (T33). Zapier uses OAuth (T37). WooCommerce takes the merchant's Torod email and password (T35).
- **Order payload (third-party copy, unverified).** Required: `order_id`, `customer` (`customer_id`, `name`, `email`, `phone`, `address` with `street`, `city`, `country`), `items` (`item_id`, `product_id`, `name`, `quantity`). Not required: payment type, COD amount, weight, pickup point. (inferred: the copy may be incomplete, and that matters for COD.)
- **Webhooks.** Named on the homepage; the API article says tracking can run "through the API or webhooks" (T1, T22). No event list, payload, signing, retry or health model found.
- **Rate limits, versions, sandbox.** Not found. The third-party copy's rate-limit FAQ has no answer (T38). A Postman collection is named, not opened (T22).
- **Shopify data footprint.** Customers, products, inventory, collections, orders from the last 60 days, returns, shipping information, locations, payment terms. Collects customer name, email, phone, address, IP, browser and browsing behaviour (T33). The largest data set in any connector found.
- **Patterns the product exposes.** Store sync is a manual button (T25); bulk actions on the orders list (T26); ordered automation rules (T23); public tracking by AWB, order ID or phone (T8).

## 4. Operational model

- **Onboarding.** Free plan: no subscription, no minimum shipments, no long-term contracts (T2, T29). Store connection: Salla install (T31), Zid through the help flow (T16), Shopify install with scopes (T33), WooCommerce by email and password (T35). API access asks whether the account is an "E-commerce Store" or "E-commerce Platform"; contact is by sales email or a technical call (T28). Only proof of identity is named for verification (T7).
- **COD cycle.** (1) Carrier collects on delivery; status under review. (2) Cash collected; status collected. (3) One week after collection, transferred (T24). (4) Plan schedule sets the transfer date: Free twice monthly, Premium weekly, Pro twice weekly; terms say transfers follow the plan for confirmed deliveries (T2, T3, T9). **Conflict:** the one-week grace (T24) and the plan schedule (T2, T9) are not reconciled. (inferred) Torod carries the timing risk of carrier remittance and holds money in between; no page says so.
- **Billing.**

| Plan (English / Arabic) | Monthly | Annual | Per-city rate inside / outside | Coverage | COD transfer | Warehouses | Team, roles |
|---|---|---|---|---|---|---|---|
| Free / مجانية | 0 SAR | not listed | variable | Saudi Arabia | twice a month | 1 | 5, 3 |
| Premium / مميزة | 199 SAR | homepage: 2,100 SAR a year | 16.10 / 20.70 SAR, all couriers | Saudi Arabia | weekly | unlimited | unlimited |
| Pro / احترافية | 399 SAR | homepage: 4,188 SAR a year | 14.38 / 19 SAR, all couriers | Saudi, GCC, international | twice a week | unlimited | unlimited |

Sources: T2, T3 [F]; annual figures from the homepage (T1) [F]. Per-city rates are flat across couriers on paid plans (T2); (inferred) the merchant then does not pick a carrier on price, and Torod carries the carrier-cost difference. No COD percentage is published. Wallet balance pays shipping (T9). Shopify quotes USD fees; the homepage bills in SAR (T33, T1).
- **Roles.** Seat and role counts are plan limits (T2). Role names are not in the extract (T15).
- **Liability and law.** Intermediary; the courier is responsible for service (T9). Disclaims liability for loss or damage in shipping, transport, storage and delivery; no insurance terms. Prohibited goods are the merchant's responsibility. Saudi law; Riyadh courts (T9).
- **Data protection.** Collects name, email, phone and business information; basis: contractual necessity; no PDPL named. Transfers abroad "with appropriate safeguards"; storage location not stated. Shares with unnamed third parties and payment processors. No fixed retention period. "Independent auditors" for financial systems; no encryption or access control named. Breach notice duty mentioned with no timeline (T10). No ISO, PCI, SOC, PDPL or ZATCA statement on the pages read (T14). Help centre claims a Communications Authority licence [S].

## 5. Mapping: Feature | Torod | eeasy-logistics today | Borrow?

Borrow? values: **yes** (take the shape), **adapt** (take the idea with changes), **no** (reason given), **already** (we have it). ADR references are to `adr/`.

| # | Feature | Torod | eeasy-logistics today (order id or gap) | Borrow? |
|---|---|---|---|---|
| 1 | Carrier comparison and booking | Compare 240+ per order; "automate carrier selection" (T1, T4) | Gap by design: carrier pricing and booking sit in Eeasy shipping, INT-8 (ADR-0001, ADR-0014) | no: ADR-0001, ADR-0014. Carrier card shows Eeasy shipping's quote only |
| 2 | Ordered automation rules | First-match rules; conditions and actions; no dry run stated (T23) | Gap: no rule engine in the roadmap; WMS-7 fixes the carrier at pack | adapt: bounded first-match list for pack-time choice, default rule, dry run, under ADR-0006 (A3) |
| 3 | Auto-print waybill by rule | Toggle on the rule (T23) | INT-8 labels; WMS-7 labels at pack (ADR-0014) | yes: print on pack, triggered by a rule |
| 4 | Bulk ship and bulk hide | Select orders, ship or hide (T26) | WEB-5 orders list; DEL-3 import | yes, as a WEB-5 scope note; no new order |
| 5 | Locked fields after creation | Payment method and price locked; change means a new order (T26) | DEL-2 transitions with `If-Match` (§1.2); lock list not written | yes: name the locked fields in DEL-2 |
| 6 | Soft hide of an order | Hide flag with filter (T26) | DEL-2 cancel and transitions | no: a second state beside cancel adds nothing |
| 7 | Store order sync | Manual sync; success message (T25) | INT-11 intake and reconcile (ADR-0013) | already: INT-11 covers intake and reconcile on a schedule |
| 8 | Store connections | Salla, Zid, Shopify, WooCommerce, Magento, Zapier (T16, T32, T33, T35, T37) | INT-11 (Salla, Zid); INT-12 publish | yes for connect and reconcile; no for the WooCommerce password pattern (A7) |
| 9 | Public tracking lookup | By AWB, order ID or phone (T8) | DEL-8 token; WEB-8 `/track/[token]` | already stronger: token. no for phone lookup (exposes personal data) |
| 10 | Branded tracking page | Store logo (T1, T32) | WEB-8, no branding setting | adapt: account logo setting, Arabic and English (ADR-0016) (A4) |
| 11 | Stage notifications | SMS at each stage (T1) | INT-3, INT-7: approved WhatsApp templates, opt-out, caps (ADR-0037, ADR-0041) | already: templates, opt-out and budgets; Torod names no consent model |
| 12 | Returns and exchange portal | Portal with reverse label; returned leg keeps order number (T1, T27, T32) | DEL-18 backend; WMS-8; no recipient page | adapt: recipient return request by token (A5), after Q-4; yes for the returned leg keeping the parent id |
| 13 | COD status ladder | Under review, collected, transferred (T24) | DEL-7 collections; DEL-11 custody (ADR-0007) | yes, status words as a merchant view; transfer step does not apply (inferred) |
| 14 | COD statement search | By customer, tracking, order (T24) | WEB-10 cash desk is staff-only | yes: merchant COD statement (A6) |
| 15 | Remittance schedule, paid instant transfer | Plan schedule; commission for instant transfer (T2, T9) | DEL-12 deposits and handovers (ADR-0007) | no: a pay-out schedule assumes the platform holds merchant money; ADR-0007 uses handover custody |
| 16 | Prepaid wallet and refund rules | Wallet pays shipping; refund only on closure (T9) | Gap: no billing or wallet in the roadmap | no for now: owner decision (section 7, U21) |
| 17 | Plans and seats | 5 seats on Free; unlimited paid (T2) | PLAT-7 audit; identity ADR-0023 | no: seat caps are pricing |
| 18 | Fulfilment: receive, store, pick, pack, live stock | Full fulfilment, branded packaging, live stock (T5) | WMS-1 to WMS-7; INT-12 one-way publish (ADR-0013) | already in scope; live stock matches INT-12 |
| 19 | Shipment types | Normal, quick, PUDO, cold, pallets, docs, heavy (T2) | No type on the order; no cold chain | adapt: type enum on the order when the owner asks for cold or pallets |
| 20 | Per-city rate card | Flat per-city rates across couriers (T2) | DEL-1 zones with polygons; no price per zone | adapt if the owner sets a merchant price; no for carrier pricing (ADR-0001) |
| 21 | Carrier and city performance | Analytics by carrier and city (T1) | DEL-17 scorecards (Q-32 open) | yes: zone and carrier cuts in DEL-17 (A2) |
| 22 | Public API resources | Order, shipment, warehouse as separate resources (T28) | INT-9 orders and tracking; WEB-16 keys; OPS-7 docs; sites (ADR-0018) | yes: split resources; warehouse maps to a site (A1) |
| 23 | Order then shipment | Order assigned to a courier becomes a shipment (T28) | DEL-2 order; WMS-7 package; INT-8 shipment at pack | already, and stronger: measured weight comes first (ADR-0014) |
| 24 | Webhooks | Listed; no public spec (T1, T22) | INT-10, Standard Webhooks signing (ADR-0040) | already: specified, signed, retried; Torod's spec not public |
| 25 | Reseller API for platforms | "Torod for Platforms" IaaS (T40) | None; INT-9 serves merchant integrators; tenancy per account (ADR-0025) | no for now: reseller tier not in the roadmap (U17) |
| 26 | Carrier partner onboarding | API, dashboard, analytics for carriers (T11) | INT-8 carriers via Eeasy shipping (ADR-0014) | no: carrier partners belong to Eeasy shipping (ADR-0001) |
| 27 | Bring Your Own Contract | BYOC row, values missing (T2) | No own-carrier path; own fleet only (ADR-0005) | no for now; check the row before deciding (U9) |
| 28 | GCC and cross-border | Pro only; Taraod International (T1, T2) | KSA scope (ADR-0002); Gulf-region host (ADR-0022) | no for now: later decision (inferred) |
| 29 | Packaging store | Sells packaging (T29) | None | no: outside the product |
| 30 | Customer delivery date | Expected arrival on tracking (T1) | No ETA; INT-6 per-stop ETA in wave 2 | adapt: show INT-6 ETA on WEB-8 once wave 2 lands |
| 31 | Merchant mobile app | None found (T1, [S]) | Web for merchants (WEB-*); driver app (DRV-*, ADR-0004) | no: not Torod's surface to copy |

## 6. Proposed order amendments and new orders

Ids follow the roadmap rule that numbers are not reused; the lead assigns new ids. Seven changes and one owner question, within the limit of eight.

- **A1. Amend INT-9 (adapt).** Name the resources: orders; shipments (list, track, cancel before pickup); warehouses (pickup sites, ADR-0018). Evidence: T28, T1.
- **A2. Amend DEL-17 (adapt).** Add cuts by carrier, zone and city, and driver, with on-time and failed-attempt rates. Evidence: T1. Q-32 stays open.
- **A3. New integration order, pack-time carrier and label rules (adapt).** Ordered first-match rules on zone, weight band, COD flag and shipment type; actions choose own fleet or an INT-8 carrier option, and auto-print the label; default rule; dry run on one day's orders; behind the ADR-0006 allowlist. Depends on INT-8 and WMS-7. Never prices carriers (ADR-0001, ADR-0014). Evidence: T23.
- **A4. Amend DEL-8 and WEB-8 (no for phone lookup; adapt for logo).** Public tracking by token only, no lookup by phone or order number. Account logo setting, Arabic and English. Evidence: T8, T1, T32.
- **A5. New delivery order, recipient return request by token (adapt).** Recipient requests a return or exchange from the tracking page; the return leg keeps the parent order id; message through an INT-3 template. Depends on DEL-8, DEL-18 and Q-4. Evidence: T1, T20, T27.
- **A6. New web order, merchant COD statement (adapt).** Read-only view built from DEL-7 and DEL-11 ledger events, with statuses under review, collected, handed over and reconciled; search by customer, tracking number and order number; from projections (ADR-0011). Evidence: T24.
- **A7. Amend INT-11 (no for the password pattern).** No connector asks the merchant for a platform password; platform install or OAuth only. Evidence: T35; ADR-0013, ADR-0023.
- **Q1. Owner question, not an order.** Does eeasy-logistics charge merchants (per delivery, per seat or per plan)? Torod's plans are a reference (T2, T3). No billing order exists in the roadmap.

## 7. Unanswered (owner questions)

- **U1. Torod API operations.** Methods, paths and auth are unverified: the docs operation list did not load (T28); the homepage says `/v1/shipments` (T1); the third-party copy says `/orders` (T38). Owner: request a partner account or the Postman collection (T22, T28)? The research did not contact Torod.
- **U2. Webhooks.** Events, payload, signing, retries and health states are not documented in any readable page (T1, T22).
- **U3. Rate limits, versions, sandbox.** Not found (T38, T28).
- **U4. COD fees.** Instant-transfer amounts and any COD percentage are not published (T2, T3, T9).
- **U5. COD timing.** One-week grace after collection (T24) against the plan schedule (T2, T9).
- **U6. Plan names and annual prices.** Homepage: "Plus" and "Pro", 2,100 and 4,188 SAR a year (T1). Price pages: "Premium" and "Pro", no annual figure (T2, T3).
- **U7. Carrier count.** 240+ (T1), 260+ (T4), 200+ (T32), 160+ (T40, Jan 2023), "230 other" (T1). Current figure unknown.
- **U8. Company facts.** Founded 2021 (T46) or early 2022 [S]. Series A SAR 42M on 11 Feb 2025 with five named investors and no lead stated (T45); a search summary of a 403 page says pre-Series A led by Wa'ed and Elm (T47 [S]). Seed: SAR 5M led by Impact46, June 2022 (T45) or $1.33M (T48 [S]).
- **U9. BYOC.** Whether merchants can connect their own courier contracts, and how COD settles for them, is unknown; search found nothing. This is the closest Torod comes to our own-fleet case, so it matters for ADR-0005.
- **U10. Ratings.** Salla: 3.86 from 28 in the structured data, "Reviews (0)" on the page (T32). WooCommerce: 3 reviews, one "No Support!" about a billing-city field (T35). Shopify: one 5-star review, 16 Mar 2024 (T33, T34 [S]). Too thin to rate service.
- **U11. WooCommerce status.** A locale page says the plugin was closed on 3 Dec 2025 pending review (T36 [S]); the English page shows an update on 25 May 2026 (T35).
- **U12. Currency.** USD fees on Shopify (T33); SAR on the homepage (T1).
- **U13. Zid and marketplaces.** No Torod Zid App Market listing found (T49, T51 [S]); no evidence of Amazon or noon integration [S].
- **U14. Licence.** Help centre claims a Communications Authority licence [S]; the article was not opened. Whether COD custody needs a separate licence was not researched.
- **U15. Legacy waybill flow.** Is the how-it-works flow (T7) still live?
- **U16. Stack.** Only the WordPress plugin (PHP 7.4+, T35) and the docs platform (T28) give hints. Careers: "We're not hiring at the moment" (T13). Job search found nothing.
- **U17. Reseller tier.** Is "Torod for Platforms" sold today, and on what terms? The Jan 2023 post is the latest source (T40).
- **U18. Automation triggers and carrier logic.** Not documented (T23).
- **U19. Tracking response.** What the public page returns (status steps, ETA, proof of delivery) is not shown (T8).
- **U20. Merchant app.** No iOS or Android merchant app found [S]; confirm on both stores before the teardown says so.
- **U21. Our pricing.** Owner decision on merchant billing (Q1, section 6).

## 8. Source registry

Method: [F] pages were fetched or checked on 2026-11-02. [S] marks search summaries or pages that did not open. Repo documents were read at `origin/main` `1e0c184` unless named.

**Torod-owned pages**
- T1 https://torod.co (Arabic homepage) [F]
- T2 https://torod.co/en/price [F]
- T3 https://torod.co/ar/price [F]
- T4 https://torod.co/en/services/torod-system [F]
- T5 https://torod.co/en/services/fulfilment-warehousing [F]
- T6 https://torod.co/en/about-us [F]
- T7 https://torod.co/en/how-it-works [F]
- T8 https://torod.co/en/track [F]
- T9 https://torod.co/en/terms-and-conditions (Arabic clauses quoted in translation) [F]
- T10 https://torod.co/en/privacy-policy [F]
- T11 https://torod.co/en/services/join-as-shipping-company [F]
- T12 https://torod.co/en/services/shipping-company-licenses [F]
- T13 https://torod.co/en/support/career [F]
- T14 https://torod.co/en/ (logos, testimonials, mockups) [F]
- T15 https://help.torod.co/support/home (folder titles) [F]
- T16 https://help.torod.co/ar/support/solutions/folders/10000022948 (store connection; titles) [F]
- T17 https://help.torod.co/ar/support/solutions/folders/10000022949 (orders; titles) [F]
- T18 https://help.torod.co/ar/support/solutions/folders/10000022947 (wallet; titles) [F]
- T19 https://help.torod.co/ar/support/solutions/folders/10000022962 (automation; titles) [F]
- T20 https://help.torod.co/ar/support/solutions/folders/10000022953 (returns; titles) [F]
- T21 https://help.torod.co/ar/support/solutions/folders/10000022950 (shipping and waybills; titles) [F]
- T22 https://help.torod.co/ar/support/solutions/articles/10000017389 (API connection; body) [F]
- T23 https://help.torod.co/ar/support/solutions/articles/10000017416 (automation; body) [F]
- T24 https://help.torod.co/ar/support/solutions/articles/10000017387 (cash on delivery; body) [F]
- T25 https://help.torod.co/ar/support/solutions/articles/10000017394 (order sync; body) [F]
- T26 https://help.torod.co/ar/support/solutions/articles/10000017395 (create and edit orders; body) [F]
- T27 https://help.torod.co/ar/support/solutions/articles/10000017409 (shipment status; body, no status list) [F]
- T28 https://docs.torod.co/ (developer guide intro; operations not loaded) [F]
- T29 https://api.torod.co/en/about-us [F]
- T30 https://api.torod.co/docs/ and https://api.torod.co/v1/ (HTTP status and redirect via curl) [F]

**Store, platform and listing pages**
- T31 https://help.salla.sa/en/article/torod-shipping-delivery-app/hzzb4qli47yz57ftjcixgrgz (Arabic version on help.salla.sa) [F]
- T32 https://apps.salla.sa/en/app/895627836 [F]
- T33 https://apps.shopify.com/torod?locale=ar [F]
- T34 https://apps.shopify.com/torod/reviews [S]
- T35 https://wordpress.org/plugins/torod/ [F]
- T36 https://me.wordpress.org/plugins/torod/ (closure note) [S]
- T37 https://zapier.com/apps/torod/integrations [F]
- T38 https://jentic.com/apis/torod.co/torod and https://raw.githubusercontent.com/jentic/jentic-public-apis/f9bf8feb51f1b24eb18b984d12bb545ec2f5d022/apis/openapi/torod.co/main/1.0.0/openapi.json (third-party copy) [F]
- T39 https://lite.torod.co/api.php (did not resolve on 2026-11-02) [S]
- T49 https://help-partner.zid.sa/en/articles/15544622-guide-to-integrating-shipping-systems-with-the-zid-platform [S]
- T50 https://commercemarketplace.adobe.com/torod-module-torod-shipping.html [S]
- T51 https://help-partner.zid.sa/en/articles/8637270-create-a-shipping-app-or-fulfillment-app [S]

**Blog, news and funding**
- T40 https://blog.torod.co/en/torod-launched-their-new-shipping-product-shipping-infrastructure-as-a-service-iaas-for-platforms-makane-and-torod-signed-a-strategic-partnership-to-provide-shipping-solutions-for-online-stores/ (24 Jan 2023) [F]
- T41 https://blog.torod.co/en/the-shipping-service-platform-torod-enters-a-strategic-partnership-with-dal-stc-channels-to-support-the-logistics-services-sector-in-saudi-arabia/ (21 Dec 2022) [F]
- T42 https://blog.torod.co/en/?p=1356 (MYCN; 25 Dec 2022) [F]
- T43 https://blog.torod.co/en/?p=1075 (COD article; 17 Nov 2022) [F]
- T44 https://blog.torod.co/en/?p=1596 (NCPD; 13 Dec 2022) [F]
- T45 https://bridgemena.com/news/torod-secures-42-million-sar-in-series-a-funding-round (11 Feb 2025) [F]
- T46 https://en.sharikatmubasher.com/news/article/21468640/Torod-introduces-comprehensive-logistics-solutions-at-LEAP-2025?companyNews=0 (13 Feb 2025) [F]
- T47 https://yespress.io/torod (HTTP 403; search summary) [S]
- T48 https://www.wamda.com/en/2022/06/torod-raises-1-33-million-seed-round-led-impact46 [S]

**Repo documents**
- R1 `docs/roadmap.md` §1.2 to §1.5 and §5 (A-22)
- R2 `adr/0001-standalone-product-separate-from-eeasynew.md`; `adr/0005-own-fleets-only.md`; `adr/0014-carrier-shipments-at-pack-time-via-eeasy-shipping.md`
- R3 `adr/0002-scope-last-mile-and-wms.md`; `adr/0004-new-driver-app.md`; `adr/0006-allowlist-rollout-with-provisioning-door.md`; `adr/0007-driver-cash-custody-logestechs-model.md`; `adr/0011-stock-as-double-entry-ledger.md`; `adr/0013-one-way-channel-stock-sync-via-outbox.md`
- R4 `adr/0016-arabic-and-english-everywhere.md`; `adr/0018-one-sites-concept.md`; `adr/0022-containers-on-gulf-region-host.md`; `adr/0023-own-identity-no-eeasy-dependency.md`; `adr/0025-tenancy-by-account-id-enforced-structurally.md`
- R5 `adr/0037-messaging-templates-only-no-sms-before-wave-3.md`; `adr/0040-standard-webhooks-signing.md` (supersedes ADR-0030); `adr/0041-messaging-through-the-eeasy-whatsapp-engine.md`
- R6 census (branch `docs/ksa-platform-census`, Torod row; Unanswered 1); ShipHero teardown (branch `docs/shiphero-teardown`, shape only)
