# Logestechs teardown, 2026-11

Date: 2026-11-02 (all reads on this date unless marked). Branch `docs/teardown-logestechs` from `origin/main` at `1e0c184`. Author: researcher agent for the lead.
Scope: product anatomy of Logestechs for the owner's question (features, how each works, how it is built, what to borrow). Mapping and shape only. The public API is already censused in `docs/references/logestechs/public-api.md` (2026-10-31, on `origin/main`); this note cites it (P1) and adds only what it does not hold. Shape reference: `docs/research/shiphero-teardown-2026-11.md` (branch `origin/docs/shiphero-teardown`).
Roadmap basis: `docs/roadmap.md` §1.2 to §1.5 (order ids). Decisions: `adr/` at the repo root.

Grades: **[F]** page fetched and read on 2026-11-02. **[S]** search-result summary only, page not opened or not fetchable. **[I]** my inference from a stated fact. **[C]** company claim with no independent evidence. Source IDs (L, A, S, D, X, Z, P, R) map to the registry in section 8. Marketing pages show "0%" placeholder metrics on several module pages; I do not cite those numbers.

## Summary for the lead

1. Logestechs is a cloud logistics suite (delivery operations, WMS, order management, transport, returns, accounting, reports) sold to Arabic-speaking delivery companies and e-commerce sellers. Its contact page names a Riyadh headquarters and an Amman office (L13, F). Founding year and funding are not settled (section 7).
2. KSA evidence is the company's own marketing: Arabic site, +966 contact, Saudi couriers as integrations (SMSA, Aramex, J&T, Naqel, SPL), Saudi payment rails, a Saudi national-address claim, and named testimonials from Saudi delivery firms (L1, L2, L3, L11, D5). No volumes, prices or independent reviews were found.
3. Pattern to borrow 1, the integration key: one `X-API-Key` per customer account, issued by a company admin, shown once, regenerable or disableable, with no portal login needed (D3, F). It matches the INT-9 key shape.
4. Pattern to borrow 2, intake approval as states: a shipment waits for "customer-care approval", then dispatcher assignment; cancel is allowed only before pickup; approval can fail, postpone or return (D2, D4 schema names, F). It maps to DEL-2 "receive as pending" and to Q-6.
5. Pattern to borrow 3, exchange as shipment kinds: `SWAP` and `BRING` carry two money fields, amount to collect from the receiver and amount to pay the receiver (D5, F). It is a concrete shape for the open Q-4 (exchange as one order).
6. Stronger 1, webhooks: Logestechs sends the configured password in five headers (`Authorization`, `api_key`, `ApiKey`, `api-key`, `x-api-key`), sends no signature, never retries, and puts the driver phone and a delivery `pinCode` in the payload (D4, F; P1 agrees on the retry point). ADR-0040 signs and retries, and INT-4 carries ids only.
7. Stronger 2, COD custody: the public pages describe COD only as "reconciliation of COD payments" and a COD line in a dashboard image (L9, L4, F). They show no custody chain, no settlement batch and no deficit ledger. ADR-0007 credits Logestechs with those; see section 7, item 1, before we rely on that citation.
8. Stronger 3, stock: the WMS page names inventory, low-stock alerts and picking as claims with no bin, lot or wave mechanism (L5, F). Our stock is a double-entry ledger with invariants (ADR-0011, WMS-3). ADR-0011 also says "Logestechs has no WMS"; the current site lists one (L5), so that sentence needs correcting.
9. Market fit: Logestechs integrates with Salla, Zid, Shopify, WooCommerce and Magento (L3, F). Its Shopify app is free to install, charges carrier fees per shipment, and has zero reviews (S2, F). No Salla app listing was found (T1, S). INT-11 covers Salla and Zid intake; the gap in our roadmap is a bulk shipment-creation and tracking-link surface, not the connector itself.
10. Evidence limits: the API and Shopify listings were read in full; the product pages are thin (claims, few mechanics); the admin portal is behind a login (X1 only shows the shell). Capterra and G2 returned 403 on 2026-11-02, so no review data beyond two driver-app ratings.

## Method and limits

- Marketing and module pages: WebFetch, 2026-11-02; several state features only, marked "claim only". API: Apidog docs as per-endpoint Markdown and `llms.txt` (D2 to D6). App listings: Apple and Shopify, 2026-11-02. Stack: public headers and HTML generator tags only (H1).
- No logged-in access. The admin portal and the partner screens were not used.
- A search-only fact is marked [S]. A login-gated item is listed in section 7.

## 1. Product map

"Web" is the merchant or company dashboard; "Driver app" is the LogesTechs Driver app (A1), "Shopify app" is S1/S2, "API" is the public docs (D1 to D6). "Claim only" means the page names the feature without a mechanism.

### 1.1 Delivery management (DMS)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Pickups and deliveries | Page says it manages requests and "boosts delivery speed"; no steps given. Intake through API or Shopify app; shipment statuses run from pending customer-care approval to dispatcher assignment, out for delivery, delivered, postponed, returned. | Web, API | L4 (claim only); D2 (cancel rule), D4 (status names) |
| Intake approval states | Schema names `PackageApprovalFail`, `PackageApprovalPostpone`, `PackageApprovalReturn` exist. Cancel is allowed only while "pending customer-care approval or dispatcher assignment"; later stages go through the help centre. | Web, API | D2 (llms.txt index, cancel summary); schema names in D2 |
| Shipment types | `shipmentType` enum: `COD`, `REGULAR`, `SWAP`, `BRING`. `cod` includes delivery cost. `SWAP` and `BRING` take `toCollectFromReceiver` and `toPayToReceiver`. | API | D5 (schema) |
| Address resolution | A shipment names a village, city or region by id or by exact English or Arabic name; ids are filled in automatically; a village name shared by two cities needs a city or `cityId` sent with it. | API | D5 (schema text) |
| Delivery pricing | Cost is calculated from the customer's own rate table, by origin and destination region, village, parcel type, service type, vehicle type, weight and distance. `customerId` in the body is ignored. | API | D2 (endpoint summary); P1 §4.1 (fields) |
| Service, vehicle and parcel types | Per company, each with an id and a name in the request's language. Shipment fields accept those ids. | API | D2 (endpoint list); D5 |
| Failure and follow-up | Schema names `PackageFailure`, `DriverFailFollowUp`, `CodChangeRequest`. How the flow runs is not described. | API | D2 (schema index) |
| Dispatch and drivers | Driver portal to monitor and assign drivers and vehicles; driver ETA. | Web | L7 (F) |
| Hubs | "Manage Multiple Hubs" and a Hubs report, no mechanism given. | Web | L4, L10 (claim only) |
| Route optimisation | Listed as a driver-app feature and as a page feature; no method. | Driver app | Z1 (directory), L4 (claim only) |
| Recipient messages | Message providers named (WhatsApp, MSEGAT, Twilio, Gateway API, HotSMS, OurSMS, and others); what they send is not stated. | Integrations | L3 (F) |
| Delivery PIN | `pinCode` field in the status webhook, "if applicable". Use is not described. | API | D4 (F) |

### 1.2 Driver and handler app

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Listing | "LogesTechs Driver", free, English and Arabic, iPhone and iPod touch on iOS 15 or later; version 2.5.5 is the latest listed, dated 15 October (2025, inferred from the version history). | iOS | A1 (F) |
| Tasks in the app | Arabic description, in English: receive load requests, load, zone-based sorting, deliver, return, postpone, add comments; barcode scanning throughout. | Driver app | A1 (F) |
| Proof and signature | Listed in the directory as "Proof of Delivery"; the store description does not mention POD or COD. | Driver app | Z1 (directory), A1 (absence noted) |
| Pending shipments | Version 2.5.2 (15 September) added a sender pin location on the Pending Shipments screen. | Driver app | A1 (F) |
| Privacy label, ratings | "Data Not Collected" (developer-declared, not verified by Apple); 3.0 from 2 ratings; no written reviews. | Driver app | A1 (F) |
| Warehouse "handler" app | Separate handler app for receiving and sorting, barcode reading, reconciliation and driver coordination, iPhone and Android. | Warehouse app | L5 (claim only) |

### 1.3 Warehouse management (WMS)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Inventory control | "Precise inventory control"; demand forecasting and low-stock alerts, named without method; SKU movement report. | Web | L5 (claim only), L10 |
| Receiving and sorting | Named in the handler app; putaway not mentioned. | Handler app | L5 (claim only) |
| Storing, picking, packing | Named as goals; no bin or location model, wave, batch or pick path. | Web, handler app | L5 (F: "No bin or location model is described") |
| Barcodes and tracking | Printable barcodes, barcode recognition at all touchpoints including returns. | Handler app | L5 (claim only) |
| Products and lots | API schema names: `Product`, `ProductVariant`, `ProductVariantOption`, `ProductExpiryBatchLot`. Stock behaviour is not documented. | API | D2 (schema index) |
| Inbound-outbound report | Balances inbound and outbound flow to avoid overstock. | Web | L10 (F) |

### 1.4 Order management (OMS)

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Order intake | Consolidates orders from stores, marketplaces and social media; "automate the entire workflow from order reception to delivery"; no mechanism. | Web, API, Shopify app | L6 (claim only), L12 (claim only) |
| Shopify connector | Creates shipments from store orders without re-entering customer data; bulk label print; tracking history in the order; product sync; stock alerts and adjustments; SKU mapping; returns and prepaid returns; tracking page; automatic routing of new orders to linked accounts by destination country. | Shopify app | S2 (F), S1 (F) |
| Data the Shopify app reads and writes | Reads customer name, email, phone, address, device and activity data (geolocation, IP, browser); edits fulfilments, products and collections; reads order history for the last 60 days. | Shopify app | S2 (F), S1 (F) |
| Shipping calculator, recipients | Quote a delivery price without calling the company; basic recipient records "to build loyalty". | Web | L6 (claim only) |
| Payments and wallets | Pre-paid wallets for transactions between merchant and courier; barcoded invoices to verify payments. No COD settlement described. | Web | L6 (F), L3 |
| Blacklists | Named ("Black Lists"); no criteria, no scoring. | Web | L6 (name only), L2 (name only) |
| Returns in order | Returned items, exchanges, partial and failed deliveries handled from one screen with live notifications. | Web, mobile | L6 (claim only) |

### 1.5 Transport and hubs

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Fleet | Vehicle details including licensing and location. | Web | L7 (F) |
| Cross-docking | Transfers of a parcel between drivers on complex routes. This is the only transfer described; hub-to-hub transfer is not. | Web | L7 (F) |
| Line haul | "Line Haul Management for inter-branch transport" in the article list; no mechanism. | Web | L11 (claim only) |

### 1.6 Returns

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Return routes and states | Buy online and return in store; self-return; drop-off points; courier pick-up; bundle returns; states in transit, under inspection, restocked; reconciled as refund, store credit or exchange. | Web, storefront | L8 (F, claim) |
| Return to sender | `PUT /packages/return` only for a package already out for delivery; note, reason key, cost-paid flag, delivery proof URLs. | API | P1 §4.1 (read 2026-10-31; re-checked in D2 index) |

### 1.7 Accounting and reports

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Invoicing | Send invoices and automated payment reminders. | Web | L9 (F) |
| Tax | VAT added to invoices and tax numbers printed; a link to a government platform ("Tarweej") is claimed. No ZATCA e-invoicing named on the accounting page. | Web | L11 (claim only), L9 (F: no ZATCA) |
| COD | "Comprehensive reconciliation of COD payments throughout the entire cycle"; COD fees calculated automatically. | Web | L9 (claim only), L11 (claim only) |
| Expenses, cash, fees | Expense categories; bank reconciliation; cash-flow view; storage, cancellation and damaged-item fees; fees per customer or payment method. | Web | L9 (F) |
| Reports | SKU movements, inbound-outbound, low stock, hubs, 3PL partner performance; export "to other platforms"; no formats named. | Web | L10 (F) |

### 1.8 Platform, integrations and security

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Commerce connectors | WooCommerce, Salla, Zid, Ordable, Shopify, Magento, Expand Cart, Matjrah; "Request Integration" for others. Method (app, API, plugin) not stated. | Integrations | L3 (F) |
| Carriers | SMSA, Aramex, Torod, J&T, Naqel, SMB Express, Bosta, iMile; GPS providers Gurtam, Traklink and Saudi Tracking Solutions. | Integrations | L3 (F) |
| Payments | STC Pay, ClickPay, InterPay, NearPay, Apple Pay, Stripe. | Integrations, payment types | L3 (F), D5 (F) |
| Addresses | Saudi National Address, What3Words, Google Maps. | Web, admin | L3 (F), X1 (F: map libraries) |
| Lockers, sensors, ERP | Omni Llama and RedBox lockers; Wasslz sensor; Odoo. | Integrations | L3 (F) |
| Hosting and access | Article claims Saudi-hosted servers; privacy policy names no hosting, region or sub-processor (L11 claim, L14 F). Admin portal is a login page; company admins create API integrations under "Partners". | Platform, web | L11, L14, X1, D3 |

## 2. Public signals about the company

| Item | Reading | Grade | Source |
|---|---|---|---|
| Headquarters | "Innovation Tower, KACST, King Abdullah Road, Riyadh, KSA"; Amman office; Shopify developer address Ramallah. | F | L13, S1, S2 |
| Founding year | 2018 (CB Insights, G2), 2019 (Bouncewatch), 2020 (MWC Doha exhibitor). | S | W1, M1 |
| Funding | $750k seed round, 2022-06-17 (Bouncewatch); $100k from Taqadam cohort 7, March 2024 (company page dated 2024-09-18). The Taqadam post names no currency. | S (seed); F (Taqadam) | W1, L15 |
| Accelerators | Misk Launchpad and Misk Accelerator (cohort 4, 2023); TASMU (Qatar, February 2024); Taqadam cohort 7. | F (company interview) | L16 |
| Founder | Dr. Majdi Mafarja, founder and CEO (interview 2024-11-26); product built from one local parcel-delivery company's requirements. | F (interview) | L16 |
| Scale | "Hundreds" of logistics users; "millions of shipments" and "tens of thousands of merchants" (exhibitor summary). No figure on the company's own pages. | F ("hundreds"); S (millions) | L2, M1 |
| Customers named | Collect+, National Express Delivery Company, Planex, Delivery Point, Wheel, Send Logistics (testimonials). | F (company marketing) | L1, L2 |

## 3. API and integration anatomy

Full endpoint table, schemas, error shape and status vocabulary are in P1; this section adds what P1 does not hold.

### 3.1 Shape

- One API, `https://apisv5.logestechs.com/api`, every path under `/secure/integration/`. The base returns HTTP 401 JSON to a request with no key (H1, F).
- Docs are an Apidog-generated site (`docs.logestechs.com`, OpenAPI 3.0.1 per page, `llms.txt` index, "Packages" and "Addresses" sections; D1, D2). Each endpoint page is also served as Markdown with an OpenAPI fragment (D5, F).
- One production server is listed. No sandbox base URL is documented (D5, F; P1 §13).

### 3.2 Authentication and key lifecycle

| Point | Reading | Source |
|---|---|---|
| Header | `X-API-Key: psk_integration_…` (the docs' example prefix). | D3 (F) |
| Scope | One key per customer account; the key sees only that customer's packages, even inside the same company. | D3 (F) |
| Issue | A company admin creates the integration under Partners > API Integrations; the full key is shown once; afterwards it can only be regenerated. | D3 (F) |
| Control | Regenerate, disable or delete at any time, independent of the customer's portal password. | D3 (F) |
| Expiry, scopes, rate limits | Not stated; company and customer come from the key, and a company-id header is ignored. | D2, P1 §7; D6 (F) |

### 3.3 Webhooks

| Point | Reading | Source |
|---|---|---|
| Trigger | Each status change of a package assigned to the integration (created, cancelled, returned, delivered, postponed, others). | D4 (F) |
| Where set | Webhook URL, username and password set once per integration; a create request may also send `webhookUrl` for one package. | D4 (F), D5 (F) |
| Auth | Password sent as the value of five headers: `Authorization`, `api_key`, `ApiKey`, `api-key`, `x-api-key`. Username sent as `username` and `account_name`. | D4 (F) |
| Signature | None described. | D4 (F) |
| Retries | "Fire-and-forget"; no retries; any 2xx acknowledges. Reconcile with the status endpoints if one is missed. | D4 (F); P1 §8 |
| Payload | `packageId`, `barcode`, `invoiceNumber`, `status`, `newStatus`, `cod`, `paymentMethod`, `time`, `notes`, `reason`, `driverName`, `driverPhone`, `signatureUrl`, `postponedDeliveryDate`, `attachmentUrls`, `pinCode`; empty fields omitted. | D4 (F) |
| Event ids, ordering | No event id or sequence number documented. | D4 (F) |

### 3.4 Other surfaces

- Create shipment: `receiverName`, `receiverPhone`, `shipmentType`, `cod`, `paymentType` (22 enum values, from `CASH` and `MADA` to `ORANGE_MONEY`, `DINARAK`, `ARAB_BANK`), `paymentTypeId` for custom types, `parcelTypeId`, `serviceTypeId`, `vehicleTypeId`, `webhookUrl` (D5, F). The 200 response has no documented body (D5; P1 §13).
- No idempotency key is documented for create (D5, F; search of all pages for "idempot", "429", "rate limit" found nothing).
- Status: `GET /packages/status` returns a string map; history returns ordered records; AWB PDF for up to 100 identifiers per call (P1 §4.1; D2).
- Shopify app: an installed app with Shopify's order and product scopes (S1, S2, F). Sync direction and conflict rules are not described.

### 3.5 How it is built (observed)

| Surface | Observation | Grade | Source |
|---|---|---|---|
| Marketing site | WordPress with Elementor 4.3.5, WPBakery, Slider Revolution, WPML 4.7.6 (Arabic and English), Google Tag Manager, HubSpot. | F | L1, L2, H1 |
| Origin | PHP 8.2.35 on the marketing site; Cloudflare in front of the marketing site and the API. | F | H1 |
| Admin portal | Static single-page bundle on Amazon S3 (server header `AmazonS3`), with hashed `polyfills`, `runtime` and `main` files (the Angular CLI pattern, inferred); Leaflet, Esri Leaflet and its geocoder, Leaflet.draw, Turf.js and What3Words scripts. | F (files), I (framework) | X1 |
| Docs host | Apidog-generated site, served through OpenResty. | F | D1, H1 |
| Driver app | Native iOS app; bundle and framework not visible. | F (listing) | A1 |

## 4. Operational model

### 4.1 Tenancy and roles

- Three layers: the company (the operator), its customers (merchant accounts), and each customer's integrations and keys (D3, D5, P1 §9.3). Each customer has its own rates, service types, parcel types, address book and payment types (D2, D5, F).
- Named roles in public text: company admin (keys, integrations, Partners menu; D3); customer care (approval of pending shipments; D2); dispatcher (driver assignment; D2); driver and handler (A1, L5); 3PL partner (L10, L3). A customer portal with its own password exists (D3, F).
- Isolation claim: a key cannot see another customer's data "even within the same company" (D3, claim).
- Localisation: names match English or Arabic exactly (D5); status labels come in both languages (D6); parcel-type names follow the request's language header (D2).

### 4.2 Billing

- Pay-as-you-go (L2 "pay-as-you-go pricing"; L1 "pay-per-use"; both F). No amounts on any page read (F).
- Customisation "for a fee" and implementation "1 to 4 weeks" (L1, L2; F).
- Trial: "free 45-day trial with no payment required, after booking a demo" (search summary only; S).
- Customer-specific delivery rates drive every shipment cost (D5, D2; F). The rate-card model is not described beyond that.
- Shopify app: "Free to install"; carrier per-shipment fees in USD charged by the shipping company (S2, F).
- Zoftwarehub lists "pay-as-you-go" and "Per User Per Month" together, so the model is unclear (Z2, S).

### 4.3 Automation and rules

- Address auto-fill from the name or id given (D5, F).
- Automatic routing of new Shopify orders to linked accounts by destination country (S2, F).
- Auto-print of labels for many orders in one action (S2, F).
- No public rules engine, approval rules or allocation logic is described. Claims of "dynamic routing" and "AI" have no mechanism (L12, L1; claim only; L16 gives AI as a general aim).

### 4.4 Exceptions and returns

- Cancel before pickup only; return only when out for delivery (D2, P1 §12; F).
- Failed attempts and postponements appear as statuses (D4). COD amount rides on each status event; COD change requests are a schema name only; no custody or settlement flow is public (D2, D4, L9).

## 5. Mapping to eeasy-logistics

"Today" cites the roadmap id, ADR or domain section. "Borrow?" is yes with the shape, adapt, or no with the reason and the ADR. These are facts for the lead; decisions stay with the lead.

| Feature | Logestechs | eeasy-logistics today | Borrow? |
|---|---|---|---|
| Integration key | One `X-API-Key` per customer account, admin-issued, shown once, regenerate or disable | INT-9 keys (create, rotate, revoke, per-key usage), ADR-0025 account from token | Yes, with the shape: admin-only issuance screen, one-time reveal, per-account scope. Keep our rotation and usage. |
| Shipment intake approval and cancel | Pending customer-care approval, then dispatcher assignment; approval fail, postpone, return; cancel only before pickup | DEL-2 "receive as pending"; transitions in domain §3.13; Q-6 | Yes, with the shape: approval as a named state before dispatch; cancel only before pickup (already Q-6's line). |
| Address by id or name | Accept ids or exact names in EN or AR; resolve missing ids; a shared village name needs a city | INT-2 geocoder and National Address short codes; DEL-2 geocode at intake | Yes, with the shape: accept ids or names on the API; require a city for a shared village name; keep geocode at intake. |
| Exchange and swap | `SWAP` and `BRING` shipment types with amount to collect and amount to pay the receiver | DEL-18 `exchange`; Q-4 default one order of kind `exchange` | Adapt: take the two money fields as the shape; Q-4 stays open (owner). |
| Return to sender gate | Return only while out for delivery; note, reason key, cost-paid flag | DEL-18 `return_pickup`; WMS-8 returns | Yes, with the shape: the gate as a transition rule; cost-paid flag to be decided with DEL-18. |
| Webhook signing | Static password in five headers; no signature; no retries | ADR-0040 (Standard Webhooks signing, retries, `410`) replaces ADR-0030's headers (roadmap A-20); INT-10 | No. Ours is stronger; use the Logestechs case as a negative test example. |
| Webhook payload content | Includes driver phone, delivery `pinCode`, signature URL, proof URLs | INT-4 push payloads carry ids only; INT-10 subscriptions | No for PII and PIN: ids, status, reason and time only. Yes for the field list of status changes. |
| Per-request callback URL | `webhookUrl` in the create request | INT-10 subscriptions per account; SSRF guard | No, for now: conflicts with per-account subscriptions and the SSRF guard. Needs a new ADR if the owner wants it. |
| Delivery pricing and rate cards | Per-customer rates by region pair, parcel, service, vehicle, weight, distance | No pricing order; Q-33 commercial model; "pricing before wave 2" | Adapt, owner decision first (Q-33). See section 6, item 5. |
| COD custody and settlement | Public pages show reconciliation only; ADR-0007 cites a per-parcel chain, mass settlement report, deficit ledger | DEL-7 COD, DEL-11 custody and liability entries, DEL-12 deposits, ADR-0007 | Already borrowed (ADR-0007). Verify the citation before relying on it (section 7, item 1). |
| Card and wallet payments | 22 `paymentType` enum values and custom payment types | ADR-0017 defers digital COD (owner-gated, tap-to-phone); ADR-0007 `not held` custody | No change now. Use the rails list only as a check for the collection-method enum when ADR-0017 is ruled. |
| Merchant wallet and prepaid | Pre-paid wallets for merchant and courier; Interpay and ClickPay | No wallet in roadmap | No until the owner rules on the commercial model (Q-33) and on a payment provider. |
| Blacklists | Named, no criteria | No order; a customer-risk list is personal data | No yet: needs an owner question and an ADR on personal data before any build. |
| Hubs and line haul | "Multiple hubs", "line haul", hub report; no mechanism | ADR-0018 sites concept; no hub or line-haul order in §1.2 to §1.5 | Adapt: a hub as a site with a transfer; owner question first. See section 6, item 6. |
| Cross-docking | Parcel transfers between drivers | ADR-0007 custody; DEL-6 assignment; no driver-to-driver handoff order | No yet: a handoff is a custody event; any build needs ADR-0007 to say how it moves. |
| Returns variants | Buy online and return in store; drop-off points; courier pick-up; bundle returns | DEL-18; WMS-8 | Yes, later, with the shape: return route as a field on the return. Not in wave 4 scope yet. |
| Invoicing, VAT, ZATCA | Invoices with reminders; VAT on invoices; tax numbers | Not in roadmap; ADR-0002 scope is delivery and WMS | No for now: accounting is outside ADR-0002. Owner question on ZATCA e-invoicing. |
| Reports | SKU movements, inbound-outbound, hubs, 3PL partner performance | DEL-17 SLA and scorecards; WMS-3 ledger reports; Q-32 read-only reports | Yes, with the shape: reports as read-only views over ledgers (Q-32 default). No separate module. |
| Driver app: proof, barcode, bilingual | Barcode scan, POD, Arabic and English | DRV-4 field loop; DRV-2 offline outbox; ADR-0008 offline-first; ADR-0016 Arabic and English | No change. Ours is designed offline; Logestechs' listing shows no offline mode (F, absence only). |
| Driver app privacy label | "Data Not Collected" on an app with POD and a location pin | DRV-3 background location; OPS-3 store declarations | No to copying the label. Our declarations must match what the app collects; a review risk if they do not. |
| Recipient tracking and messages | Not evidenced publicly beyond provider names | DEL-8; INT-3 templates with opt-out and caps (ADR-0037, ADR-0041) | No change; ours is specified. |
| Commerce connectors | WooCommerce, Salla, Zid, Shopify, Magento, others | INT-11 (Salla, Zid); INT-12 channel stock publish | Yes, with the shape: bulk shipment creation from orders, tracking link in order, SKU mapping. See section 6, item 4. |
| Carriers | Eight-plus Saudi carriers as integrations | ADR-0014 and INT-8 (Eeasy shipping API carriers) | No change. Logestechs lists Torod and Bosta, which are aggregator and operator. |
| Maps and addresses | Leaflet, Esri, What3Words in the admin portal; National Address claim | ADR-0033 MapLibre; INT-2 National Address short codes | No change to map library. What3Words is not in our plan; not proposed. |
| Lockers, sensors, Odoo | RedBox, Omni Llama, Wasslz; Odoo | Out of ADR-0002 scope | No. |
| Tenancy by account | Company, customers and keys; isolation claimed | ADR-0025 account from token; ADR-0005 own fleets | No change; ours is structural and stated stronger in ADR-0025. |

## 6. Proposed order amendments and new orders

At most eight items. None is applied; each needs the lead's decision.

1. **Amend INT-9.** Add the key-issue screen contract: admin-only, one-time reveal, regenerate and disable, one key per account, and an address contract that accepts ids or exact names and requires a city for a shared village name (section 5, rows 1 and 4). Source: D3, D5.
2. **Amend INT-10.** Add to the spec and tests that payloads carry ids, status, reason and time and never a phone number, a PIN or a signed document link. Add a test that fails if a delivery payload contains a driver phone. Source: D4 (negative example).
3. **Amend DEL-2.** Name the approval states (pending customer-care approval, approval failed, postponed, returned) and the cancel-before-pickup rule, so Q-6 and the intake rules read as one table. Source: D2, D4.
4. **Amend INT-11.** Add to the Salla and Zid scope: bulk shipment creation from orders, a tracking link on the order, and SKU mapping for stock. Source: S1, S2, L3. Salla listing not verified (T1).
5. **New candidate, DEL-19 customer rate cards and quote.** Per-customer rates by region pair, parcel type, service type and weight, plus a quote endpoint. Blocked on Q-33 (commercial model). Source: D2, D5, P1 §4.1.
6. **New candidate, HUB-1 hubs and line-haul transfers.** A hub as a site (ADR-0018) with transfers between sites and a hub report. Blocked on an owner ruling that multi-hub operation is in scope; ADR-0002 does not name it. Source: L4, L10, L11.
7. **Owner question, exchange shape.** Amend Q-4's proposed default to note the two money fields of `SWAP` and `BRING`, so the owner can choose one order with two amounts or two linked orders knowing what Logestechs does. Source: D5.
8. **Owner question, driver cash evidence.** Not an order. Ask the owner to locate the 2026-09-21 gap-fill research behind ADR-0007, or to commission a login-gated screen census of the Logestechs admin portal, before ADR-0007 is cited again. See section 7, item 1.

Documentation corrections (not orders): ADR-0011 says "Logestechs has no WMS". The current site lists a WMS (L5, F); the sentence should be corrected or qualified by a new ADR, not silently edited.

## 7. Unanswered (owner questions)

1. **ADR-0007's Logestechs citation.** The ADR says Logestechs has a per-parcel COD chain, a "Mass COD report", an append-only deficit ledger and a driver block on prior cash. None of these appears on the public pages read on 2026-11-02 (L9, L4, D4, A1). The original research (eeasynew LM-5, 2026-09-21) is not in this repository. Owner: where is that evidence, and was it from the login-only admin portal?
2. **Admin portal and partner screens.** Login-gated (X1 shows only the shell). Owner: create a demo or trial account for a screen census, or accept the public-only picture.
3. **Pricing.** No amounts on any page read; "pay-as-you-go" and "per user" conflict in directories. Owner: book the demo for a quote and ask for the rate-card model.
4. **Salla integration.** Named on the homepage and integrations page (L1, L3). No Logestechs app listing found on the Salla help or search (T1, S). Owner or the Salla partner portal: is there a live Logestechs app, and how does its order sync work?
5. **Two Shopify listings.** `logestechsmanager` (launched 2024-08-05) and `logestechs-1` (launched 2023-11-08) both name LogesTechs, both have zero reviews, and their features differ slightly (S1, S2). Which is current? Not settled.
6. **Entity and location.** Riyadh HQ (L13) and Ramallah developer address (S1, S2) and Amman office (L13). Legal name and registered address are not stated (L14). Founding year varies from 2018 to 2020 (W1, M1). Owner: which entity would sign a partner or data processing agreement?
7. **Funding.** A $750k seed round (2022, W1, search summary) and the $100k Taqadam award (2024, L15). The seed round is not confirmed on a company page. Not settled.
8. **Driver app privacy label.** Developer-declared "Data Not Collected" on a POD app (A1). Whether the app collects location or signatures is not verified. Our OPS-3 declarations must not copy it.
9. **Driver app maintenance.** Latest listed release is 2.5.5 dated 15 October 2025 (A1). Whether the app is still maintained in 2026 is not visible from the store page (inference from the version history only).
10. **Webhook retries and signing in production.** The docs say none (D4); a live test needs a partner account.
11. **Rate limits and sandbox.** Not stated in any public page (P1 §7, §13; D5).
12. **Carrier exchange network and reseller module.** Named in a search summary of the exhibitor listing (M1, S); the exhibitor page did not open (404 on fetch). Not settled.
13. **Reviews and case data.** Capterra (1020771) and G2 returned 403 on 2026-11-02; no independent review data. The named testimonials are company marketing (L1, L2).
14. **ZATCA e-invoicing.** The article claims VAT and tax-number printing and a government link (L11); the accounting page names no ZATCA (L9). Not settled.
15. **Stack, team and recipient tracking.** No job posts, engineering blog or repository found; team size not stated (L16). The marketing pages show no recipient tracking page or SMS flow; whether one exists is not settled.

## 8. Source registry

All reads 2026-11-02 unless marked. [F] = fetched; [S] = search summary; [I] = inference.

| ID | URL | Date read | Grade | Used for |
|---|---|---|---|---|
| L1 | https://logestechs.com/ | 2026-11-02 | F | Modules, integrations, pricing model, implementation time, testimonials |
| L2 | https://logestechs.com/ar/ | 2026-11-02 | F | Arabic claims, module names in Arabic, pay-as-you-go |
| L3 | https://logestechs.com/integrations/ | 2026-11-02 | F | Connectors, carriers, payments, communications, location, lockers, ERP |
| L4 | https://logestechs.com/delivery-management-system/ | 2026-11-02 | F | Delivery module, driver app feature names |
| L5 | https://logestechs.com/warehouse-management-system/ | 2026-11-02 | F | WMS features (claims) |
| L6 | https://logestechs.com/order-management-software/ | 2026-11-02 | F | OMS features, wallets, blacklists (name) |
| L7 | https://logestechs.com/transport-management-software/ | 2026-11-02 | F | Fleet, cross-docking, live tracking, driver portal |
| L8 | https://logestechs.com/returns-management-software/ | 2026-11-02 | F | Return routes, bundle returns |
| L9 | https://logestechs.com/accounting-management-system/ | 2026-11-02 | F | Invoicing, COD reconciliation claim, warehouse fees |
| L10 | https://logestechs.com/reports-and-analytics/ | 2026-11-02 | F | Report list |
| L11 | https://logestechs.com/best-delivery-software-in-saudi-arabia/ | 2026-11-02 | F (claims) | Saudi claims: National Address, VAT, Tarweej, line haul, wallets, servers |
| L12 | https://logestechs.com/digitizing-e-commerce-logistics/ | 2026-11-02 | F (claims) | Absence of COD and tracking mechanics |
| L13 | https://logestechs.com/contact-us/ | 2026-11-02 | F | Riyadh HQ address, Amman office, phone numbers |
| L14 | https://logestechs.com/privacy-policy/ | 2026-11-02 | F | No legal entity, hosting or retention stated |
| L15 | https://logestechs.com/logestechs-selected-as-top-10-startup-in-taqadam-cohort-7/ | 2026-11-02 (page dated 2024-09-18) | F | Taqadam award, $100k |
| L16 | https://arabfounders.net/interview-with-majdi-mafarja-logestechs-ai-logistics/ | 2026-11-02 (interview dated 2024-11-26) | F | Founder statements, accelerators, module list, AI as aim |
| A1 | https://apps.apple.com/app/id1547993047 | 2026-11-02 | F | LogesTechs Driver: version, languages, privacy label, rating |
| A2 | https://apps.apple.com/sa/app/logistech/id6680198249 | 2026-11-02 | F (excluded) | Different developer (Exactly Trading Company); not Logestechs; not used |
| S1 | https://apps.shopify.com/logestechsmanager | 2026-11-02 | F | Shopify app, launch 2024-08-05, data scopes |
| S2 | https://apps.shopify.com/logestechs-1 | 2026-11-02 | F | Shopify app, launch 2023-11-08, pricing, features, customer data |
| D1 | https://docs.logestechs.com/ | 2026-11-02 | F | Docs overview, Apidog build, sidebar sections |
| D2 | https://docs.logestechs.com/llms.txt | 2026-11-02 | F | Endpoint index and summaries; schema index |
| D3 | https://docs.logestechs.com/overview-2344856m0.md | 2026-11-02 | F | Authentication, key issue, scope, admin control |
| D4 | https://docs.logestechs.com/package-status-webhook-2344867m0.md | 2026-11-02 | F | Webhook headers, payload, retries |
| D5 | https://docs.logestechs.com/create-a-shipment-42089768e0.md | 2026-11-02 | F | Create-shipment schema, shipment types, payment enum, address rules |
| D6 | https://docs.logestechs.com/list-the-possible-package-statuses-42089770e0.md | 2026-11-02 | F | Status reference (EN and AR labels); security scheme text |
| D7 | https://docs.logestechs.com/get-a-packages-current-status-42089771e0.md | 2026-11-02 | F (partial) | Status lookup parameters |
| X1 | https://admin-pro.logestechs.com/ | 2026-11-02 | F (shell only) | Admin login page, hosting, map library names |
| Z1 | https://zoftwarehub.com/products/logestechs/features | 2026-11-02 (directory updated 2025-11-18) | F (third-party) | Feature names list |
| Z2 | https://zoftwarehub.com/products/logestechs/pricing | 2026-11-02 | S | Pricing model conflict |
| W1 | Search summaries for CB Insights, Bouncewatch, Prospeo, zoftwarehub | 2026-11-02 | S | Founding year, seed round |
| M1 | https://www.mwcdoha.com/exhibitors/34526-logestechs | 2026-11-02 (404 on fetch) | S | Exhibitor description: founded 2020, OMS, WMS, DMS, carrier exchange, reseller, "millions of shipments" |
| T1 | Search for Logestechs in Salla help and app store results | 2026-11-02 | S (negative) | No Logestechs Salla app found |
| H1 | `curl -I` of logestechs.com, apisv5 root and docs host; marketing HTML generator tags | 2026-11-02 | F | Stack observations (section 3.5) |
| P1 | `docs/references/logestechs/public-api.md` on `origin/main` (census of 2026-10-31) | read 2026-11-02 | F (internal) | Endpoint table, rate-limit and sandbox gaps, status vocabulary |
| R1 | `adr/0007-driver-cash-custody-logestechs-model.md`, `adr/0011-stock-as-double-entry-ledger.md`, `adr/0030-merchant-webhook-signing-and-delivery.md` on `origin/main` | read 2026-11-02 | internal | Current eeasy positions cited in section 5 |
| C1 | Capterra 1020771 and G2 logestechs reviews | 2026-11-02 (403) | not read | Reviews unavailable |

