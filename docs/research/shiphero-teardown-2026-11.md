# ShipHero teardown, 2026-11

Date: 2026-11-02. Branch `docs/shiphero-teardown` from `origin/main` at `1e0c184`. Author: researcher agent for the lead.
Roadmap basis: `docs/roadmap.md` §1.4 (WMS-1 to WMS-7, INT-8, WEB-13 to WEB-15, OPS-6), §1.5 (INT-9 to INT-12, DEL-16 to DEL-18, WMS-8, OPS-7) and §4 (owner register). Domain basis: `docs/architecture/domain-model.md` §3.1, §3.13, §4.1 to §4.16, §5. Decisions: `adr/` at the repo root. Census extended, not repeated: `docs/research/features-wms-2026-11.md` (branch `docs/features-wms`, commit `72b7674`), cited as "census".

Grades: **[F]** page fetched and read on 2026-11-02; **[S]** search excerpt or third-party page only; **(inferred)** my reading, not a source statement. Source IDs (D, H, P, X, R) map to the registry in section 8. Counts that a fetch summary reported and I could not check directly are marked "as reported".

## Summary for the lead

1. ShipHero is a US cloud WMS and fulfilment platform for DTC brands and 3PLs. Its pages claim 100M+ orders shipped a year and "70+" integrations (P1, marketing claims).
2. Public API: one GraphQL endpoint; username and password exchanged for a bearer token that expires every 28 days; an account-wide pool of 4,004 credits restored at 60 per second; 7,000 requests per five minutes (D2, D3).
3. Webhooks: 20 named topics in the reference table, a custom HMAC-SHA256 header, and a HEALTHY, WARNING, UNHEALTHY model that auto-disables an endpoint (D6).
4. Borrow 1, shape of multi-warehouse allocation: an ordered list of first-match rules with a fallback rule, per-line or whole-order scope, and reprocessing (H11). Fits WMS-6 once the multi-site question is answered.
5. Borrow 2, shape of holds: a hold is a flag with a reason, set and checked by rules, with the evaluation order stated and no retroactive effect (H12, H13, H14). We have no hold model yet.
6. Borrow 3, shape of webhook operations: health states with alerts, reconciliation by `updated_at_min` filters, and a message id for de-duplication (D6). Fits INT-10 under ADR-0040.
7. Already stronger 1: stock is an append-only double-entry ledger with database-enforced invariants (ADR-0011, domain W-5, W-6). ShipHero's docs say `shipment_create` does not deduct inventory, so an API client makes a second call (D11), and transfer orders are two non-atomic mutations (D15).
8. Already stronger 2: the account comes from the token, never a request parameter (ADR-0025). ShipHero's 3PL users pass `customer_account_id` in each mutation input (D2, D21).
9. Already stronger 3 (market fit, not engineering): INT-11 covers Salla and Zid intake and INT-8 covers Eeasy shipping carriers. ShipHero's integrations grid lists no Salla, Zid or Saudi carrier (P2, first page only).
10. Evidence limits: the developer docs and most help articles were read; several flows and the pricing are thin or absent (P6); no engineering blog, architecture page or public status history was found. Search-only facts are marked [S].

## Method and limits

- Developer docs were read directly (D1 to D21). Help articles at `software-help.shiphero.com` were read through search, then fetched for the highest-value ones. The old `help.shiphero.com` redirects to a marketing page.
- Three product pages returned 404 (P7), so the 3PL, returns and EDI product claims rest on the WMS page and the help centre.
- No logged-in access. UI behaviour comes from help articles and marketing, not from using the product.

## 1. Product map

"Web" is the merchant or warehouse dashboard. Evidence IDs are in section 8.

### 1.1 Catalogue, inventory and locations

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Products and flags | SKU, `needs_lot_tracking`, `must_ship_alone`, `auto_pack`, EU customs identifiers (Aug 2026), kit and assembly flags; `product_create` and `product_update`. | Web, API | D2, D17, D8 |
| Locations | Named locations per warehouse with `zone`, `pickable`, `sellable`, `staging`, `is_cart`, `is_hospital` (Oct 2026); `location_bulk_create` takes 1 to 1,300 names per call. | Web, API, mobile | D18, D12, D8 |
| Put-away list (Putaway V2) | Draft list built by scanning an item, location or LPN; "Start Putaway" locks it; each move is logged in real time; destinations filter by pickable, sellable or location type. | Mobile (iOS) | H19 [F] |
| Inventory adjustments | `inventory_add`, `inventory_remove`, `inventory_replace` change one SKU at one location with a reason; `location_id` or `lpn_id` required since 2026-09-24. | Web, mobile, API | D12, D8 |
| Bulk inventory sync and snapshots | `inventory_sync` takes a public CSV of up to 3,000 lines with `action` limited to `replace`; `inventory_generate_snapshot` produces a filtered file with a `snapshot_url`. | CSV, API | D12 |
| Static or dynamic slotting | Static accounts give each SKU one primary bin; dynamic accounts hold stock per bin. The `dynamic_slotting` query is deprecated (2026-10-13). No velocity slotting was found. | Web, API | D8; H-search [S] |
| Lots and expiry | Lots have `expires_at`; `lot_assign_to_location` binds a lot to a location; account settings `priority`, `picking_disabled_period_in_days`, `verify_lot_when_packing`, `exclude_expired_quantity_from_available`. FEFO is not described. | Web, API | D17 |
| Kits and build kits | A kit is one sellable item; a Build Kit splits components into order lines; nested kits discouraged. | Web, API | H28 [S]; D10 (names) |
| Assembly work orders | Build an assembly SKU from components; picking is manual; work order webhooks exist. | Web, API | H28 [S]; D6 |
| Replenishment | Min and max on pickable locations, enabled by Support; reorder level and amount drive POs but do not create them. | Web | H27 [S] |
| Cycle counts | Types Locations, Items and Recount (API: `cycle_count_locations_create`, `cycle_count_items_create`, `cycle_count_recount_create`); statuses `uncounted`, `in_progress`, `closed`. Recounts continue until two consecutive counts agree (H26 [S]); auto-recount is a product changelog toggle (P8 [S]). | Web, mobile, API | D14, D7 |
| Counting practice | Cycle counting targets active SKUs; manual changes from web, mobile, CSV or product location pages; API access needs the user-level setting. | Web, mobile | H20 [F] |

### 1.2 Inbound

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Purchase orders | Line items with `quantity_received` and `quantity_rejected`; `purchase_order_create`; PO Update webhook. | Web, API | D15, D6 |
| Receiving to a location | Receive a PO by scanning a receiving location (the warehouse default unless changed); lines can split across locations; over- and under-received lines are flagged; the receiving location decides whether stock is sellable at once. | Web | H18 [F]; H-search [S] |
| Inbound shipments and ASN | Inbound shipment queries and mutations (Mar 2026); `inbound_shipment_create_from_asn` is experimental; statuses `QC_ON_HOLD` and `REJECTED` (2026-09-25); Shipment ASN webhook. | API, mobile | D8, D19, D6 |
| Receiving with LPNs | License plate numbers carry items through put-away; `license_plate_numbers_create` and `license_plate_numbers_move`. | Mobile, API | H18 [F]; D8 |
| Transfer orders | Two linked records: an Order at the origin and a PO at the destination, both with the `TO-` identifier. Not atomic; the client mirrors state. | Web, API | D15 |

### 1.3 Orders, allocation, holds and automation

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Order intake | Channel integrations or `order_create`; `orders` query with filters such as `allocated_from`, `pause_shipping` (3PL), `ids`, `updated_from`; `total_count` (Oct 2026). | Web, API, integrations | D8, P2 |
| Automation rules | IF/THEN rules: 58 triggers and 64 actions (as reported by the reference pages). Run top to bottom; apply to orders processed after the rule is saved, not retroactively; per client for 3PLs. | Web | H12 [F], H13 [F] |
| Order holds | Address, fraud, operator, payment, client and hold-until-date. Rules set or clear them; `Has ... Hold` triggers read them. Client Hold is set only by the owning client. A `Has` trigger cannot see a hold set by a rule lower in the list. | Web, API | H14 [F], H13 [F] |
| Multi-warehouse allocation (MWA) | Enabled by Support (3PLs per client). Rules have optional conditions (country, store, profile, tags, SKUs) and actions (scope entire order or each SKU; type allocate, backorder, single-warehouse, locked warehouse; warehouse list; capacity filter; sort by distance, priority or fulfillable amount). The first matching rule runs, once per order; a DEFAULT RULE is added and cannot be edited; MWA overrides automation's warehouse assignment. | Web | H11 [F] |
| Allocation priority and partial | Priority Default, Low or High, applied inside the assigned warehouse; `Set Allow Partial` ships what is allocated; required-ship-date filter for batches. | Web, API | H13 [F]; H-search [S] |
| Workflows | Custom multi-stop routes (gift wrap, QA) defined by admin, worked in the mobile app or Packing App; assigned to products or tags by rule; requires MIB. | Web, mobile | H7 [F] |
| Merge and bulk edit | Flows exist (names only). | Web, API | D10; H-search [S] |

### 1.4 Picking

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Picking methods | Single order; Bulk Ship (labels for up to 1,000 identical orders before picking; below 10 identical orders use SIB, MIB or waves); QR code picking; pick-to-light; location-aware; waves; Mobile Picking Interface (beta). | Mobile, hardware | H4 [F] |
| Multi-item batch (MIB) | Each order gets its own tote; the picker enters a tote count (default from App Settings); the app routes items to the order's tote and asks for a free tote for a new order; batch size and sort order per warehouse; packers receive pre-sorted totes. | Mobile | H1 [F] |
| Single-item batch (SIB) | Several single-SKU orders share one tote; the packer separates them. | Mobile | H1 [F], H4 [F] |
| Waves | A generator runs every 15 minutes and creates a wave when enough orders share SKUs to fill a cart; each tote holds one SKU for all orders in the wave; needs location-aware picking; the page suggests 250 to 300 multi-item orders per window. | Mobile, pick-to-light | H5 [F], H4 [F] |
| Location-aware picking | AI route from the warehouse map; Smart Batching groups orders by storage area; Live Pickers Dashboard; usage-priced add-on per warehouse. | Mobile, web | H6 [F] |
| Totes | Created on the Totes page per warehouse (never shared across warehouses); permissions View, Create, Edit, Delete; stock leaves the bin when picked into a tote (since July 2024, [S]). `tote_create`, `tote_update`, `tote_clear` (renamed from `clear_tote`), `tote_transfer_to_location`. | Web, mobile, API | H2 [F]; D12; D8 |
| Tote QA | Setting that makes packers scan each item; off moves picked items to packed automatically. | Packing App | H8 [F] |
| Report Issue | Picker reports a missing item; the location is marked hospital and dropped from the route; if no other location has the item the order leaves the batch, unless an App Settings option keeps it. | Mobile | H1 [F] |
| Interrupted batch | A dropped connection or dead device stops a batch; the help article says it cannot be resumed on older app versions; the Oct 13, 2026 changelog says MIB can now be resumed. The sources disagree on version scope. | Mobile | H1 [F]; P8 |
| Enforce All Pick Scans | Per-user App Settings option: every unit must be scanned; manual quantity entry is hidden. | Mobile | H3 [F] |

### 1.5 Packing and shipping

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Packing flow | Scan the tote (required for MIB) or select the order; verify items; choose a box, scan a box barcode, or let automation pre-assign it; weight from item weights or a scale; "Add Another Package" splits oversized orders; optional Parcel View photo; print invoice and label; scan the Complete Order barcode. | Packing App | H8 [F] |
| Hospital at packing | A packer sends the order to hospital (dialog, command barcode or Tap-to-Pack button); needs a custom status named exactly `hospital`; a manager clears it. | Packing App | H10 [F] |
| Weight discrepancy check | Compares the weight with history for the same box, SKUs, quantities and location; needs three prior shipments; flags above 5% and above 2 standard deviations (and 1 oz or 1 lb); the label is not printed until re-weigh or override. | Packing station | H9 [F] |
| Labels and carriers | Native: USPS, UPS, FedEx, DHL Express, DHL eCommerce, Canada Post, StarTrack; Shippo and Sendcloud add more; custom carriers through a Generate Label webhook; no LTL or FTL labels; each carrier account is connected per warehouse; store shipping methods map to a carrier method or "Cheapest". | Web, Packing App, API | H16 [F] |
| Rate shopping, RateShop+ | Live quotes from connected carriers; cheapest overall or within a delivery window; RateShop+ multiplies each quote by a rating factor and can cap delivery time; the same carrier cannot be shopped on two accounts in one order. | Packing App, web | H16 [F]; P3 [F] |
| Generate Label webhook | Custom-carrier label request; the response must carry a label within 20 seconds; 3PL child accounts use the 3PL's secret; payload adds `shipper_account_id`, `warehouse_id` (Oct 2026) and `dangerous_goods_code` (Oct 2026). | API | D6, D8 |
| Printing | Station printers: Zebra, Rollo, Dymo 4XL, Bixolon; mobile printing for Zebra only; invoice printing configured per warehouse. | Workstation app, mobile | H22 [F]; H-search [S] |
| Multi-package and containers | Orders ship in several packages; `Package Added` webhook; `shipping_container_*` mutations and labels (2026). | Packing App, API | D6, D8 |

### 1.6 Returns

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Return creation | `return_create` takes order, warehouse, reason, lines, address, dimensions and shipping fields; a self-return label uses carrier and method `genericlabel`; statuses Pending, Warehouse Complete, Complete; Complete triggers the refund. | Web, API | D13 [F] |
| Return portal and set-up | Embeddable iFrame from the Customer Returns page; reason codes and custom statuses; auto-print return labels; return warehouse profile; a rule sets the return warehouse per order. | Web, storefront | H-search [S] (return set-up); H13 [F] |
| Receiving and restocking | `return_receive_line_item` takes incremental `quantity_received` and `restock_quantity`, plus `bin_id` when restocking; received-not-restocked does not raise on-hand. | Web, mobile, API | D13 [F]; H-search [S] |
| Exchange | `exchange_items` inside `return_create`; `dont_allocate_exchange_until_return_release` (Aug 2026) holds allocation. | API | D13, D8 |
| Attachments and label scan | `return_add_attachment` (May 2026); scanning USPS or FedEx return labels finds a return (Oct 2026). | Web, mobile, API | D8, P8 |

### 1.7 Wholesale and EDI

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Wholesale orders | Cases and pallets; packing layout import and export; mark packed, generate and print labels (June 2026); enabled by ShipHero. | Web, API | D8, D18 |
| Staging locations | Non-pickable, sellable cart locations (`staging: true`, `is_cart: true`) that gather picks before final packing. | Web, API | D18 [F] |
| SPS Commerce EDI | 850 or 940 purchase orders in; 856 or 945 ship notices out; GS1-128 carton labels requested per EDI order; an ASN per EDI order. | Web | H-search [S] |
| GS1 labels | Built from the retailer's GS1 Company Prefix; `gs1_labels_required` on API orders; `trading_partner_id` set by ShipHero operations. | Web, API | H-search [S]; D7 |

### 1.8 3PL operations

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Multi-client | Clients are customer accounts; mutations take `customer_account_id`; inventory, orders and rules are per client; a client must be added to the warehouse before fees apply. | Web, API | D2, D21, H12 [F], H15 [F] |
| Client portal | Each client gets a self-serve portal (marketing claim). | Client web | P1 [F] |
| Billing profiles | Groups of fees linked to clients per warehouse: Recurring, Receiving, Storage, Shipment, Returns, Ad Hoc; export on tally. | Web | H15 [F] |
| Bills | `bill_create` over a date range; `bill_recalculate` replaces a bill; status draft, finalized, paid (paid is final); `bill_submit` emails with a due date from payment terms. | Web, API | D16 [F] |
| Ad hoc and label fees | `bill_add_ad_hoc_charge`, `bill_update_ad_hoc_charge`; label fees are a flat rate per label plus an optional percentage. | Web, API | D16 [F]; H-search [S] |

### 1.9 Labour, reporting and analytics

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Picker Performance Dashboard | Each picker against an AI benchmark for the warehouse map; 0 to 10 score (5 is on the estimated time); needs Location-Aware Picking and two to four weeks of history. | Web | H-search [S]; H6 [F] |
| Live boards | Live Shipping Board (remaining work and hourly goal per picker or packer); HeroBoard (pick and pack queues). | Web | H-search [S] |
| Picker report | Per-picker items and orders for a date; CSV or PDF. | Web | H-search [S] |
| Labour API | `labor_jobs`, `labor_workers`, `packs_per_day`, `picks_per_day`, performance dashboard queries; experimental `labor_activity_*` mutations. | API | D7 (names); D19 |
| Data exports | Parquet with Snappy; FULL and DELTA by module. Free tier: weekly full, delta every six hours. Paid tier by request: daily full, delta every 30 minutes. Signed URLs expire after 24 hours; runs from 2026-09-25. | API | D9 [F]; D8 |

### 1.10 Mobile app and hardware

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| iOS only | iPhone and iPad; minimum iOS 15.1, recommended 17 or later; Android not supported. | Mobile | H22 [F]; H21 [F] |
| Functions | Picking (SIB, MIB, single order), packing and shipping, inventory lookup, product and label printing, weekly cycle-count prompts, transfers; put-away in Putaway V2. | Mobile | H21 [F]; H19 [F] |
| Scanners | Bluetooth HID; BLE by model; 2D Glove recommended; Socket Mobile 7Ci, 7Pi, 800 and 700 series in HID mode; QR for wholesale. | Hardware | H22 [F]; H-search [S] |
| Printers and scales | Wi-Fi or Bluetooth label printers (Zebra for mobile printing); Mettler Toledo PS60 and BC60 scales recommended; Dymo m10 and m25 not recommended. | Hardware | H22 [F] |
| Network | Hard-wired for printing and pack stations; at least 5 Mbps, 5 GHz preferred, -65 dBm or better for mobile. | Hardware | H22 [F] |
| Offline | No offline mode documented; connection loss halts a batch (1.4). | Mobile | H22 [F] (silent); H1 [F] |

### 1.11 Platform, integrations and security

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Integrations | Shopify, Magento 2, BigCommerce; Amazon, Walmart, eBay, TikTok and TikTok Shop; UPS, USPS, FedEx, DHL, Canada Post and others; Loop Returns; NetSuite (navigation); Brightpearl; ChannelAdvisor; 6 River System. First page of the grid only. | Integrations | P2 [F] |
| Public API and MCP | GraphQL API; ShipHero MCP at `mcp.shiphero.com/mcp` (OAuth, read or read-write); Public API Skill for coding agents (OAuth PKCE). | API, AI tools | D20 [F] |
| Security | SOC 2 Type 2 with annual audits (claim); GDPR; MFA; SAML2 SSO; Drata; Trust Center; AWS hosting; TLS 1.2; read-only database access by default, logged. | Platform | P4 [F]; H23 [F] |
| Status | Status page for WMS, mobile app and API. | Public | H-search [S] |

## 2. Public signals about the team

- No engineering blog, architecture page or conference talk was found [S].
- Job posts (search excerpts, two to four years old) name Python, Flask, Django, React, MySQL and GraphQL; no current backend posting was found [S]. Weak evidence.
- Review and rating counts on the product pages (P1, P2) are marketing figures.

## 3. API and integration anatomy

### 3.1 Endpoints, schema and naming

- GraphQL at `https://public-api.shiphero.com/graphql`; experimental operations at `/graphql/experimental` (D2, D19).
- Auth at `https://public-api.shiphero.com/auth/token` and `/auth/refresh` (D2).
- The schema reference lists names; the page summary reports 73 queries, 134 mutations and 659 types (as reported) (D7).
- Mutations are `<entity>_<verb>` (`order_create`, `order_fulfill`, `purchase_order_create`, `return_receive_line_item`, `tote_clear`, `location_bulk_create`); queries are plural lists (`orders`, `products`, `shipments`).
- Main types named on the schema page: Order, OrderAddress, OrderLineItemAllocation; Product, ProductVendor, WarehouseProduct; InventorySnapshot, InventoryChange, ItemLocation; Shipment, ShipmentLineItem, ShippingLabel, ShippingContainer; PurchaseOrder, PurchaseOrderLineItem; Return, ReturnLineItem, ReturnExchange; Warehouse, WarehouseProfile; Tote, ToteHistory, TotePick; Location, LicensePlateNumber; Account, AccountLotTrackingSettings, User (D7).

### 3.2 Authentication

- Username and password at `/auth/token` return `access_token`, `refresh_token`, `expires_in` and `token_type`; send the access token as a bearer token (D2).
- The access token expires every 28 days; refresh with `refresh_token` at `/auth/refresh` (D2).
- Use a third-party developer user from the users page rather than a person's login; API keys are not used (D2).
- Tokens from `/auth/token` do not enforce OAuth scopes (D2, D5). Scopes are `view:` for queries and `change:` for mutations (D5). Which token types carry scopes is (inferred) from the OAuth-based AI tools (D20).

### 3.3 Credits, throttling and cost

- Standard pool: 4,004 credits per account, restored at 60 per second to the maximum; shared by every standard user and token on the account (D2, D3).
- Balance is in `extensions.throttling.user_quota` (D3).
- Request limit: 7,000 requests in any five-minute period, failed requests included; over the limit returns HTTP 429 with no GraphQL error array or `request_id` (D3, D5).
- `analyze: true` returns the cost without running the query or using credits (D3).
- Insufficient credits return code 30 with `time_remaining`; a per-request maximum means smaller `first` values (D5).
- AI Toolkit (MCP and Public API Skill) has its own pool of 2,002 credits (D3, D20).
- A `complexity` value is returned when requested; `first` and `last` reduce cost (D21).

### 3.4 Errors

- Codes: 3 Invalid Argument; 5 Not Found; 6 Already Exists; 7 Permission Denied (missing `view:` or `change:` scope, or 3PL access); 9 Failed Precondition (some duplicate order numbers too); 10 Aborted; 14 Unavailable; 20 Format Error; 21 Service Not Available; 22 Unexpected Error; 30 Throttling Error (D5, D21).
- Codes 10, 14, 21 and 22 refund credits, but the mutation may have taken effect; read the resource before retrying a mutation (D5).
- A field outside the token's scope returns `null` with `extensions.scope_warnings` (`FIELD_SCOPE_MISSING`) (D5).
- Every operation can return `request_id`, which support asks for (D21).

### 3.5 Identifiers and pagination

- Opaque `uuid` ids; `uuid(legacy_id:, entity:)` converts legacy ids (D21).
- Relay-style cursors: `data(first:, after:)`, `edges { node cursor }`, `pageInfo { hasNextPage endCursor }` (D21).
- Filters are per query (`ids`, `updated_from`, `updated_to`, `tag`, `tag_not_in`, `customer_account_id`); the schema page names few shared filter inputs, so filters must be read per query (D7, D8).

### 3.6 Webhooks

- Topics (20 in the reference table; the landing page says "about 25"): Inventory Update, Inventory Change, Product Update, Shipment Update, Automation Rules, Order Backorder, Order Canceled, Capture Payment, PO Update, Return Update, Tote Complete, Tote Cleared, Order Packed Out, Package Added, Print Barcode, Order Allocated, Order Deallocated, Generate Label, Shipment ASN, Work Order Status Update (D1, D6).
- Management: `webhook_create` (`name` is the topic, plus `url`, `shop_name`, optional `enabled: false`); `webhook_update_url`, `webhook_enable`, `webhook_disable`, `webhook_delete` (D6).
- On create, a HEAD request checks reachability; the `shared_signature_secret` is shown once (D6).
- Signature: `x-shiphero-hmac-sha256` is the base64 HMAC-SHA256 of the body; compare in constant time. `X-Shiphero-Message-ID` is unique within the triggering process (D6).
- Timeout 10 seconds (20 for Generate Label); up to 5 retries; any non-2xx, connection error, TLS error or timeout is a failure (D6).
- Health: HEALTHY, then WARNING (email, at most daily), then UNHEALTHY (auto-disabled with a final email). An UNHEALTHY webhook is re-enabled only by a ShipHero representative (D6).
- Events that occur while a webhook is disabled are discarded, not queued. No delivery guarantee; reconcile with `created_at_min` and `updated_at_min` (D6).
- `webhooks_call_logs` returns metadata, not payloads, and needs `view:webhooks` (D6, D8). Per-topic payload pages were not read.

### 3.7 Versioning, changes and deprecations

- No version in the URL. Dated changelog entries (Dec 2025 to Oct 2026) record additions, renames and deprecations (D8).
- Deprecated: `dynamic_slotting`, `recurring_data_export` and `lakehero_data_export` queries and `sku` in `lot_update` (2026-10-13); `cycle_count_enabled` (2026-10-29); `clear_tote` renamed to `tote_clear` (2026-04-17) (D8).
- No breaking-change policy or deprecation window is stated (D2, D8).
- Experimental operations: `carriers` and `shipping_methods` queries; `label_print`, `label_quote`, `inbound_shipment_create_from_asn`, `labor_worker_activities` and `labor_activity_*`. They may change and carry no service commitment (D19).

### 3.8 Sandbox and AI tools

- Experimental endpoint: access off by default; requested through Support; not in the MCP (D19).
- No sandbox is documented for the public API (D2).
- ShipHero MCP: remote OAuth server, read or read-write. Public API Skill: zip for coding agents with OAuth PKCE scripts (D20).

### 3.9 Flow patterns the docs show

- Shipping and stock are separate calls: `shipment_create` does not deduct inventory, so the flow calls `inventory_remove` and then `order_update_fulfillment_status` (D11). Partial shipping uses `order_update_line_items` (D11).
- Returns: `return_create` (with optional exchange lines), `return_update_status`, then `return_receive_line_item` with incremental quantities (D13).
- Transfer orders: two mutations, not atomic, linked by a shared identifier and tags; the client mirrors state (D15).
- Inventory bulk changes: `inventory_sync` (CSV, replace only) or `inventory_add` / `inventory_remove` / `inventory_replace`; `location_id` or `lpn_id` required (D12, D8).

The FAQ page has no rate, idempotency or sandbox guidance; its content is HTTP 403 from Google Cloud IPs, a Data Exports permission error and label tracking delays (D4).

## 4. Operational model

### 4.1 Multi-client, roles and holds

- A 3PL is an account with customer accounts beneath it; mutations target a customer with `customer_account_id` (D2, D21).
- Roles: Admin or per-permission (for example "Create: Billing") (H15); tote permissions View, Create, Edit, Delete (H2); API access is a user-level setting (H20).
- Client Hold is set and released only by the owning client; 3PL operators cannot set it manually or by rule (H14).
- Per-user App Settings: default batch quantity, Enforce All Pick Scans, single-item-batch pick quantity (H1, H3, H21).

### 4.2 Billing

- Profiles group fees, linked to a client per warehouse (H15). Bills per customer and date range, with billing period, monthly frequency in the example, and totals by category (D16).
- Status: draft (default), finalized, paid; paid cannot be reversed (D16). Submission emails the client and sets a due date from payment terms (D16).
- Storage pricing units appear only in related article titles (H15 [S]); not verified.

### 4.3 Automation rules and allocation

- 58 triggers (address, product, order, date, value, shipping, customer order count, tag, existing hold, multi-warehouse, location) and 64 actions (hold, international, shipping and label, product, notes, packing, classification, returns, routing) (H12, H13).
- Rules run top to bottom, are not retroactive, and "Reprocess" reruns MWA and rules (H11, H12, H14).
- Workflows, box choice, tags, holds and warehouse locks are all actions, so rules are the main configuration surface (H13).
- MWA runs first when enabled and overrides warehouse assignment set by automation; a lock action needs an MWA rule to hold (H11).
- Partial allocation ships allocated lines; backorders are separate lines (H-search [S]).
- "Ready to pick" requires every line in a pickable bin (glossary [S]). The sources do not say whether holds block picking or allocation (H14 is silent).

### 4.4 Exceptions

- Short pick: hospital location, removed from the route; the order leaves MIB unless the setting keeps it (H1).
- Packing: custom status `hospital`, cleared by a manager (H10). Weight mismatch: label blocked until re-weigh or override (H9). Over-pack warning on scan (H8).
- Stock leaves the bin when picked into a tote, not at shipment (H2, H-search [S]).

### 4.5 Public sizing signals

- Claims: 100M+ orders a year; 99.9% pick accuracy; go-live "6 to 8 weeks" on the page with a footnote of 2 to 12 weeks actual (P1). The implementation page says "4 to 6 week process" with five steps: kick-off, discovery, fundamentals, warehouse prep (location labelling and physical count), UAT and go-live (P5).
- These are vendor claims and are not used as evidence of performance.

## 5. Mapping to our roadmap and domain model

Borrow? values: **yes** (take the shape), **adapt** (take the idea with changes), **no** (reason given), **already** (we have it). ADR references are to `adr/`.

| # | Feature | ShipHero | eeasy-logistics today (order id or gap) | Borrow? |
|---|---|---|---|---|
| 1 | Multi-site allocation rules | MWA: ordered first-match rules, DEFAULT RULE, entire-order or each-SKU scope, one rule per order (H11) | Gap. Allocation is per site over pickable locations (domain 4.10); no cross-site routing row; census P7 | adapt: a rule list per site set, after the multi-site answer (section 7) |
| 2 | Allocation priority, Allow Partial | Priority Default, Low, High; partial ships allocated lines (H13) | Gap in WMS-6: short pick goes to `on_hold` (domain 4.12) with no partial shipping | yes: per-order flag and backorder line |
| 3 | Order holds | Address, fraud, operator, payment, client, hold-until; rules set and clear (H14) | Gap: order (3.1) and state machine (3.13) have no hold; WMS `on_hold` only for short pick | yes: a hold is a flag with a reason and an audit row (AuditLog 2.5, PLAT-7) |
| 4 | Automation rules | 58 triggers, 64 actions, top-down, not retroactive (H12, H13) | Gap: no rule engine in the roadmap; ADR-0006 allowlist applies | no for a general engine (section 7, Q3); adapt a bounded set (hold, tag, box, warehouse) later |
| 5 | Waves (SKU batching) | Wave every 15 min, one SKU per tote, needs location-aware (H5) | Partial: PickTask may be "a wave of them" (domain 4.6); no grouping rule | adapt after pilot volume data |
| 6 | Tote per order (MIB) | One tote per order; tote count; pre-sorted for packers (H1) | Partial: PickTask target tote (4.6), tote location type (4.1), W-2 | yes: tote per order as the default picking unit |
| 7 | Single-item batch, shared tote | Shared tote; packer separates (H1) | Gap | no for wave 3: suits single-line volume; revisit with waves |
| 8 | Bulk Ship and QR picking | Labels for up to 1,000 identical orders before picking (H4) | Gap | no: labels are created at pack with measured weight (ADR-0014, W-10) |
| 9 | Location-aware route and batching | AI route from floor plan; picker score (H6) | Gap; location tree has path and coordinates (4.1) | adapt later: sequence by location path; no AI routing |
| 10 | Pick-to-light, pack-to-light | Hardware add-ons (H4, P1) | Gap | no for software scope; section 7, Q7 |
| 11 | Hospital exceptions | Hospital location (picking), hospital status (packing), manager queue (H10) | Partial: quarantine location type (4.1), `on_hold` (4.12) | yes: reason codes on `on_hold` and a manager queue |
| 12 | Item verification at pack (Tote QA) | Scan each item; over-pack warning (H8) | Gap in WMS-7 text | yes: census P3 |
| 13 | Box catalogue and choice | Set box, automation pre-assign, dimensions fill (H8, H13) | Partial: measured dimensions (4.7, W-10); no box catalogue | adapt: site box catalogue; box is chosen, not computed |
| 14 | Weight discrepancy | History-based check; blocks the label (H9) | Partial: weight measured (4.7); no history check | adapt once history exists |
| 15 | Rate shopping and RateShop+ | Live quotes, factors, cheapest windows (H16, P3) | No: carrier pricing stays in Eeasy shipping (ADR-0001, ADR-0014, W-12) | no: ADR-0001 and ADR-0014 |
| 16 | Custom-carrier label webhook | Label within 20 s (D6) | INT-8 through a port; tracking webhook mapping | no for merchant-side custom carriers; 20 s is a data point for INT-8 timeouts |
| 17 | Return status and refund | Pending, Warehouse Complete, Complete; Complete triggers refund (D13) | Partial: DEL-18, WMS-8, return aggregate (4.8) | yes: refund is a finance event, not a status write |
| 18 | Received versus restocked | Two incremental quantities and `bin_id` (D13) | Partial: return to `returns` location and disposition (W-17) | already in shape; keep receive and restock as separate movements |
| 19 | Exchange held until return | Exchange lines in the return call; allocation held until release (D13, D8) | DEL-18; exchange as one order (Q-4 default) | yes: hold exchange allocation until receipt |
| 20 | Transfer between warehouses | Two linked, non-atomic records with `TO-` ids (D15) | Gap; movements with `batch_id` (4.4) and reason `transfer` | no for the shape (one atomic batch, ADR-0011, W-2); yes for the concept |
| 21 | Bulk inventory sync | CSV up to 3,000 lines, replace only; `inventory_replace` overwrites (D12) | Partial: WMS-5 count sessions (4.15); no CSV import | adapt: count lines; a difference posts ADJUSTMENT, never an overwrite (W-16, ADR-0011) |
| 22 | Cycle count types and recount | Locations, Items, Recount; recount until two counts agree (D14, H26 [S]) | Partial: CountSession (4.15); no types, no recount rule | yes: the two-consecutive-agree rule; threshold is Q-17 |
| 23 | Blind counts | Not documented in the sources read | Not in domain 4.8 | unanswered (section 7, Q12) |
| 24 | Lots and expiry | Lot priority, exclude expired from available, picking-disabled period (D17) | Partial: lot entity (4.2), WMS-2; no expiry rule | adapt: exclude expired from available now; FEFO only by ruling |
| 25 | Kits and build kits | Kit or build kit; assembly work orders (H28 [S], D6) | Gap (census: low) | no for wave 3 |
| 26 | Replenishment min and max | Min and max on pickable locations; reorder level does not create a PO (H27 [S]) | Gap (census P8) | adapt later with INT-12 and transfers |
| 27 | Put-away list | Draft list, lock, live partial moves (H19) | Partial: WMS-4 put-away; W-14 steps | yes: draft list locked before moves; each move one movement |
| 28 | Receiving location and sellability | Receiving location decides sellable (H18) | Partial: `pickable` on location (4.1); no `sellable` | adapt only if INT-12 needs it |
| 29 | Multi-client 3PL | `customer_account_id` on mutations; per-client rules and billing (D2, H12, H15) | No: outside the stated merchant model (ADR-0001, ADR-0002, ADR-0005) | no unless scope widens (section 7, Q1) |
| 30 | 3PL billing | Profiles, fee categories, draft and finalized bills (D16, H15) | Gap: no billing aggregate; ADR-0007 covers cash custody only | no now (section 7, Q2) |
| 31 | Labour metrics | Picker score, live boards (H-search [S], D7) | Gap; movements carry `recorded_by` (4.4), so picks per user are derivable (inferred) | adapt later: read-only report over the ledger |
| 32 | Data exports | Parquet FULL and DELTA; signed URLs for 24 hours (D9) | Gap; DEL-17 reports over views | adapt: ledger and event exports via INT-9 |
| 33 | Webhook health and auto-disable | HEALTHY, WARNING, UNHEALTHY; events discarded while disabled (D6) | Gap in INT-10; ADR-0040 accepted 2026-11-01 | adapt: health states and alerts; no discard; dead rows in `/platform/outbox` (ADR-0024, PLAT-8) |
| 34 | Webhook de-duplication and reconciliation | Message id; reconcile with `updated_at_min` (D6) | Partial: webhook id under ADR-0040; cursor pagination (ADR-0029) | yes: updated-since filter on INT-9 lists |
| 35 | Request and credit budgets | 4,004 credits; 7,000 requests per five minutes; `analyze` flag; code 30 (D2, D3) | Gap; Q-33 wants limits and counters from day one | adapt: per-key request budget and usage counters; no credit currency |
| 36 | API credential | Username and password exchange; 28-day token; refresh (D2) | Q-13 default: static `X-API-Key` | no: keep Q-13; token expiry is a data point |
| 37 | Beta surface behind Support | `/graphql/experimental`, off by default (D19) | ADR-0006 allowlist and provisioning door | yes: beta surface behind a flag |
| 38 | Sandbox | None documented (D2) | OPS-7 sandbox accounts on staging | already planned (OPS-7) |
| 39 | Scanner platform and offline | iOS only; connection loss halts a batch (H22, H1); resume added Oct 2026 (P8) | WEB-15 scanner-first web screens; no native scanner app; ADR-0008 outbox is for the driver app | adapt: give WMS scanner screens an outbox story (order 10) |
| 40 | Stock writes outside the ledger | `inventory_add`, `_remove`, `_replace` change stock with a reason (D12) | Already: ledger is the only writer (ADR-0011, ADR-0031, W-5) | already |
| 41 | Dynamic slotting | Deprecated in the API 2026-10-13 (D8) | Location tree per site (ADR-0012) | no: no velocity slotting in the roadmap |
| 42 | Multi-package shipments | Packages and containers (D6, D8) | Already: packages per fulfilment order (4.7) | already |
| 43 | Tenancy in the API | Customer id in request input (D2) | Already: account from token (ADR-0025, PLAT-6) | already |
| 44 | Side effects | Webhooks and "Call Url" action fire from the platform (D6, H13) | Already: outbox only (ADR-0024) | already |

## 6. Proposed order amendments and new orders

Ten at most. Nothing is scheduled; the lead decides.

1. **WMS-6a (amend WMS-6):** ordered first-match allocation rules per site, whole-order or per-line scope, allocation priority, Allow Partial with backorder lines. Depends on WMS-6, WMS-3, section 7 Q4.
2. **WMS-6b (amend WMS-6):** tote per order as the picking unit, with batch size and tote count; no SIB in wave 3. Depends on WMS-6, WMS-1.
3. **WMS-4a (amend WMS-4):** order holds as flags with reason codes and audit rows, and a locked draft put-away list. Depends on WMS-3, PLAT-7, PLAT-10 (roles for hold release).
4. **WMS-6c (new, short):** short-pick and hospital exceptions as reason codes on `on_hold`, a manager queue and the quarantine location. Depends on WMS-6, WEB-15.
5. **WMS-7a (amend WMS-7):** item verification scan at pack, a per-site box catalogue, box chosen not computed. Depends on WMS-7, WEB-15.
6. **WMS-5a (amend WMS-5):** count types (location, item, recount) and the rule that recounts continue until two consecutive counts agree; discrepancies post ADJUSTMENT movements. Depends on WMS-5, Q-17.
7. **WMS-2a (amend WMS-2):** lots that expire leave available stock; FEFO ordering only after an owner ruling. Depends on WMS-2, WMS-3, WMS-6a.
8. **DEL-18a (amend DEL-18):** return receive and restock as separate movements; exchange allocation held until return receipt. Depends on DEL-18, WMS-8.
9. **INT-10a (amend INT-10):** webhook health states with alerts through the outbox; no silent discard while disabled; an updated-since reconciliation read. Depends on INT-10, INT-9, PLAT-8, ADR-0040.
10. **WEB-15a (new):** offline outbox for the WMS scanner screens on the ADR-0008 pattern; ShipHero's iOS-only, live-connection model is the contrast. Depends on WEB-15, WMS-6.

Not proposed, with the question that would unlock them: bounded automation rules (Q3), 3PL billing (Q2), wholesale and EDI and kits (Q5), replenishment (Q6), data exports as a merchant feature (Q8).

## 7. Unanswered (owner questions)

1. Is multi-client 3PL in scope? ShipHero's billing and client portal depend on it, while ADR-0001, ADR-0002 and ADR-0005 describe merchants with their own drivers and stock.
2. If 3PL is in scope, is client billing (profiles, bills, storage and label fees) wave 4 or out of scope?
3. Do merchants need configurable automation rules (a bounded set for holds, tags, boxes and warehouses), or are all rules fixed in code?
4. Will the pilot merchant hold stock in more than one site (ADR-0018)? This decides whether WMS-6a and the MWA shape belong in wave 3.
5. Are wholesale and EDI (SPS Commerce, GS1-128), and kits and assemblies, in scope for wave 4 or later?
6. Is replenishment (min and max, reorder level) needed before INT-12?
7. Does the pilot need pick-to-light or pack-to-light hardware?
8. Should merchants get full and delta data exports through INT-9, and with what retention (Q-35 is 30 days for webhook logs)?
9. Do we meter API use with request budgets from day one (Q-33), and how are limits shown to merchants?
10. Is a beta API surface behind a flag acceptable (ADR-0006 pattern), and who grants access?
11. Should the WMS scanner be iOS-only like ShipHero, or run on Android handhelds? This decides the offline work in order 10.
12. Do merchants need blind counts? The sources do not settle it.
13. Do we want a published sandbox for integrators (OPS-7) or staging accounts only?

## 8. Source registry

All read 2026-11-02. [F] fetched and read; [S] search excerpt or third-party only.

**Developer (D)**
- D1 https://developer.shiphero.com/ [F]
- D2 https://developer.shiphero.com/getting-started/ [F] (endpoints, auth, token lifetime, no sandbox)
- D3 https://developer.shiphero.com/getting-started/#throttling--quotas [F] (credits, request limit, analyze)
- D4 https://developer.shiphero.com/troubleshooting/faq/ [F] (no rate-limit content)
- D5 https://developer.shiphero.com/troubleshooting/error-glossary/ [F]
- D6 https://developer.shiphero.com/webhooks/ [F]
- D7 https://developer.shiphero.com/schema [F] (names; counts as reported)
- D8 https://developer.shiphero.com/changelog/ [F] (2025-12-29 to 2026-10-29)
- D9 https://developer.shiphero.com/data-exports/ [F]
- D10 https://developer.shiphero.com/flows/ [F] (list only)
- D11 https://developer.shiphero.com/flows/order-fulfillment/ [F]
- D12 https://developer.shiphero.com/flows/inventory/ [F]
- D13 https://developer.shiphero.com/flows/returns/ [F]
- D14 https://developer.shiphero.com/flows/cycle-counts/ [F]
- D15 https://developer.shiphero.com/flows/transfer-orders/ [F]
- D16 https://developer.shiphero.com/flows/3pl-billing/ [F]
- D17 https://developer.shiphero.com/flows/lots/ [F]
- D18 https://developer.shiphero.com/flows/staging-locations/ [F]
- D19 https://developer.shiphero.com/experimental/ [F]
- D20 https://developer.shiphero.com/shiphero-ai-toolkit/ [F]
- D21 https://developer.shiphero.com/graphql-primer/ [F]

**Help centre (H)**, base `https://software-help.shiphero.com/hc/en-us/articles/`
- H1 4419336440333 (How to Multi-Item Batch Pick) [F]
- H2 4419345058445 (Overview: Totes) [F]
- H3 40363495768077 (Overview: Mobile Picking Interface, beta; updated 2026-10-09) [F]
- H4 46892350249997 (Overview: Picking Methods) [F]
- H5 46726660678285 (Overview: Waves) [F]
- H6 47415085396365 (Overview: Location Aware Picking) [F]
- H7 47014779288077 (Overview: Workflows) [F]
- H8 4419345190925 (How to Pack Orders, Standard Flow) [F]
- H9 11801446343309 (Weight Discrepancy Detection) [F]
- H10 47599417090573 (Hospital Feature at Packing Stations) [F]
- H11 4419362009613 (Multi-Warehouse Allocation Rules) [F]
- H12 48079897846413 (Automation Rule Triggers reference) [F]
- H13 49618365551373 (Automation Rule Actions reference) [F]
- H14 46376927001613 (Order Holds with Automation Rules) [F]
- H15 4419362163981 (3PL Client Billing Profile) [F]
- H16 41556301027725 (Label Generation and Rate Shopping) [F]
- H18 49850636905997 (Overview: Receiving) [F]
- H19 43436222798733 (Putaway V2 with LPN Support) [F]
- H20 4419344892173 (How to Manage Inventory Counts) [F]
- H21 8497107616269 (iOS Mobile App user guide) [F]
- H22 4419328395533 (Supported Hardware Devices) [F]
- H23 4419353587085 (Data Communication Security Practices) [F]
- H28 4419345531277 (All About Kits), 41853802041485 (Work Orders) [S]
- H26 7659853267597 (cycle counts), 44404315552013 (recounts) [S]
- H27 21310018814477 (min and max) [S]
- H17 4419336461709 (return label set-up), 4419353847949 (return warehouse rule) [S]
- H-search [S], other: 42645399137677 (expedited orders), 4419344750477 (short-ship), 47567940799629 (SPS onboarding), 46066521021453 (GS1 labels), 42452761934861 (Picker Performance), 4419346083085 (Live Shipping Board), 4419344507021 (system status), 48054953625613 (3PL automation rules), 4419344505229 (inventory glossary)

**Product and corporate (P)**
- P1 https://www.shiphero.com/ecommerce-wms [F]
- P2 https://www.shiphero.com/integrations [F] (first page of grid)
- P3 https://www.shiphero.com/software/rate-shopping [F]
- P4 https://shiphero.com/security/ [F]
- P5 https://shiphero.com/implementation [F]
- P6 https://www.shiphero.com/pricing [F] (no prices shown)
- P7 https://www.shiphero.com/3pl-warehouse-management-system, `/returns`, `/edi` [404, not read]
- P8 https://shiphero-saas.canny.io/changelog [F] (product changelog; Sep and Oct 2026 entries)

**Third party and not read (X)**
- X1 https://thirdfin.io/wms/shiphero/ [S] (a monthly WMS price claim; not verified)
- X2 https://www.socketmobile.com/support/apps/shiphero [S]
- X3 https://trust-center.shiphero.com (named on P4; not read)
- X4 https://status.shiphero.com (named in H-search; not read)
- X5 https://careers.shiphero.com/p/c045f6b65775-grc-privacy-analyst [S] (SOC 2 hiring signal)

**Repository (R)**
- R1 `adr/0001`, `0002`, `0005`, `0006`, `0008`, `0011`, `0012`, `0014`, `0018`, `0024`, `0025`, `0029`, `0031`, `0040` (accepted; ADR-0040 dated 2026-11-01)
- R2 `docs/architecture/domain-model.md` §3.1, §3.13, §4.1 to §4.16, §5
- R3 `docs/roadmap.md` §1.4, §1.5, §4 (Q-4, Q-13, Q-17, Q-33, Q-35) and §1.1 (PLAT-7, PLAT-8, PLAT-10)
- R4 `docs/research/features-wms-2026-11.md` on branch `docs/features-wms` (census P3, P7, P8)

## Unanswered

Facts no source settled (owner questions are in section 7):
- Whether ShipHero queues webhook events while an endpoint is disabled (D6 says discarded).
- Whether holds block picking or allocation (H14 is silent).
- Which app versions get the MIB resume (H1 names 2.15.19; the Oct 2026 changelog does not).
- The exact count of automation actions (H13 lists 64; a search summary said 63).
- Storage fee units and the full 3PL billing rules (D16 and third-party reviews conflict).
- Whether the public API has a sandbox (none documented in D2).
- Engineering stack and architecture beyond AWS hosting and PCI Level 1 provider (H23); no architecture source found.
