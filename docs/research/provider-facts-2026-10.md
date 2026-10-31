# Provider facts to confirm, October 2026

Date of research: 2026-10-31. Scope: every item marked **to confirm** in `docs/architecture/integrations.md` that a public page can settle, plus the Hudhud, National Address, VROOM, OSRM and map-licence items the owner asked for. Public pages only (WebSearch and WebFetch, no logins). Verdicts:

- **confirmed**: the public page states the claim.
- **contradicted**: the public page states something different; the source line is quoted.
- **not stated**: no public page read says it.

Where a fact came from a search excerpt and the primary page could not be fetched, the verdict says so. Companion file: `docs/research/whatsapp-providers-2026-10.md` (WhatsApp items are there, not here).

## 1. Salla webhook signature header names and strategy

Claim in document (integrations §3.2, marked to confirm): signature header `X-Salla-Signature` and strategy header `X-Salla-Security-Strategy`; HMAC-SHA256 of the body with the app webhook secret; no timestamp in the signature.

| Field | Value |
|---|---|
| Public documentation | Header `X-Salla-Security-Strategy` identifies the strategy; `Signature` is the default when none is given. Signature appended to `X-salla-signature`. Digest is SHA256 HMAC-keyed with the webhook secret over the request body. No timestamp is mentioned in the section. Verification text recommends a timing-safe equality function; the examples use plain equality. Strategy values: `signature`, `token`, `none`. Retries: about three attempts about five minutes apart after a roughly 30-second wait, stopping at the first success. |
| URL | https://docs.salla.dev/421119m0.md |
| Date | 2026-10-31 |
| Verdict | **confirmed** (header names, algorithm, absence of timestamp). Note: the doc's "step 4 skipped" design is consistent; the public examples do not use a timing-safe compare, so our adapter should not copy them. |

## 2. Salla token lifetimes and refresh

Claim in document (§8.2, to confirm): Salla access tokens about 14 days; refresh tokens single-use; Easy Mode via `app.store.authorize` is preferred.

| Field | Value |
|---|---|
| Public documentation | "Access tokens expire after 2 weeks (14 days)." Refresh response sample `expires_in: 1209599`. "A refresh token lasts for 1 month, and attempting to use it twice invalidates the associated access token." "Refresh tokens are single-use only, meaning they become invalid after the first use." Token endpoint `https://accounts.salla.sa/oauth2/token`. Easy Mode is "recommended" and delivers tokens via `app.store.authorize` to the webhook URL. |
| URL | https://docs.salla.dev/421118m0.md |
| Date | 2026-10-31 |
| Verdict | **confirmed**. Add to the doc: reusing a refresh token also invalidates the access token, which supports the row-lock design in §8.2. |

## 3. Zid webhook authentication

Claim in document (§3.2, to confirm): path carries the connection id and a per-connection random secret "sent as a query token we set at registration"; no body signature is documented.

| Field | Value |
|---|---|
| Public documentation | Create-webhook body accepts optional `username` and `password`: "Username used for Basic Auth verification when sending webhook requests." Zid then sends: "Zid will send webhook requests with the following header:" followed by `Authorization: Basic dXNlcjpzZWNyZXQ=`. No signature, HMAC or signing secret is described ("Not stated"). No query-string token is described. |
| URL | https://docs.zid.sa/create-a-webhook |
| Date | 2026-10-31 |
| Verdict | **contradicted** on the transport of the secret: the public spec sends HTTP Basic Auth, not a query token. The "no body signature" statement is **confirmed** (signature: not stated). Recommended edit: use `username` and `password` set at registration, compared in constant time, and keep the fetch-by-id verification. |

## 4. Zid two-header request authentication

Claim in document (§8.2, to confirm): the token response carries two credentials sent as two headers on every call.

| Field | Value |
|---|---|
| Public documentation | "Almost every API request requires **both** the `Authorization` and `X-Manager-Token` headers." Product-component endpoints accept the manager token as `Access-Token`, same value. Token lifetimes: newly issued Authorization tokens valid 3 years; tokens issued before mid-2025 carry 1 year, so `expires_in` must be read per response. Manager token has the same expiry as the Authorization token. Refresh token: 1 year; "The refresh token expires two years before the access token." Refresh is a POST to `https://oauth.zid.sa/oauth/token` with `grant_type=refresh_token`; "the old refresh token is revoked." Authorization code valid 10 minutes, single use. |
| URL | https://docs.zid.sa/authorization |
| Date | 2026-10-31 |
| Verdict | **confirmed** (two headers). Additions for §8.2: refresh revokes the old refresh token, so the serialised row-lock applies to Zid too; lifetimes differ by issue date and must be read from each response. |

## 5. Zid webhook registration API

Claim in document (§3.2 and §8.5): webhooks are registered per store through the Zid API with an event and a target URL.

| Field | Value |
|---|---|
| Public documentation | `POST https://api.zid.sa/v1/managers/webhooks`. Body: `event` (required), `target_url` (required), `original_id` (required, "A unique identifier for the app that created this webhook"), optional `conditions` (`status`, `delivery_option_id`, `payment_method`; supported for `order.create` and `order.status.update`), optional `username` and `password`. Headers: `Authorization` and `X-Manager-Token`. |
| URL | https://docs.zid.sa/create-a-webhook |
| Date | 2026-10-31 |
| Verdict | **confirmed** (event and target URL). Not in the document: the required `original_id`, and the per-event `conditions` filter. The uninstall webhook is named `app.market.application.uninstall` on the error-handling page (https://docs.zid.sa/authorization); the document says only "Zid equivalent". |

## 6. Expo push rate limit per second and receipts API

Claim in document (§4.2 and §2.5, to confirm): about 600 notifications per second per project; receipt polling is a scheduled job.

| Field | Value |
|---|---|
| Public documentation | `TOO_MANY_REQUESTS`: "You are exceeding the request limit of 600 notifications per second per project." Up to 100 messages per request (`PUSH_TOO_MANY_NOTIFICATIONS` at more than 100). Receipts: `POST https://exp.host/--/api/v2/push/getReceipts` with `ids` array of ticket IDs; check about 15 minutes after sending; receipts cleared after 24 hours. `DeviceNotRegistered`: stop sending to that token. |
| URL | https://docs.expo.dev/push-notifications/sending-notifications/ |
| Date | 2026-10-31 |
| Verdict | **confirmed**. Our queue limit of 500 per second (§4.2) sits under the 600 public limit. Receipts must be read within 24 hours, so the polling job should run at least every few hours. |

## 7. Meta template review time

Claim in document (§5.2, to confirm): "Meta reviews most templates within 24 hours but can take longer or re-categorise a utility template as marketing."

| Field | Value |
|---|---|
| Public documentation | "Review can take up to 24 hours." Shown under the In-Review status in WhatsApp Manager. Review is automatic on create or edit. Category "also factor[s] into pricing." Re-categorisation rules: not stated on this page; it refers to a separate categorisation page (not read). No statement that review can take longer than 24 hours. |
| URL | https://developers.facebook.com/docs/whatsapp/message-templates/guidelines |
| Date | 2026-10-31 |
| Verdict | **contradicted in part**. Source line: "Review can take up to 24 hours." The document's "can take longer" has no support on this page. Re-categorisation from utility to marketing: **not stated**. Treat the three-week lead in §5.2 as a planning margin, not a Meta commitment. |

## 8. Hudhud public API documentation

Claim in document (§6.1, §6.2, §6.3, §12.2, all to confirm where marked): geocoding; National Address short-code lookup (`lookupShortCode`); distance matrix; B2B key; price per call and quota are open; traffic-aware departure times if offered (to confirm).

| Item | Public documentation | Verdict |
|---|---|---|
| Geocoding | `POST https://b.hudhud.sa/v1/geocoding/search`, Bearer secret key, JSON body with a query string. "Search for places and addresses across the Kingdom." | **confirmed** |
| Distance matrix | Page "Distance Matrix": "Calculate travel times and distances across the road network." Endpoint path and method: **not stated** on the pages read. | **confirmed** that it is offered; wire format not stated |
| National Address short-code lookup | Page "Shortcode Lookup": "Direct resolution of Saudi National Address shortcodes to coordinates." Path and method: not stated. | **confirmed** that it is offered. This settles the §12.2 question only at product level: the public list includes it, so the contract question is whether it is in our B2B package. |
| Pricing, quota, rate limits | "Pricing, quota, rate limits: Not stated." | **not stated** |
| B2B contact path | Keys are a Publishable and a Secret key; "Contact our team to get credentials for your development environment"; contact `hello@hudhud.sa`; keys managed through the Hudhud Console. | **confirmed** (contact route); signer and terms not stated |
| Traffic-aware departure times | Not stated on pages read. | not stated |

Sources: https://docs.hudhud.sa/index.md, https://docs.hudhud.sa/quickstart.md, https://docs.hudhud.sa/quickstart (search result pages). Date 2026-10-31.

## 9. Saudi National Address (SPL) API availability and short-code format

Claim in document (§2.2, §6.2, §12.2): SPL National Address API adapter if Hudhud does not include short-code lookup; short code format assumed.

| Field | Value |
|---|---|
| Public documentation | National Address APIs portal exists at https://api.address.gov.sa/ with a "Get Started" entry. Endpoint page "National Address By Short Address" exists. Format per search excerpt: "four English alphabet letters and four numeric digits", example `RAAA2919`. Starter package per search excerpt: 5 calls per minute, 100 calls per week for any API. Sign-up terms and pricing: not stated. The endpoint page itself returned 404 on fetch. |
| URL | https://api.address.gov.sa/ and https://api.address.gov.sa/addressdataapi-NationalAddressByShortAddress |
| Date | 2026-10-31 |
| Verdict | **confirmed** that the API is offered (portal). Short-code format: **confirmed from search excerpt only**; primary page not reachable. Access terms, pricing: **not stated**. |

## 10. VROOM container image and matrix input format

Claim in document (§6.4 and §2.1): VROOM with a custom matrix `matrices.car.durations` and `distances`; `start`, `end`, `location_index`; rung 1 uses the matrix. Image name not named in the document.

| Field | Value |
|---|---|
| Public documentation (container) | Image `ghcr.io/vroom-project/vroom-docker:v1.15.0` (example tag, release-numbered). Build arguments `VROOM_RELEASE` and `VROOM_EXPRESS_RELEASE`. Default OSRM router port 5000. vroom-express default port 3000 per the page. |
| Public documentation (input) | Top-level keys `jobs`, `shipments`, `vehicles`, `matrices`, `matrix`. `matrices` is keyed by vehicle profile; each profile holds `durations`, `distances` or `costs` as two-dimensional arrays of unsigned integers. Vehicles use `start_index` and `end_index` when custom matrices are given, instead of `start` and `end`; `start`, `end` and `location` become optional when matrices exist for every profile. `distances` requires `durations`. |
| URLs | https://github.com/VROOM-Project/vroom-docker ; https://github.com/VROOM-Project/vroom/blob/master/docs/API.md |
| Date | 2026-10-31 |
| Verdict | **confirmed** for the `matrices.<profile>.durations` and `distances` shape. **Partly contradicted** in the detail: the document's rung 1 wording ("`start` = the driver's last ping") needs `start_index` referencing a matrix row when a custom matrix is given. Quote: "`start`, `end`, `location`: these become optional if custom matrices exist for every required profile... the `*_index` keys are then used during optimization." Image name: not stated in the document; public image above. |

## 11. OSRM Saudi extract availability

Claim in document (§2.1): "OSRM self-hosted container on a Saudi OpenStreetMap extract" (fallback, from wave 2).

| Field | Value |
|---|---|
| Public documentation | Geofabrik's Asia index lists a "GCC States" region (`asia/gcc-states-latest.osm.pbf`, 244 MB, "contains all OSM data up to 2026-10-30T21:24:51Z"); "No sub regions are defined for this region." No Saudi Arabia-only extract is listed. The page does not say whether the GCC extract covers Saudi Arabia in full; the `.poly` file defines its extent but the text was not read. |
| URLs | https://download.geofabrik.de/asia.html ; https://download.geofabrik.de/asia/gcc-states.html |
| Date | 2026-10-31 |
| Verdict | **not stated** for a Saudi-only extract. The closest public file is the GCC States extract; its Saudi coverage must be checked against `gcc-states.poly` before the document's wording is relied on. OSRM's own documentation was not read. |

## 12. MapLibre and Protomaps licensing for self-hosted tiles

Claim in document (`docs/architecture/web.md` lines 243 to 246 and 411; not marked to confirm in integrations.md): MapLibre GL JS behind a provider interface; `ProtomapsMapProvider` as the fallback, an OpenStreetMap-derived PMTiles basemap of Saudi Arabia hosted in our own object storage.

| Field | Value |
|---|---|
| MapLibre | `maplibre-gl-js` LICENSE: "Copyright (c) 2023, MapLibre contributors"; BSD-3-Clause-style. Use and redistribution permitted with notices kept, no endorsement by contributor names, no warranty. |
| Protomaps tile data | "distributed as an Open Database License Produced Work (OpenStreetMap attribution required)." Web maps and apps using the produced work must visibly attribute © OpenStreetMap. |
| Protomaps code and style | Code BSD-3; map design CC0 (search excerpt, primary README not read in full). Site footer: "An open source mapping system released under the BSD and ODbL licenses." |
| Forks and naming | A modified fork or a tiles API based on the basemap must not use the Protomaps name (search excerpt; primary LICENSE not read). |
| PMTiles format | No restriction stated on the format page; the "public domain" wording is from a search excerpt only. |
| Self-hosting | Docs advise copying the tileset to your own storage rather than hotlinking; the paid-sponsorship requirement applies to Protomaps' hosted API, per search excerpt. |
| URLs | https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt ; https://docs.protomaps.com/basemaps/downloads |
| Date | 2026-10-31 |
| Verdict | **confirmed** with conditions: MapLibre is permissive; Protomaps tiles need OSM attribution (ODbL) on the map, and a renamed fork if we ship a modified or hosted variant. Saudi boundary rendering (web.md open question 3) is not a licence matter and is **not stated** by any page read. |

## 13. Pages not reachable on 2026-10-31

- https://docs.salla.dev/doc-6741 (404): Salla signature section, read via the `.md` URL instead.
- https://docs.zid.sa/project-613905/create-a-webhook and https://docs.zid.sa/project-613905/authorization (404): read via the non-project URLs.
- https://docs.zid.sa/doc-604940: no webhook section.
- https://api.address.gov.sa/addressdataapi-NationalAddressByShortAddress: fetch 404, search excerpt used.
- https://docs.hudhud.sa/api-reference/... pages linked from the index: not fetched individually; the index was read.
- https://developers.facebook.com/docs/whatsapp/... reference pages (see the WhatsApp file, section 10).

## 14. Items not checked in this pass

Hudhud traffic-aware departure times (§6.3) were read only as "not stated". OSRM's own docs, the Expo receipt error set beyond `DeviceNotRegistered`, and any Zid store-level webhook limits were not checked.
