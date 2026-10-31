# Logestechs public API census

Scope: the public API documentation at `https://docs.logestechs.com` only. No login was used. The admin portal (admin-pro.logestechs.com) is out of scope and is listed as a login-gated item in `docs/references/README.md`.

Fetched: 2026-10-31 (all facts below were read on that date unless marked otherwise).
Method: WebFetch on the docs site, its per-endpoint Markdown pages, and its schema pages. Where a page did not state a fact, this census says "not stated" rather than inferring it.

Citation key used below:

- [O] `https://docs.logestechs.com/overview-2344856m0.md` (Overview)
- [W] `https://docs.logestechs.com/package-status-webhook-2344867m0.md` (Package Status Webhook)
- [S] `https://docs.logestechs.com/package-17159581d0.md` (Package schema, and the full schema list)
- [E] the endpoint page cited next to each row in the table below

## 1. Documentation structure and machine-readable spec

- Site index: `https://docs.logestechs.com/llms.txt` returned no usable page list in the tool output; the site root `https://docs.logestechs.com/` lists the sections "Overview", "Package Status Webhook", "API Docs: Packages", "API Docs: Addresses", and a long "Schemas" section. [site root, 2026-10-31]
- A guessed page `https://docs.logestechs.com/authentication` returned HTTP 404. It is not a real page; no authentication page was found beyond the Overview.
- OpenAPI or Swagger file: the root and the Overview do not link one. The per-endpoint pages are rendered from an OpenAPI-style spec (they show `operationId`, parameter tables and schema names such as `IntegrationPackageRequestDto`). Whether the raw spec file is published at a URL was **not verified**; no spec URL was seen in any fetched page.
- Sandbox base URL: **not stated** in [O].

## 2. Authentication

| Item | Value | Source |
|---|---|---|
| Header name | `X-API-Key` on every request | [O], [E] |
| Header value format (sample) | `psk_integration_xxxxxxxxxxxxxxxxxxxxxxxx` | [O] (sample only) |
| Key scope | one customer account. Quote: "The key is resolved to the company and customer." | [E] create, status, cancel |
| How a key is issued | a company admin issues it under Partners > API Integrations; the full key is shown only at creation and can only be regenerated | [O] |
| Lifecycle | admins can regenerate, disable or delete the key at any time, separately from any customer portal password | [O] |
| Extra headers | any `company-id` header is ignored; email and password must not be sent | [E] status history, return |
| Auth failure | HTTP 401 for a missing, unknown, expired or disabled key, or a key issued for a different API surface | [E] all secured endpoints |

## 3. Base URL

- Production: `https://apisv5.logestechs.com/api` [O], [E]. All paths below are relative to this base; the `/secure/integration/...` prefix is part of every path.
- Sandbox or staging base URL: not stated.

## 4. Endpoints

All endpoints are under `/secure/integration`. Auth is `X-API-Key` for all of them. Request and response fields are quoted exactly as the spec names them. Where the spec does not define a response schema, the table says "not stated".

### 4.1 Packages

| Method | Path | Purpose | Key request fields | Key response fields | Source |
|---|---|---|---|---|---|
| POST | `/packages` | Create a shipment (package) | body `IntegrationPackageRequestDto`: `destinationAddress` (required), `receiverName` (req), `receiverPhone` (req), `shipmentType` (req; enum `COD`, `REGULAR`, `SWAP`, `BRING`), `cod` (req, number), `originAddress`, `senderName`, `senderPhone`, `receiverPhone2`, `paymentType`, `paymentTypeId`, `description`, `notes`, `invoiceNumber`, `quantity`, `weight`, `width`, `length`, `height`, `parcelTypeId`, `serviceTypeId`, `vehicleTypeId`, `packageItemsToDeliverList` (also accepted as `items`), `webhookUrl` | 200: schema has no named properties; "Response fields: Not stated." | [E] create-a-shipment |
| GET | `/packages/status` | Current status of one package | query: exactly one of `id` (int64), `barcode`, `invoice` | 200: "Not stated" (string map, no named fields) | [E] get-a-packages-current-status |
| GET | `/packages/status/history` | Ordered status history | query: exactly one of `id`, `barcode`, `invoice` | 200: array of `PackageStatusResponse` with `packageId`, `changedById`, `changedBy`, `createdDate`, `companyId`, `packageTrackingStatus`, `statusKey`, `failedStatus`, `integrationSource` | [E] get-a-packages-full-status-history |
| GET | `/packages/statuses` | Reference list of every package status, with labels | none (header only) | 200: array of objects with `key`, `englishValue`, `arabicValue` | [E] list-the-possible-package-statuses |
| PUT | `/packages/cancel` | Cancel a package | query: exactly one of `id`, `barcode`, `invoice` (no body) | 200: no body fields specified; 400 "already cancelled" or "already in process" | [E] cancel-a-package |
| PUT | `/packages/return` | Request return to sender | query: exactly one of `id`, `barcode`, `invoice`; optional `timezone` (IANA, e.g. `Asia/Riyadh`); body `NoteMessage`: `note`, `noteKey`, `isCostPaid` (write-only), `costPaid`, `deliveryProofUrlList` (array of strings) | 200: "Return requested."; no body fields specified | [E] return-a-package-to-sender |
| POST | `/packages/awb` | Generate AWB PDF for 1 to 100 packages | body `PackageIdentifiersWrapper`: `ids` (int64 array), `barcodes` (string array), `invoicesNumbers` (string array); query `timezone`, `type` (label size) | 200: described as "URL of the generated PDF report"; body encoding not stated | [E] generate-an-awb-pdf |
| POST | `/packages/cost` | Calculate delivery cost | body `GetPackageCostMessage`: `originRegionId`, `destinationRegionId`, `destinationVillageId`, `parcelTypeId`, `isDeliverToReceivingPoint`, `customerId`, `serviceTypeId`, `vehicleTypeId`, `packageId`, `weight`, `totalDistance`, `shipmentType`, `length`, `depth`, `width`, `cod`, `isInsured`, `paymentType`, `paymentTypeId`, `promoId`, `quantity`, `subPackages`, `deliverToReceivingPoint` | 200: example `{"cost": 25.0}` | [E] calculate-a-shipments-delivery-cost |

### 4.2 Reference data (service types, parcel and vehicle types)

| Method | Path | Purpose | Key response fields | Source |
|---|---|---|---|---|
| GET | `/packages/service-type` | List the company's service types | array of `name` (string), `id` (int64) | [E] list-the-companys-service-types |
| (path not read) | "List the company's vehicle types" | Vehicle types, referenced by `vehicleTypeId` on create | not read | [site root] |
| (path not read) | "List the company's parcel types" | Parcel types, referenced by `parcelTypeId` on create | not read | [site root] |

Only the page titles for vehicle and parcel types were seen on the site root. Their paths were not read, so none is given.

### 4.3 Addresses

| Method | Path | Purpose | Key response fields | Source |
|---|---|---|---|---|
| GET | `/address/cities` | Address book of cities (regions and cities) | array of `City`: `createdDate`, `id`, `companyId`, `name`, `arabicName`, `englishName`, `regionId`, `hubId`, `isSelected`, `isAddedByUser`, `prefix`, `color`, `arabicRegionName`, `regionName`, `countryCode`, `geofenceData`, `geofenceDataId` | [E] list-the-companys-address-book |
| (listed) | regions, a region's cities, a city's villages, villages | Address hierarchy endpoints (region, city, village). Titles seen: "List regions", "List a region's cities", "List a city's villages", "List villages". Paths not read. | not read | [site root] |

Address hierarchy: a request location is identified by one of `villageId`, `cityId`, `village` or `city` (from the `IntegrationAddressDto` spec in [E] create-a-shipment). `IntegrationAddressDto` fields: `addressLine1` (req), `addressLine2`, `villageId`, `cityId`, `regionId`, `village`, `city`, `latitude`, `longitude`, `shortAddress`.

### 4.4 Endpoints listed in the index but not read

Endpoints that appear only as titles on the site root and were not fetched: none beyond those named in 4.2 and 4.3. The site root's "Schemas" section lists a long set of schema names; only the schemas quoted above were read.

## 5. Pagination

- Not stated for any endpoint. The address book and status-history responses are plain arrays; no `page`, `limit` or cursor fields were seen.

## 6. Error shape

- The 401 body is documented as: `{"status":401,"error":"Unauthorized","message":"<code>","messageKey":"<code>"}` (fields `status`, `error`, `message`, `messageKey`). [E] create, status, cancel, return, awb, service type, address, cost.
- 400, 403 and 404 bodies: the spec gives a string map with no named fields. Error codes are not enumerated.
- 400 cases quoted in [E]: "No identifier provided"; for create, "a city/village name matches nothing" and a payload missing `destinationAddress`; for cancel, "package already cancelled" and "package already in process".
- 403: "The package belongs to a different customer."
- 404: "No package matches the given identifier."

## 7. Rate limits

- Not stated in [O] or in any endpoint page read.

## 8. Webhooks

Source: [W].

- Support: yes, outbound. The integration sets a `webhookUrl` on create [E], and the Package Status Webhook page describes the push. Quote: "sends an HTTP POST notification to the Webhook URL configured for that integration."
- Content-Type: `application/json`.
- Event names: "created, cancelled, returned, delivered, postponed, and more." The full list is **not stated**.
- Payload field names: `packageId`, `barcode`, `invoiceNumber`, `status`, `newStatus`, `cod`, `paymentMethod`, `time`, `notes`, `reason`, `driverName`, `driverPhone`, `signatureUrl`, `postponedDeliveryDate`, `attachmentUrls`, `pinCode`. Empty fields are omitted.
- Example `status` value on the page: `DELIVERED_TO_RECIPIENT` (the only status literal seen on [W]).
- Authentication of the callback: no request signature is described. The sender puts a configured "Webhook Password" in one of these headers: `Authorization`, `api_key`, `ApiKey`, `api-key`, `x-api-key`. The username goes in `username` and `account_name` headers. Signature scheme: not stated.
- Retries: "Logestechs does not retry failed deliveries." Any 2xx acknowledges receipt.
- Ordering and duplicates: not stated.

## 9. Status and tracking vocabulary

Three separate vocabularies exist. Only the first two have values seen in public docs.

### 9.1 Package tracking node types (`PackageTrackingNodeMessage.typeKey`)

Source: [S] (enum in the schema). Each value's meaning is **not stated** in the docs; they are listed as the enum only.

`PENDING`, `OPENED_ISSUE_AND_WAITING_FOR_MANAGEMENT`, `IN_TRANSIT`, `DELIVERED`, `RETURNED`, `LOST`, `POSTPONED`, `IN_HUB`, `COD_DELIVERED`, `CANCELLED`, `EXCHANGED`, `BEING_PROCESSED`

`PackageTrackingNodeMessage.status` is a string with no enum stated.

### 9.2 Package status keys (`/packages/statuses`)

Source: [E] list-the-possible-package-statuses. The endpoint returns `key`, `englishValue`, `arabicValue`. The actual values are **not in the public docs**: the endpoint description says only "Static reference data — the full set of statuses a package can be in, with English and Arabic labels", and calling it needs a key. So the full status list was not captured, and no status values are invented here.

Other status-like string fields with no enum in the docs: `packageTrackingStatus`, `statusKey`, `failedStatus` on `PackageStatusResponse` [E] status history.

### 9.3 Integration source (`PackageStatusResponse.integrationSource`)

Source: [E] status history. Enum values, as listed:

`ZID`, `SALLA`, `OTO`, `FASTCOO_APP`, `NAOURI`, `TOROD`, `EXCEL`, `FULFILLMENT`, `MANUAL`, `TRANSFER`, `INTEGRATION`, `SHOPIFY`, `PARTNER`, `WOOCOMMERCE`, `PIK`, `BY_ADMIN`, `BY_CUSTOMER`, `ZID_REFRIGERATED`, `MADAR`, `NUPCO`, `AJEX`, `OLIVERY`, `REDBOX`, `STARLINK`, `OPENCART`, `SMSA`, `CARRIYO`, `TAIAR`, `MARKETING_CAMPAIGN`, `PUBLIC_LINK`, `ZAIN`, `IMILE`, `SOCIAL_SELLER`, `DAMAGED_PRODUCTS_REQUEST`, `ARAMEX`, `BREAKDOWN`, `CYCLE_COUNT`, `DELIVERECT`

This list is useful as evidence of which upstream platforms Logestechs already integrates with (for example `SALLA`, `SHOPIFY`, `WOOCOMMERCE`, `OTO`, `ARAMEX`).

### 9.4 Webhook event names

See section 8: "created, cancelled, returned, delivered, postponed, and more" [W].

## 10. AWB and label formats

Source: [E] generate-an-awb-pdf.

- Output: a PDF. The response is described as a "URL of the generated PDF report"; the exact encoding is not stated.
- Identifiers: up to 100 per request across `ids`, `barcodes` and `invoicesNumbers`. Every matched package must belong to the key's customer.
- Timezone: optional IANA name, e.g. `Asia/Riyadh`.
- Label size (`type` query): if omitted, the company's default AWB layout is used. Allowed values: `STICKER`, `STICKER_10_9`, `STICKER_10_10`, `STICKER_15_10`, `STICKER_10_15`, `STICKER_6_4`, `STICKER_4_6`, `STICKER_8_16`, `STICKER_8_5`, `STICKER_HALF_A4`, `STICKER_A6`, `QR`.
- Dimension notes given in the spec: `STICKER` and `STICKER_10_9` are both 10 x 9 cm; `STICKER_HALF_A4` is 21 x 14.8 cm; `STICKER_A6` is 10.5 cm wide (height not stated); `QR` is 5 x 5 cm. The spec's labels conflict for `STICKER_15_10`/`STICKER_10_15` and `STICKER_6_4`/`STICKER_4_6` (the name and the stated dimensions disagree). Confirm before using these names.
- Example request: `POST /secure/integration/packages/awb?type=STICKER_10_10`.

## 11. Address book and service type concepts

- Address book: `GET /address/cities` returns cities with `regionId`, `hubId`, `geofenceData` (with `geofencePoints`, `geofenceColor`, `type`). Hierarchy is region > city > village; villages are the finest unit (`villageId`).
- Service types: a company-scoped list of `{name, id}`. The request field is `serviceTypeId`. What each service type does is **not stated**.
- Parcel types and vehicle types: company-scoped lists, referenced by `parcelTypeId` and `vehicleTypeId`. Field shapes not captured.
- Shipment types: `COD`, `REGULAR`, `SWAP`, `BRING` (enum on create) [E].
- Payment types: `paymentType` string enum "e.g. CASH, CHEQUE, MULTI" (only these three examples are given) [E].

## 12. Shipment and cancellation rules

- Cancel: only before pickup. Packages still pending customer-care approval or dispatcher assignment can be cancelled; further-along packages go through the help center [E] cancel.
- Return: the package must already be out for delivery [E] return.
- Identifier rule: exactly one of `id`, `barcode`, `invoice` for status, history, cancel and return.

## 13. What we could not verify

- Full status value list (needs the authenticated `/packages/statuses` call, or the admin portal).
- Response bodies for create, cancel and return (spec gives none).
- Vehicle-type and parcel-type list paths and fields.
- Webhook event list in full, signature scheme, and retry details beyond "does not retry".
- Whether a sandbox base URL exists.
- Rate limits and pagination.
- Whether the Package schema (`[S]`, very long) has further enum values after the first 100,000 characters; it was read only to the `CustomerPromo` schema.

## 14. Mapping to eeasy-logistics

Relevant to the foundation plan section 9 ("public-API shape: one `X-API-Key` per customer account; create, cancel, return, track with history, AWB PDFs, address book, service types; we add webhooks and a sandbox"):

- Confirmed in public docs: one key per customer account; create; cancel (pre-pickup only); return (out-for-delivery only); status and status history; AWB PDF; address book; service types; webhook push.
- Sandbox: not stated in the public docs, so no sandbox is confirmed for Logestechs. Webhook delivery is weaker than the plan implies: a configured password sent in headers, no request signature described, and no retries.
- The public docs never state rate limits or pagination.
