# Hudhud geocoding, National Address short codes and fallbacks (2026-11)

- **Date of research:** 2026-11-02. Every fact below was read on 2026-11-02 unless marked otherwise.
- **Question (order INT-2, "Geocoder and short codes"):** what public sources say about Hudhud geocoding and short-code lookup, the Saudi National Address short code and its official API, an open-data fallback for a district fixture stub, and how Google Geocoding compares for Saudi coverage.
- **Extends, does not repeat:** `docs/research/provider-facts-2026-10.md` §8 (Hudhud endpoint list, key model, B2B contact path, pricing "not stated") and §9 (SPL portal, short-code format, endpoint 404). This note adds the full request and response contracts, the error codes, the reverse endpoints and the terms gaps.
- **Labels:** [S] = a source read says it (source and read date given). [I] = my inference from [S] facts. [unverified] = not confirmed by a source read. "Not found" = a search or fetch did not settle it.
- **Not legal advice.** Licence and data-protection readings are what the pages say, nothing more.

## Summary for the lead

- [S] Hudhud's geocoding contract has no confidence or match-quality field in any geocoding response. Forward search takes only `query` (no city, no locale). The port's `confidence 0..1` and the 0.6 threshold in integrations §6.2 have no Hudhud source behind them [I].
- [S] Hudhud exposes a short-code lookup (`POST /v1/geocoding/lookup_shortcode`) and a reverse-with-shortcode call (`POST /v1/geocoding/reverse_with_shortcode`). The lookup is the only Hudhud call that returns Arabic and English addresses (`address_ar`, `address_en`).
- [S] No public Hudhud page, Swagger file or consumer terms page states rate limits, quotas, prices, retry rules, or rules on caching or storing results. Q-28 stays open. The 30-day cache in integrations §2.2 has no Hudhud source [unverified].
- [S] Short code format, SPL official page (read 2026-11-02): "4 Letters (e.g. RAGI) assigned based on the postal codes and 4 Digits (Building Number)". This matches the `^[A-Z]{4}[0-9]{4}$` CHECK in data.md.
- [S] The SPL National Address API portal lists a Lookups API (regions, cities, districts) and an Address API that takes a short address as input. Registration is "free" per the SPL page. Quotas, fields and terms were not readable (endpoint pages 404 or are empty). The portal is the official route if Hudhud's package excludes short codes.
- [S] Google's archived Service Specific Terms (version of 2024-05-22, read 2026-11-02) allow caching of Geocoding latitude and longitude for up to 30 consecutive days, and forbid using Google geocoding results "in conjunction with a non-Google map" (§3.3). Relevant if ADR-0033's MapLibre map shows Google results.
- [S] Google's address-validation coverage page has no Saudi Arabia row and says "Data quality can vary by country" (read 2026-11-02). No source read gives Google's Saudi geocoding quality.
- [I] No open district dataset with licence and admin-level 9 coverage for Riyadh or Jeddah was confirmed. The OSM Saudi admin import covers regions and governorates only. The fixture needs a new source or a hand-made list.
- Doc gap [S, repo read]: integrations §2.2 says the geocode cache is a "kernel cache table (document 5 names it)". `docs/architecture/data.md` names no geocode cache table; the only cache table named there is `del_distance_matrix_cache`.

---

## 1. Hudhud geocoding API

### 1.1 Endpoints

| Port method | Endpoint (all `POST https://b.hudhud.sa/v1/...`) | Request body | Source and read date |
|---|---|---|---|
| `geocode(text, city?, locale)` | `/geocoding/search` | `{ "query": string }`, required. "The address or place name to search for". No city, locale, language, country or limit field in the spec. | [S] https://docs.hudhud.sa/api-reference/geocoding/geocode-search.md, read 2026-11-02 |
| `lookupShortCode(code)` | `/geocoding/lookup_shortcode` | `{ "shortcode": string }`, required. "4 letters followed by 4 digits, e.g. ABCD1234". Example `REMA7572`. No stated case rule. | [S] https://docs.hudhud.sa/api-reference/geocoding/shortcode-lookup.md, read 2026-11-02 |
| `reverse(point)` | `/geocoding/reverse` | `{ "lat": number, "lon": number }`, both required. `lat` -90..90, `lon` -180..180. No language or radius field. | [S] https://docs.hudhud.sa/api-reference/geocoding/reverse-geocode.md, read 2026-11-02 |
| (not in the port) | `/geocoding/reverse_with_shortcode` | `{ "lat", "lon" }`, both required. | [S] https://docs.hudhud.sa/api-reference/geocoding/reverse-geocode-with-short-code.md, read 2026-11-02 |

Also listed in the index but outside INT-2: `/routing/matrix` (INT-5), `/routing/directions`, `/routing/optimization` (marked Alpha), `/places/*`, `/maps/styles/{map_id}` (Publishable key, query parameter). Index: https://docs.hudhud.sa/llms.txt, read 2026-11-02. Swagger: https://docs.hudhud.sa/swagger.json, read 2026-11-02.

### 1.2 Authentication

- [S] Backend geocoding and routing use the Secret key as a Bearer token in the `Authorization` header: `Authorization: Bearer <secret_key>`. "This key should never be exposed in client-side code (browsers or mobile apps)." Source: https://docs.hudhud.sa/guides/authentication.md, read 2026-11-02.
- [S] Map styles use the Publishable key (`pk_...`) as a query parameter. Source: same page and swagger `/maps/styles/{map_id}`.
- [S] Keys come from `hello@hudhud.sa` ("Contact our team to get credentials for your development environment"). Source: https://docs.hudhud.sa/index.md and https://docs.hudhud.sa/quickstart.md, read 2026-11-02.
- [S] Swagger `securitySchemes.BearerAuth`: apiKey in `Authorization`, described as "JWT Bearer token for authentication". Source: swagger.json, read 2026-11-02.
- [unverified] A WebSearch excerpt said the authentication guide's example URL uses a `pk_` key as `api_key` under a "Secret Keys" heading, which may be a doc error. Not confirmed on the page itself.
- [I] The adapter sends the Secret key from the config module only (AGENTS hard rule on secrets). The Secret key must never reach the driver or web apps; the geocoder runs server-side only.

### 1.3 Response shapes

All Hudhud geocoding responses use the envelope `{ "ok": boolean, "data": object, "error": string | null }`. `error` is present only when `ok` is false. Source: https://docs.hudhud.sa/guides/response-format.md and the endpoint pages, read 2026-11-02.

**Forward search (`/geocoding/search`), `data.results[]`:**

| Field | Type (swagger) | Note |
|---|---|---|
| `name` | string | short place name |
| `display_name` | string | "Full, comma-separated address" (closest to a formatted address) |
| `lat`, `lon` | number | WGS84 |
| `place_id` | integer | |
| `category`, `type`, `address_type` | string | e.g. `leisure`, `zoo`, `tourism` in the examples |
| `bounding_box` | object `min_lat, max_lat, min_lon, max_lon` | the description still mentions a `user_location` that the spec does not define |

Not in the search response: point confidence, score, match quality, district, city, country, Arabic text.

**Shortcode lookup, `data`:** `shortcode` (string), `address_en` (string), `address_ar` (string), `location` (object `lat`, `lon`, both required doubles). The page gives no district, city, region or postcode fields; those appear only inside the address strings. Example: `address_en` "Al Olaya, Riyadh 12211, Saudi Arabia". Source: shortcode-lookup.md, read 2026-11-02.

**Reverse (`/geocoding/reverse`), `data`:** `address` object with `city`, `country`, `country_code`, `municipality`, `neighbourhood`, `postcode`, `province`, `road`, `suburb` (all strings); `display_name`, `name`, `category`, `type`, `addresstype`, `importance`, `place_id`, `place_rank`, `boundingbox` (array of strings, `[min_lat, max_lat, min_lon, max_lon]`), `building` (GeoJSON, only on a building), `lat` and `lon` **as strings**. Source: reverse-geocode.md, read 2026-11-02.

**Reverse with short code, `data`:** same as reverse, plus `shortcode` (4 letters and 4 digits, empty string when the location has none). Example `RRHC2680`. Source: reverse-geocode-with-short-code.md, read 2026-11-02.

Type notes [S]: `lat`/`lon` are numbers in search and strings in both reverse calls; `place_id` is an integer everywhere. The adapter needs one parser per endpoint.

### 1.4 Errors

| Endpoint | Documented codes | Source |
|---|---|---|
| `/geocoding/search` | 400 "Invalid or missing query", 401 "Missing or invalid API key", 500 | geocode-search.md, read 2026-11-02 |
| `/geocoding/lookup_shortcode` | 400 "Invalid shortcode format", 401, 404 "Shortcode not found", 500 | shortcode-lookup.md, read 2026-11-02 |
| `/geocoding/reverse`, `/reverse_with_shortcode` | 400 "lat must be -90..90, lon must be -180..180", 401, 500 | reverse-geocode.md and reverse-geocode-with-short-code.md, read 2026-11-02 |
| Generic guide | 200, 400, 401, 403 "key lacks permission for the service", 404, 500. No 429. | response-format.md, read 2026-11-02 |

- [S] No 429 and no retry guidance anywhere in the docs read.
- [I] `not_found` for forward search is most likely an empty `results` array. No source states this. [unverified]
- [I] The shortcode 404 maps to `not_found` in the port; a 403 needs its own alert (wrong key scope).

### 1.5 Rate limits, quotas, pricing, terms

- [S] "Pricing, quota, rate limits: Not stated." Source: https://docs.hudhud.sa/index.md (per the earlier provider-facts §8 read, re-checked here by the index and quickstart pages, read 2026-11-02).
- [S] No rate-limit, quota or pricing extension in swagger.json (read 2026-11-02).
- [S] Hudhud searched for pricing on 2026-11-02 (WebSearch): no per-request price or plan tier published. Pricing "will likely need to be requested through the same contact address" (search-summary inference).
- [S] `https://hudhud.sa/en/terms` (read 2026-11-02) is the Terms of Use for the Hudhud consumer app, effective 31 July 2025. It has no API, caching, storage or attribution terms. It says "We may integrate or discontinue third-party data providers at our discretion" and that map materials may not be reproduced "outside the App without written permission". It does not govern a B2B API key.
- [S] `https://hudhud.sa/ar/terms` and `/ar/privacy` are linked from the homepage; the homepage fetch did not return their text (read 2026-11-02).
- [I] The consumer terms do not answer whether geocoded results may be stored or cached under the B2B key.

### 1.6 Caching and storage of results; storing coordinates with orders

- [S] No caching, storage, retention or attribution statement on any Hudhud geocoding page, the swagger file, the response-format guide or the consumer terms (all read 2026-11-02).
- [I] The 30-day cache in integrations §2.2 is a design choice with no Hudhud source. It matches Google's archived 30-day rule (section 4) but is not derived from it.
- [I] Whether coordinates and addresses may be stored with orders is unanswered by Hudhud. The adapter's data minimisation (integrations §6.1: address text and city only, no account ids or names) is an internal design, not a Hudhud term.
- [unverified] Saudi PDPL duties for location and phone data are not researched (also flagged in `docs/research/eas-and-store-accounts-2026-11.md` §10). Needs counsel.

### 1.7 Arabic and English

- [S] Input: no language parameter on search, reverse or lookup. Whether Arabic query text works is not stated [unverified].
- [S] Output: only `/geocoding/lookup_shortcode` returns Arabic (`address_ar`) and English (`address_en`). Search and reverse examples are English; language is not stated for their `display_name` or `address` fields [unverified].
- [S] Introduction page: "native RTL (Right-to-Left) support for all map labels". This is about map display, not API output (docs.hudhud.sa/index.md, read 2026-11-02).
- [I] For `city` and `district` in Arabic, the shortcode lookup is the only documented bilingual source. The port's `district` would come from reverse `neighbourhood` or `suburb`; neither is documented as a district in the Saudi sense [I].

### 1.8 Mapping to the port (facts only)

- `geocode(text, city?, locale)`: `city` has no field; it can only be concatenated into `query` [I]. `locale` has no field. `confidence` has no source; any 0..1 value is the adapter's own derivation [I]. The 0.6 threshold (integrations §6.2) has no source.
- `lookupShortCode(code)`: the only port method with a documented bilingual response. Confidence in the lookup is not stated; integrations §6.2 sets it to 1.0 by design [I].
- `reverse(point)`: returns `{text, district, city}` in the port. Hudhud gives `display_name`, `address.neighbourhood`/`suburb` and `address.city` [S]. The port's `district` mapping is open [I].
- A shortcode can also be read back from coordinates with `reverse_with_shortcode` [S]. Useful for site provisioning (`core_sites.national_address_short_code`) if the owner wants a code from a pin.

## 2. National Address short code

### 2.1 Format and meaning

- [S] SPL official page, https://splonline.com.sa/en/door-step/, read 2026-11-02: short address "consists of 4 Letters (e.g. RAGI) assigned based on the postal codes and 4 Digits (Building Number ie.2929)". The page does not explain each letter's position.
- [S] Hudhud shortcode docs (read 2026-11-02): "4 letters followed by 4 digits", examples `REMA7572`, `ABCD1234`, `RRHC2680`.
- [S] WebSearch excerpts (read 2026-11-02) disagree on what each letter encodes (region, branch, division, unique). Third-party sources; not used as fact.
- [S] data.md CHECK `^[A-Z]{4}[0-9]{4}$` on `core_sites.national_address_short_code` matches the format. The `del_orders` row names the column without a CHECK in the row read [unverified].
- [I] Input from users or merchants may arrive in lower case or with a space. The adapter should normalise to upper case and strip spaces before the CHECK and before lookup; no source states a case rule.
- [S] SPL: a short address is used with a postal code and city (WebSearch excerpts on the SPL usage guidance, read 2026-11-02; third-party sources, not the SPL page itself).

### 2.2 Official SPL National Address API

- [S] Portal https://api.address.gov.sa/ (read 2026-11-02): "Address Search. Address Validation. Look Ups And More." Links to documentation, APIs, products, sign in and sign up. Footer "© 2026".
- [S] SPL API page https://splonline.com.sa/en/national-address-api (read 2026-11-02 via redirect to http://splonline.com.sa/en/national-address-api/): "Address API" takes inputs "phone number, geocode, free text, and short address"; "Maps API" for map engine; "Lookups API" for "updated list of KSA regions, cities and districts", and villages and deserts in a benefits list. "Developers can register online for free." No fees, quotas, rate limits, response fields, or Arabic and English field names on that page.
- [S] Azure-hosted developer portal https://nationaladdressapis.developer.azure-api.net/apis (read 2026-11-02) lists the Address API (Free Text Search, Fixed Search, Bulk Search, Verify an Address, Address Geocode, POI search, Nearest POI, Address By Phone) and the Lookups API (Regions, Cities, Districts, POI categories). No operation named "short address lookup" appears in the list. The product, subscription, and terms pages returned no content on read.
- [S] Endpoint page https://api.address.gov.sa/addressdataapi-NationalAddressByShortAddress returned 404 (read 2026-11-02). Documentation pages https://api.address.gov.sa/apidocumentation and `/apidocumentation/freetextsearch` did not show endpoint details or terms.
- [S] Rate limits: a WebSearch excerpt from an earlier pass said "5 calls per minute, 100 calls per week" for a starter package (provider-facts §9). Not re-confirmed on 2026-11-02. [unverified]. A third-party PHP package states "1000 requests per month" for a development subscription. Secondhand, not used as fact.
- [S] SPL's own page says the company will "make available national address databases and share this information for commercial and governmental uses". No API licence or data-use terms are shown on the page read.
- [S] SPL's business-address subscription (a different product) lists SR 1,000 a year for main registry companies and SR 300 a year for subsidiaries, non-refundable on cancellation (splonline.com.sa/en/official-business-address via WebSearch excerpt, read 2026-11-02). Not the API price; cited to show SPL has paid products.
- [S] Hudhud's shortcode endpoints are a separate contract with Hudhud. Whether Hudhud's data is derived from SPL's database is not stated in any source read.

### 2.3 Does Hudhud expose it

- [S] Yes, at product level: `lookup_shortcode` and `reverse_with_shortcode` exist in the Hudhud API (section 1.1). Whether the B2B package includes them, and their price, is not stated (the Q-28 question).

## 3. Open-data fallback for the district stub (Riyadh, Jeddah)

- [S] Saudi Open Data portal (SDAIA), via WebSearch excerpt, read 2026-11-02: CSV, GeoJSON, Shapefile and API formats; licence shown as "Open (varies)"; per-dataset terms to check. No Riyadh or Jeddah district dataset identified.
- [S] OSM wiki, Saudi Arabia Admin Boundaries of Regions and Governorates Import (read 2026-11-02): source is the Ministry of Health COVID-19 ArcGIS hub; licence "Open Data License" (data.gov.sa); regions at `admin_level=4`, governorates at `admin_level=5/6`. Districts and neighbourhoods not covered.
- [S] WebSearch excerpt (read 2026-11-02): an MOMRAH-derived bilingual dataset of 13 regions, 15,513 cities and 21,235 districts, with JSON, CSV and MySQL outputs. Code MIT; the data licence is not stated in the excerpt [unverified].
- [S] WebSearch excerpt (read 2026-11-02): Riyadh Municipality boundaries as a 2023 shapefile, cited in an academic table. Licence not seen.
- [S] WebSearch excerpt (read 2026-11-02): a third-party site offers Saudi OSM shapefiles under ODbL 1.0 (attribution and share-alike for derived databases). Admin level 9 coverage not confirmed.
- [unverified] Overpass API queries for `admin_level=9` and `place=suburb|neighbourhood` in Riyadh were attempted twice on 2026-11-02 and returned HTTP 502 (two mirrors) and a timeout. The count is not known.
- [S] SPL Lookups API lists Districts (section 2.2). Its licence and terms are not shown; using it for a fixture would need the portal's terms first.
- [I] Cheapest route for a fixture with a clear licence: an ODbL extract of OSM place nodes and admin_level=9 relations for the two cities, with attribution, once the Overpass count is confirmed. Centroids would be computed from the polygons. This is an inference; no source read gives the district list.

## 4. Google Geocoding, for comparison (only what public sources state)

- [S] Service Specific Terms, archival version "Last modified: May 22, 2024" (https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240522, read 2026-11-02), section 3.4: "Customer can temporarily cache latitude (lat) and longitude (lng) values from the Geocoding API for up to 30 consecutive calendar days, after which Customer must delete the cached latitude and longitude values." Place IDs may be cached under the Geocoding API Policies. The current version was not readable in full; the same 30-day rule appears in the 2020, 2022 and 2024 snapshots per a WebSearch summary (read 2026-11-02).
- [S] Section 3.3 (same version): "Customer must not use Google Maps Content from the Geocoding API in conjunction with a non-Google map."
- [S] Section 3.1 allows use "without a Google Map". Attribution under 3.2.
- [S] Google geocoding policy page https://developers.google.com/maps/documentation/geocoding/policies (read 2026-11-02): caching exception for place IDs: "You can therefore store place ID values indefinitely." Says nothing about Saudi Arabia and carries no "last updated" date.
- [S] Address Validation coverage page https://developers.google.com/maps/documentation/address-validation/coverage (read 2026-11-02): no row for Saudi Arabia (SA) in the table; "Data quality can vary by country"; no last-updated date.
- [S] Geocoding usage and billing page (read 2026-11-02): price per 1,000 requests not stated on the page (links to SKU pricing); "Daily quotas are refreshed daily at midnight Pacific time"; QPS limit not stated.
- [unverified] Google's price and QPS for Geocoding (the current SKU table) were not read. Do not use any figure without a fresh read.
- [I] Google's ToS on non-Google maps (section 3.3) matters only if the web or driver map uses MapLibre (ADR-0033) with Google geocode results. It does not restrict Hudhud.
- [unverified] Saudi quality of Google geocoding is not settled by any source read.

## 5. Facts about the repo (read 2026-11-02)

- `docs/architecture/integrations.md` §2.2 (Geocoder), §6.1, §6.2: methods as the lead wrote them; cache 30 days "in a kernel cache table (document 5 names it)". `docs/architecture/data.md` has no geocode cache table. The only cache table named is `del_distance_matrix_cache` (row at data.md line 116). Owner or lead to decide where the geocode cache lives. [S]
- `docs/architecture/data.md` `core_sites.national_address_short_code` CHECK `^[A-Z]{4}[0-9]{4}$` (line 66). The `del_orders` row (line 86) names the same column; the CHECK is not shown there [S, read 2026-11-02].
- `docs/architecture/integrations.md` §6.2 step 1: a short-code hit sets confidence 1.0 "by design". No source for the 0.6 threshold or the 1.0 value, both are product defaults. [S for the text; I for the source gap]
- `docs/roadmap.md` row INT-2 and Q-28 (line 339): Hudhud agreement, signer, quota, price, short-code lookup; default "(provisional)".
- ADR-0010 (`adr/0010-route-optimisation-vroom-over-hudhud.md`, status accepted, read 2026-11-02): "A Hudhud B2B key is a prerequisite for rung 1. Matrix results are cached per day and per site." The ADR does not state a geocode cache.

## Unanswered

1. Hudhud rate limits, quotas, pricing and retry behaviour: not published on any page read. Q-28 (commercial).
2. Whether Hudhud's B2B terms allow caching geocode results, for how long, and whether coordinates and addresses may be stored with orders. No source read.
3. Whether the Hudhud package includes `lookup_shortcode` and `reverse_with_shortcode`, and at what price. Product level only.
4. Whether Hudhud geocoding returns any confidence or match-quality value. None in any documented schema; the 0.6 threshold has no source.
5. Arabic query input to `/geocoding/search` and `/geocoding/reverse`, and the language of their `display_name` and `address` fields. Not stated.
6. Whether a forward search with no match returns an empty `results` array or an error. Not stated.
7. Whether Hudhud's short-code data comes from SPL's database, and whether SPL's API terms allow a third party to store results.
8. SPL National Address API: endpoint definitions for short-code lookup, response fields (Arabic and English), key process, quotas, pricing and terms. The product, subscription and endpoint pages returned no content or 404.
9. Short-code letter meanings: SPL says the letters are "assigned based on the postal codes"; no source read says how.
10. Case and whitespace rules for the shortcode input (docs say "4 letters followed by 4 digits" only).
11. An open, licensed district list (name and centroid) for Riyadh and Jeddah. Not found. The OSM Saudi admin import has no districts. Overpass returned 502 twice, so the OSM count is not known.
12. Licence of the MOMRAH-derived district dataset (data licence not stated in the excerpt) and of the Riyadh Municipality boundary shapefile.
13. Whether Google Geocoding gives usable Saudi district-level results. No source read gives it. Google's current price and QPS: not read.
14. Saudi PDPL duties for storing coordinates and addresses with orders (counsel; not researched).
15. Where the geocode cache table lives: integrations §2.2 says "document 5 names it", and data.md does not.

## Sources (all read 2026-11-02 unless marked)

- Hudhud docs index: https://docs.hudhud.sa/index.md ; https://docs.hudhud.sa/llms.txt ; https://docs.hudhud.sa/quickstart.md
- Hudhud authentication: https://docs.hudhud.sa/guides/authentication.md ; response format: https://docs.hudhud.sa/guides/response-format.md
- Hudhud endpoints: https://docs.hudhud.sa/api-reference/geocoding/geocode-search.md ; https://docs.hudhud.sa/api-reference/geocoding/shortcode-lookup.md ; https://docs.hudhud.sa/api-reference/geocoding/reverse-geocode.md ; https://docs.hudhud.sa/api-reference/geocoding/reverse-geocode-with-short-code.md
- Hudhud OpenAPI: https://docs.hudhud.sa/swagger.json
- Hudhud consumer terms (app): https://hudhud.sa/en/terms ; homepage https://hudhud.sa/
- SPL short address page: https://splonline.com.sa/en/door-step/
- SPL National Address API page: https://splonline.com.sa/en/national-address-api (redirect to http://splonline.com.sa/en/national-address-api/)
- SPL business address subscription (WebSearch excerpt): https://splonline.com.sa/en/official-business-address
- National Address API portal: https://api.address.gov.sa/ ; https://api.address.gov.sa/products (no content) ; https://api.address.gov.sa/apidocumentation (navigation only) ; https://api.address.gov.sa/addressdataapi-NationalAddressByShortAddress (404)
- National Address API Azure portal: https://nationaladdressapis.developer.azure-api.net/apis ; https://nationaladdressapis.developer.azure-api.net/products (no content)
- Google Maps Service Specific Terms, archival 2024-05-22: https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240522
- Google geocoding policies: https://developers.google.com/maps/documentation/geocoding/policies
- Google geocoding usage and billing: https://developers.google.com/maps/documentation/geocoding/usage-and-billing
- Google address-validation coverage: https://developers.google.com/maps/documentation/address-validation/coverage
- OSM wiki, Saudi regions and governorates import: https://wiki.openstreetmap.org/wiki/Saudi_Arabia/Admin_Boundaries_of_Regions_and_Governorates_Import
- Overpass API: attempted twice on 2026-11-02, HTTP 502 and a timeout; no result.
- Earlier notes: `docs/research/provider-facts-2026-10.md` §§8, 9; `docs/research/geo-logistics-oss-census-2026-11.md` §3 (Nominatim, Photon, Pelias; Arabic not verified for any).
- Repo: `docs/architecture/integrations.md` §§2.2, 6.1, 6.2; `docs/architecture/data.md` lines 66, 86, 116; `docs/roadmap.md` lines 80, 339; `adr/0010-route-optimisation-vroom-over-hudhud.md`.
