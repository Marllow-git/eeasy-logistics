# OTO public documentation census

Scope: OTO (tryoto.com) public marketing pages, the public docs at `https://docs.tryoto.com`, and the OTO API reference landing page at `https://apis.tryoto.com`. No login was used. OTO Flex app screens and the OTO admin app are behind a login and are listed in `docs/references/README.md`.

Fetched: 2026-10-31 (all facts below were read on that date unless marked otherwise).
Method: WebFetch on the pages cited. Where a page did not state a fact, this census says "not stated" rather than inferring it. Pages that timed out or did not load are listed in section 12.

Citation key:

- [HOME] `https://tryoto.com` (marketing home page)
- [LLMS] `https://docs.tryoto.com/llms.txt` (full docs index, 72 entries)
- [DEVOV] `https://docs.tryoto.com/developers/overview.md`
- [DEVREF] `https://docs.tryoto.com/developers/rest-api-reference.md`
- [DEVAUTH] `https://docs.tryoto.com/developers/authentication.md`
- [DEVHOOK] `https://docs.tryoto.com/developers/webhook-events.md`
- [DEVERR] `https://docs.tryoto.com/developers/errors-and-rate-limits.md`
- [QS] `https://docs.tryoto.com/get-started/quickstart.md`
- [GLOSS] `https://docs.tryoto.com/get-started/glossary.md`
- [SHIP] `https://docs.tryoto.com/modules/shipping-management/shipping-and-tracking.md`
- [CARR] `https://docs.tryoto.com/integrations/carriers.md`
- [CARRMOD] `https://docs.tryoto.com/modules/shipping-management/carrier-integration.md`
- [PLAN] `https://docs.tryoto.com/modules/oto-flex/planning.md`
- [FLEX] `https://docs.tryoto.com/modules/oto-flex/overview.md`
- [APIS] `https://apis.tryoto.com/`

## 1. What is public

- Marketing site: `https://tryoto.com` [HOME]. Positioned as "#1 AI-Powered Shipping Management Software."
- Docs site: `https://docs.tryoto.com` [LLMS]. Pages are published as Markdown with `.md` suffixes. The index lists 70 documentation pages plus two language indexes (`/_llms/ar.txt`, `/_llms/tr.txt`, each 69 pages).
- Docs sections (from [LLMS]): Get started; Modules (Omnichannel OMS, Sales Channels, Shipping Management, Return Management, Hubs Management, Customer Notification, Warehouse Management, Inventory Management, OTO FLEX); Integrations; Developers; Platform; Pricing.
- API reference: `https://apis.tryoto.com` [APIS] is described in [DEVOV] as "the live reference, with examples in 30+ languages." The fetched page showed only the title "OTO API V2"; its endpoint list was not reachable in the fetch.
- OpenAPI or Swagger file: **not found**. No OpenAPI JSON or YAML URL appears in [LLMS], [DEVOV], [DEVREF] or [APIS].
- Help center: `https://support.tryoto.com`, linked from [HOME]; not fetched.
- Postman collection: a page titled "OTO API Postman collection" exists at `https://docs.tryoto.com/developers/postman-collection.md` [LLMS]; not fetched.

## 2. Authentication

Source: [DEVAUTH], [DEVOV].

| Item | Value |
|---|---|
| Token exchange | `POST /rest/v2/refreshToken` with body field `refresh_token`, sent as `{ "refresh_token": "<your permanent token>" }` |
| Where the refresh token comes from | "Settings → API Integrations → Connect" [DEVOV] |
| Access token header | `Authorization: Bearer <access_token>` |
| Access token lifetime | "a lifetime of one hour" [DEVAUTH]; [DEVOV] says to fetch a token "Once an hour, not once a request." |
| Refresh token scope | "cannot be used to call anything except the token endpoint" [DEVAUTH] |
| Key scope beyond that | not stated |
| Sandbox | "has its own account and token, separate from production" [DEVAUTH] |

Base URLs [DEVOV]:

- Production: `https://api.tryoto.com`
- Sandbox: `https://staging-api.tryoto.com`

## 3. REST API shape

Source: [DEVREF], which states "All 76 OTO REST API endpoints in 20 groups." All endpoints are under `/rest/v2/`. Methods and paths are as the page lists them. Request and response field names are **not stated** on the reference landing page; only the endpoints named below in [QS] and [DEVOV] show any field names.

| Group | Method and path |
|---|---|
| Authorization | POST `/rest/v2/refreshToken`; GET `/rest/v2/healthCheck` |
| Account | GET `/rest/v2/accountInfo`; POST `/rest/v2/buyCredit`; POST `/rest/v2/requestMobileVerification`; POST `/rest/v2/verifyMobileNumber` |
| Transactions | POST `/rest/v2/getShippingPriceTransactionsList`; GET `/rest/v2/creditTransactions`; GET `/rest/v2/shipmentTransactions`; GET `/rest/v2/codTransactions` |
| Marketplace | POST `/rest/v2/marketplace/register`; POST `/rest/v2/marketplace/clientInfo`; GET `/rest/v2/marketplace/clientInfo` |
| Orders | POST `/rest/v2/createOrder`; POST `/rest/v2/updateOrder`; POST `/rest/v2/updateOrderStatus`; POST `/rest/v2/cancelOrder`; GET `/rest/v2/orders`; POST `/rest/v2/holdOrder`; POST `/rest/v2/unHoldOrder`; GET `/rest/v2/orderDetails`; POST `/rest/v2/checkOrderAvailability` |
| Shipping Prices | POST `/rest/v2/checkOTODeliveryFee`; POST `/rest/v2/checkDeliveryFee`; POST `/rest/v2/getDeliveryFee`; GET `/rest/v2/getDeliveryOptions` |
| Shipments | POST `/rest/v2/createShipment`; POST `/rest/v2/cancelShipment` |
| Return Shipments | POST `/rest/v2/createReturnShipment`; POST `/rest/v2/getReturnLink`; POST `/rest/v2/getReturnDetails`; POST `/rest/v2/triggerReturnSms` |
| Print | GET `/rest/v2/print/orderId`; POST `/rest/v2/printLabel` |
| Tracking | POST `/rest/v2/orderStatus`; POST `/rest/v2/orderHistory`; POST `/rest/v2/trackShipment` |
| Customer Notifications | GET `/rest/v2/orders/{orderId}/customer-notifications` |
| Carrier Integrations | POST `/rest/v2/getDeliveryEstimation`; POST `/rest/v2/aiEstimatedDeliveryDates`; POST `/rest/v2/checkCoverage`; POST `/rest/v2/availableCities`; POST `/rest/v2/availableTimeslots`; POST `/rest/v2/dcList`; POST `/rest/v2/dcConfig`; POST `/rest/v2/dcActivation`; POST `/rest/v2/getCities`; POST `/rest/v2/checkDCBranchList` |
| Pickup Locations | POST `/rest/v2/createPickupLocation`; POST `/rest/v2/updatePickupLocation`; GET `/rest/v2/getPickupLocationList` |
| Brands | GET `/rest/v2/getBrandList`; POST `/rest/v2/createBrand` |
| Sales Channels | GET `/rest/v2/salesChannel/getSalesChannelsList`; POST `/rest/v2/salesChannel/getSalesChannelConfig`; POST `/rest/v2/salesChannel/salesChannelActivation` |
| Products | POST `/rest/v2/createProduct`; POST `/rest/v2/productList`; POST `/rest/v2/addBox`; POST `/rest/v2/updateBox`; GET `/rest/v2/getBox` |
| Stock Management | POST `/rest/v2/updateStockQuantity`; GET `/rest/v2/checkInventoryStock`; GET `/rest/v2/checkGlobalStock`; POST `/rest/v2/createInventoryOrder`; POST `/rest/v2/updatePackingStatus`; POST `/rest/v2/getPackingOrders`; POST `/rest/v2/availableStoresForPickup`; POST `/rest/v2/availableCitiesForPickup` |
| National Address | POST `/rest/v2/getNationalAddressFromShortCode` |
| Webhook | POST, GET, PUT, DELETE `/rest/v2/webhook` |
| OTO FLEX | POST `/rest/v2/assignDriver`; POST `/rest/v2/trackDriver` |

Pagination: not stated. Rate limits: not stated (see section 9).

Flow shown in [QS]: refresh token, then `POST /rest/v2/createOrder`, then `POST /rest/v2/createShipment`, then `POST /rest/v2/webhook`. Polling is described as using `orderStatus`, without a method or path.

## 4. Order and shipment concepts

Source: [GLOSS], [SHIP], [QS].

- Order: "What the customer bought. Exists whether or not anything has shipped." [GLOSS]
- Shipment: "The booking with a carrier to move goods, created from an order." [GLOSS]
- Task: "One stop on a route — a pickup or a delivery." [GLOSS]
- Stock terms: Available ("Stock that can still be promised to a customer. Falls when an order is assigned to a pickup location.") and On Hand ("Stock physically in the building. Falls when goods leave, at fulfillment.") [GLOSS]
- Create shipment: `POST /rest/v2/createShipment` [QS]. Create order: `POST /rest/v2/createOrder` [QS]. Request body field names: not stated on any page read.
- Carrier shipment failure: a shipment "fails to be created with the carrier" triggers the `shipmentError` webhook [DEVHOOK].

## 5. Shipment and order status vocabulary

Source: [SHIP], [DEVHOOK], [DEVREF], [QS], [DEVERR].

Confirmed status words, with the meaning the docs give:

| Term | Meaning | Source |
|---|---|---|
| Shipment Canceled | the order returns to "Pending Orders" with this status after its shipment is canceled, so it can be re-booked | [SHIP] |
| Delivered | shipments move to this tab on completion | [SHIP] |
| Currently Shipping | a tab listing shipments in flight (a UI tab name, not a status value) | [SHIP] |
| delivered, returned, pickedUp | examples of statuses a merchant can force from its own system via `updateOrderStatus` | [DEVREF] |
| "processing, delivered, returned and everything between" | description of the `orderStatus` webhook's scope; no full list | [DEVHOOK] |
| "Shipment Creation Attempt Failed", "SLA Breach" | two notification events named in the quickstart | [QS] |

Not stated:

- The full normalised order and shipment status list. OTO "maps carrier statuses to one set but does not list them" [SHIP]. The full list is said to be maintained on `apis.tryoto.com` under "Error Codes" [DEVERR]; that page did not render its content.
- Exact status literals used in webhook payloads.

Tracking events (a sample, not confirmed as labels): the caption of a sample journey lists "information received, SMS sent to receiver, departed terminal, arrived destination, held for pickup, arrived terminal, and undelivered attempt" [SHIP]. The caption says it does not confirm these as exact status labels.

Status history columns [SHIP]: Date, Delivery Company, Shipment ID, Description, Location, normalised Status. Failed attempts are recorded with an attempt count and a failure reason from a merchant-configured "Reason Settings" list; the exact event names are not stated.

Carrier pickup log: fields Message, Status, LOG Status; allowed values not stated [SHIP].

## 6. Webhooks

Source: [DEVHOOK], [DEVREF].

Registration: `POST /rest/v2/webhook` (plus GET, PUT, DELETE on the same path) [DEVREF]. [DEVOV] says the webhook is registered "once, not per order."

Events, as named on [DEVHOOK]:

| Event | Fires when | Payload fields named |
|---|---|---|
| `orderStatus` | "An order's status changes — processing, delivered, returned and everything between" | "the order and its new state", carrier and driver, tracking number and URL, an AWB link, `timestamp` in UTC. Exact field names not stated. |
| `shipmentError` | "A shipment fails to be created with the carrier." | `orderId`, `errorCode`, `errorMessage`, `deliveryCompanyResponse`, `timestamp` |
| `newOrders` | "An order arrives in OTO." | "the whole order". Exact field names not stated. |

Signature (per [DEVHOOK]):

- Every payload carries a `signature` field.
- Method: "an HMAC-SHA256 over a colon-joined string, base64 encoded, using the `secretKey` you registered."
- Signed string: `orderId:status:timestamp` for `orderStatus`; `orderId:errorCode:timestamp` for `shipmentError`; not stated for `newOrders`.
- Verification: recompute, then compare with a constant-time comparison.
- Replay: "check the timestamp is recent."

Retries: schedule, attempt count and backoff not stated. The page says only that "Deliveries can repeat," so the endpoint must handle duplicates.

The docs index lists a page "Webhooks for real-time updates" under Integrations [LLMS]; that page was not fetched.

## 7. Dispatch and routing vocabulary (OTO FLEX)

Source: [PLAN] (the planning page), [FLEX] (overview).

The user brief named "simulate, optimise, create, assign." What the public docs say:

| Term | Publicly described meaning | Source |
|---|---|---|
| Build (routes) | "build routes"; "Orders are grouped into a route." Each route is a set of orders for one driver or vehicle. | [PLAN] |
| Optimize | Routes are "optimized against real traffic data," sequenced on live traffic, not straight-line distance. "Optimization runs across multiple drivers at once." Spelled "Optimize" in the page. | [PLAN] |
| Simulate | "it can be simulated before a driver is committed to it." A different grouping can be tested and its outcome seen before dispatch. | [PLAN] |
| Assign | "assign drivers to tasks automatically." Methods: Nearest Driver, Broadcast, Least Task, Manual, Area Based. | [PLAN] |
| Plan | Scheduled orders are "planned into the slot" so the route respects the customer's delivery window. | [PLAN] |
| Create | not used as a verb in [PLAN]; only "creation" in a cross-reference to scheduled shipment creation. | [PLAN] |
| Assigns, routes, tracks, settles | "OTO assigns, routes, tracks and settles" | [FLEX] |
| Driver assignment API | `POST /rest/v2/assignDriver`; tracking `POST /rest/v2/trackDriver` | [DEVREF] |

The overview page [FLEX] does not use "simulate" or "optimise". Fleet Management has 10 features, per [FLEX]. Other OTO FLEX pages in [LLMS]: Driver and fleet management; Delivery planning and driver assignment; Driver pickup; Last-mile delivery.

## 8. Carrier catalogue and service vocabulary

Carrier count (two different public numbers, both from OTO's own pages):

- [CARR]: "460+ carrier integrations worldwide for your own contracts"; "15+ carriers on OTO rates."
- [CARRMOD]: "OTO integrates with 460+ delivery companies worldwide"; "15+ of them are also available on OTO rates, with no contract needed."
- [HOME]: "One API connects to more than 460 local and international carriers and 45+ sales channels."
- The carrier names are not enumerated on [CARR] (only Aramex is named, as an example with several services).
- Note: the foundation plan (section 9) records the catalogue as 433. The public pages say 460+. The 433 figure was not found in any page read here and should be checked against the eeasynew teardown before it is used.

Carrier and service terms [CARRMOD], [SHIP]:

- Carrier states: Active (on/off toggle), Connected (list of carriers already added), Passive ("anything left inactive is treated as Passive"; cities excluded from automatic shipment creation), Default Covered (a city the carrier serves that the merchant has not confirmed).
- Actions: Connect, Test Connection, Tools (bulk city coverage), Upload Data (imports an SLA table), Create Shipment, "With My Rates", Create Reverse Shipment With My Rates.
- Carrier action labels in the carrier table: "Select" (booking allowed) and "Verify" (connection must be verified before booking).
- Automatic Shipment: the default per-order option, where shipping automation picks the carrier.
- Service types: "Same Day Delivery", "Express", "PUDO (Pick up drop off)", "Locker Delivery", plus "4-hour", "cold delivery", "heavy and bulky", "international."
- First mile: "Pickup By Courier", "Branch Drop Off", "Locker Drop Off".
- Last mile: "Customer Doorstep", "Pickup By Customer", "Pickup By Customer (Locker)".
- Star rating: a carrier's measured performance score.
- Refund timing: "Varies by carrier, from immediate to 30 days."
- Carrier API endpoints in the Carrier Integrations group are listed in section 3.

## 9. Errors and rate limits

Source: [DEVERR].

- Error response shape: not stated.
- Failure types named: 4xx, 401, and 5xx or timeouts. No schema.
- Error codes: not listed on [DEVERR]; referred to `apis.tryoto.com` "Error Codes".
- Rate limits: not stated. The page advises using webhooks and narrow polling filters rather than polling.
- The only error fields named anywhere are the `shipmentError` webhook fields (`errorCode`, `errorMessage`, `deliveryCompanyResponse`) [DEVHOOK], which are not API error responses.

## 10. Labels and documents

Source: [SHIP].

| Document | Purpose |
|---|---|
| Shipping label (AWB) | Air waybill for the parcel |
| Return AWB | Reverse label for returns |
| Order Details With AWB | Order contents and label on one sheet |
| Delivery Company Pickup List | Handover manifest for the carrier driver |
| Order Details | The order alone |
| Pick List (PDF) | Warehouse picking list, PDF format |
| Pick List Export | Same content as data; format not specified |
| International Proforma | Customs declaration for cross-border shipments |

- AWB languages: English, Turkish and Arabic.
- Label file format other than the Pick List PDF: not stated.
- The API printing endpoints are `GET /rest/v2/print/orderId` and `POST /rest/v2/printLabel` [DEVREF]; their formats are not stated.

## 11. Pricing and plans (marketing)

Source: [HOME]. The pricing page `docs.tryoto.com/pricing/plans-and-packaging.md` [LLMS] was not fetched, so these numbers are from the marketing home page only.

| Plan | Price (SAR per month, per [HOME]) | Orders per month |
|---|---|---|
| Free | 0 | under 50 |
| Starter | 59 | 50 to 1,000 |
| Scale | 279 | 250 to 5,000 |
| Pro | 1,599 | 1,000 to 10,000 |
| Enterprise | custom | not stated |

Shipping options on the home page: own courier contracts; OTO's discounted rates ("paid in SAR, with no contracts or minimums"); or own drivers.

## 12. Pages reachable and not reachable

Reachable 2026-10-31: `https://tryoto.com`, `https://docs.tryoto.com/llms.txt`, `https://docs.tryoto.com/developers/overview.md`, `.../developers/authentication.md`, `.../developers/rest-api-reference.md`, `.../developers/webhook-events.md`, `.../developers/errors-and-rate-limits.md`, `.../get-started/quickstart.md`, `.../get-started/glossary.md`, `.../modules/shipping-management/shipping-and-tracking.md`, `.../modules/shipping-management/carrier-integration.md`, `.../integrations/carriers.md`, `.../modules/oto-flex/planning.md`, `.../modules/oto-flex/overview.md`, `https://apis.tryoto.com/` (title only).

Not reachable 2026-10-31: `https://docs.tryoto.com/get-started/core-concepts.md` (timeout, 60 s). `https://docs.tryoto.com/` (ECONNRESET on one attempt; the `.md` pages were read instead). `https://docs.tryoto.com/developers/postman-collection.md` and the pricing page were listed in the index but not fetched.

## 13. What we could not verify

- Full order and shipment status list (the source of truth is said to be `apis.tryoto.com`, which did not render).
- Field names for create order, create shipment, webhooks, and every endpoint in section 3 except the names listed in section 4.
- OpenAPI file: none found.
- Whether `orderStatus` webhook fields beyond those listed exist.
- The 433 carrier count in the plan; public pages say 460+.
- Whether OTO FLEX's "simulate" and "optimise" steps are exposed through the API (the endpoint list has no simulate or optimise path).
- The support centre and Postman collection content.
- Any login-gated screen or data model.

## 14. Relevance to eeasy-logistics

- Public-API shape: OTO uses an OAuth-style refresh-token exchange with one-hour bearer tokens, and a separate sandbox account. The Logestechs API uses a static `X-API-Key`. Both expose order and shipment creation, cancel and returns.
- Webhooks: OTO signs payloads with HMAC-SHA256 over a colon-joined string and documents replay checks. Logestechs sends a configured password in headers with no retries. Our plan is closer to OTO's model.
- Dispatch vocabulary (build, optimise with traffic, simulate before dispatch, assign by method) is publicly described in [PLAN]; the plan should cite that page when used.
- Status vocabulary: OTO's public docs do not publish the status list, so any mapping must come from the login-gated app or from our own design.
