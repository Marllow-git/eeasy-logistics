# Open-source census: geo, routing, tiles, WMS and labels (2026-11)

- **Date of research:** 2026-11-01 (every GitHub field and web page below was read that day unless marked otherwise).
- **Question (from the lead):** which open-source projects on GitHub best fit the geo and logistics needs of eeasy-logistics, and how do they compare with our choices.
- **Scope:** seven categories, 2 to 5 candidates each, our current choice included. Hudhud, National Address, VROOM image and input format, OSRM Saudi extract and map licences are already in `docs/research/provider-facts-2026-10.md` and are not repeated.
- **Method:** GitHub API (`repos/<owner>/<repo>`, `releases/latest`, `tags`, `license`), repo file reads through the API, and WebFetch or WebSearch on official docs. Context7 was used once, for OR-Tools routing docs.
- **Labels:** [stated] = a source we read says it. [inferred] = my reasoning from a stated fact. "Not found" = a search or fetch did not settle it.
- **Dates:** "pushed" means the GitHub `pushed_at` field. Stars are as read on 2026-11-01.
- **Licence note:** I report what licences say and what the ADRs require. This is not legal advice.

## Summary for the lead

- VROOM (our choice, BSD-2-Clause) documents multi-dimensional capacity, time windows, shipments with pickup-then-delivery precedence, per-vehicle start and end, skills, breaks, and custom matrices per profile. It does not state a maximum job count or any runtime figure.
- OR-Tools (Apache-2.0, dropped by ADR-0010) documents per-vehicle start and end nodes. PyVRP (MIT) and jsprit (Apache-2.0) document multi-depot. The Timefold quickstart documents capacity and latest-finish time only, not pickup-delivery or multi-depot.
- No source read gives solver speed at 50 to 300 stops. Speed is unsettled for every solver.
- Routing: Valhalla (MIT) documents time-dependent matrices and partial-result matrices. OSRM (BSD-2) documents static weights in the docs read. GraphHopper (Apache-2.0) says hybrid mode "integrat[es] traffic data" (README).
- Geocoding: Nominatim's public policy caps heavy use at 1 request per second and says self-host for larger needs. Photon (Apache-2.0) needs Java 21+ and about 95 GB disk for a planet database. Arabic result quality is not verified for any of the three.
- Tiles: the Protomaps basemap style lists `ar` as a label language. MapLibre React Native (MIT, v11.5.1) cannot run in Expo Go and needs a config plugin plus a native rebuild.
- Spatial: pgRouting's VRP functions are marked experimental, and its one-depot function has "No documentation available" in the page we read. The only H3 Postgres binding found (h3-pg) is archived.
- WMS references: none of the three ledger designs we read (Odoo, ERPNext, OpenBoxes) is append-only as the code shows. Our ADR-0011 is stricter than all three. Fleetbase is AGPL-3.0.
- Labels and tax: bwip-js, JsBarcode, pdfmake and react-pdf are MIT. The ZATCA libraries we found are unofficial (SallaApp/ZATCA, PHP, MIT). ZATCA's FAQ settles the QR fields for simplified invoices only.

---

## 1. Route optimisation and VRP solvers

| Candidate | Repo | Stars | Latest release (tag, date) | Licence | Pushed | Stated coverage (source) | Fit / conflict |
|---|---|---|---|---|---|---|---|
| **VROOM (our choice)** | VROOM-Project/vroom | 1905 | v1.15.0, 2026-03-12 | BSD-2-Clause | 2026-10-08 | Multi-dimensional capacity; time windows on jobs, shipment steps, vehicles, breaks; shipments with pickup and delivery and precedence; skills; breaks; `max_tasks`, `max_travel_time`, `max_distance` per vehicle; custom matrices per profile [stated, API.md] | ADR-0010 chosen. Multi-depot is not described as such; per-vehicle `start`/`end` is the mechanism [inferred] |
| Google OR-Tools | google/or-tools | 14307 | v9.15, 2026-01-12 | Apache-2.0 (code); CC-BY 4.0 (docs) | 2026-10-30 | Per-vehicle start and end nodes [stated, routing_tasks]; pickup-delivery pairs with same-vehicle and precedence rules [stated, pickup_delivery, last updated 2024-08-28]; capacity and time windows named on the VRP page [stated, vrp page, last updated 2026-03-18] | ADR-0010: OR-Tools dropped by owner ruling 2026-09-20. Would be a solver service to host (ADR-0010 names this) |
| Timefold Solver | TimefoldAI/timefold-solver | 1845 | v2.7.1, 2026-10-06 | Apache-2.0 for Community Edition; Enterprise is non-OSS [stated, README] | 2026-10-30 | Quickstart constraints: capacity (hard), finish before max end time (hard), total travel time (soft). No pickup-delivery and no multi-depot in that page [stated, constraints page, v2.7.1] | Not in any ADR. Java/Kotlin, so a JVM sidecar [inferred from README]. Pick-up and delivery appears only as a hosted "Pick-up and Delivery Routing" product in the site nav, not as documented OSS constraints [stated, search excerpt] |
| jsprit | graphhopper/jsprit | 1838 | Newest tag v2.1.0-beta.2; `releases/latest` is v1.9.0-beta.1, 2020-04-21 | Apache-2.0 [stated, README] | 2026-09-14 | Capacity, multi-depot, time windows, pickups and deliveries, heterogeneous fleet, backhauls, dial-a-ride, time-dependent [stated, README] | Not in an ADR. Java. GraphHopper's hosted Route Optimization API is built on it [stated, GraphHopper README]. Release channel is beta and the latest GitHub release is from 2020 [stated] |
| PyVRP | PyVRP/PyVRP | 720 | v0.14.1, 2026-10-16 | MIT (GitHub API); licence not named on the docs page [stated, API vs docs] | 2026-10-29 | Capacity, pickups and deliveries, time windows and release times, multi-depot, heterogeneous fleet, multi-trip reloading, prize collecting [stated, pyvrp.org]. Break planning, compatibility constraints and fairness are marked Enterprise [stated] | Not in an ADR. Python, so a sidecar in a TS/Nest stack [inferred] |

Notes on this category:
- The solvers differ most on pickup-delivery and multi-depot. Only VROOM, OR-Tools and PyVRP (plus jsprit) state both in the sources read.
- VROOM's custom-matrix input needs `start_index`/`end_index` instead of `start`/`end` (already in provider-facts-2026-10 §10). Nothing in this pass changes that.

## 2. Routing engines and distance matrices

| Candidate | Repo | Stars | Latest release (tag, date) | Licence | Pushed | Stated matrix and traffic facts (source) | Fit / conflict |
|---|---|---|---|---|---|---|---|
| **OSRM (our fallback)** | Project-OSRM/osrm-backend | 8188 | v26.10.0, 2026-10-01 | BSD-2-Clause | 2026-11-01 | Table service returns durations and/or distances for sources x destinations, `annotations` default `duration` [stated, v5.24 API doc, see note]. No maximum matrix size stated for Table [stated]. Traffic: "supplied via `--segment-speed-file` to `osrm-contract` or `osrm-customize`", i.e. preprocessing time, not live or time-of-day weights [stated] | ADR-0010 fallback. The API page read is the 5.x doc (URL pinned to v5.24.0), while the release is 26.x. Version drift is unverified |
| Valhalla | valhalla/valhalla | 6392 | 3.9.1, 2026-10-06 | MIT (README: "use the MIT License"; GitHub API reports NOASSERTION, so the COPYING file governs) [stated] | 2026-11-01 | `sources_to_targets` matrix with time, distance, cost per pair [stated, matrix.md]. Time-dependent matrices via `date_time` on each location, with stated limits on which `date_time` combinations are allowed [stated]. `timedistancematrix` is "exact but slower"; `costmatrix` is faster via `prioritize_bidirectional` [stated]. `matrix_locations` allows partial results [stated]. Max-location limit: not stated in the matrix doc | Not in an ADR. Would be a fallback change to ADR-0010, which names only OSRM and nearest-neighbour. Adding it needs a new ADR [inferred from AGENTS rule 7]. Public demo server has fair-use limits [stated, README] |
| GraphHopper | graphhopper/graphhopper | 6750 | 11.1, 2026-09-29 | Apache-2.0 [stated, README] | 2026-10-30 | Routing, Matrix, Isochrone, Map Matching APIs open source; Route Optimization API is hosted and built on jsprit [stated, README]. Speed mode (CH, fast, fixed profiles), flexible mode, and hybrid mode; hybrid "allows you to... integrat[e] traffic data" [stated, README]. Address search is based on Photon [stated] | Not in an ADR. Speed-mode CH preparation is "time and resource consuming" [stated, README] |

Notes:
- Saudi OSM coverage: the only file read is the Geofabrik GCC States extract, whose Saudi-only coverage is not confirmed (provider-facts-2026-10 §11). No routing-engine source read says anything about Saudi road-data quality.
- Matrix throughput: no source read gives requests per second or time per matrix at 50 to 300 stops. Unsettled.

## 3. Geocoding and address search (self-hosted)

| Candidate | Repo | Stars | Latest release (tag, date) | Licence | Pushed | Stated facts (source) | Fit / conflict |
|---|---|---|---|---|---|---|---|
| Nominatim | osm-search/Nominatim | 4545 | v5.3.3, 2026-10-14 | GPL-3.0 (GitHub API). README: Python source "GPL license version 3 or later", some files Apache-2.0, "All other files are under a GPLv2 license" [stated, README] | 2026-10-28 | Usage policy: "No heavy uses (an absolute maximum of 1 request per second)"; results "must be cached on your side"; "periodic requests from apps are considered bulk geocoding" [stated, OSMF policy]. Self-hosting recommended for larger needs [stated]. Language: `accept-language` default; with no header, "show results in the local language" [stated, search API doc, 5.3.3] | Not in an ADR. Hudhud geocoding is confirmed in provider-facts §8. No ADR names a self-hosted geocoder; Nominatim would be one [inferred] |
| Photon | komoot/photon | 3159 | 1.3.0, 2026-08-07 | Apache-2.0 [stated, README] | 2026-10-28 | Requires Java 21+; OpenSearch 3.x for an external DB [stated]. "A planet-wide database requires about 95GB disk space"; "At least 64GB RAM are recommended" [stated, README]. Dumps carry "names in English, German, French and local language" [stated]. `lang` parameter returns one language, else the server default, else the local language [stated, api-v1.md] | Not in an ADR. Arabic is not named in the dump languages; "local language" is presumably Arabic for KSA [inferred] |
| Pelias | pelias/pelias | 3600 | Not found (no GitHub release or tag found) | MIT [stated, README] | 2026-07-24 | Built on Elasticsearch; "Currently versions 7 and 8 are supported" [stated]. Modular services: API, placeholder, interpolation, importers [stated]. "Support for searching and displaying results in many languages" [stated] | Not in an ADR. Most services to run; Arabic not verified |

## 4. Map tiles, vector tile servers and map client

| Candidate | Repo | Stars | Latest release (tag, date) | Licence | Pushed | Stated facts (source) | Fit / conflict |
|---|---|---|---|---|---|---|---|
| **MapLibre GL JS (our choice, web)** | maplibre/maplibre-gl-js | 11988 | v6.16.0, 2026-10-25 | BSD-3-style, "Copyright (c) 2023, MapLibre contributors" (LICENSE text read; GitHub reports NOASSERTION) | 2026-10-30 | Read in provider-facts §12 | ADR-0033 chosen behind `MapProvider` |
| **MapLibre React Native (`@maplibre/maplibre-react-native`)** | maplibre/maplibre-react-native | 673 | v11.5.1, 2026-10-29 | MIT | 2026-10-29 | Expo: "This package can't be used with 'Expo Go'" [stated, docs/content/setup/expo.md]. Needs an Expo config plugin added to `app.json` or `app.config`, then a native rebuild. On iOS the plugin adds `$MLRN.post_install(installer)` to the Podfile [stated]. Minimum Expo SDK: not stated on the pages read | No ADR governs a mobile map. ADR-0033 covers web only. A driver-app map decision is missing [inferred from ADR scope]. The driver app is Expo (ADR-0004, ADR-0021) |
| **Protomaps / PMTiles (our fallback)** | protomaps/PMTiles | 3099 | Not found (no GitHub release found) | Reference implementations BSD-3; the spec is "public domain, or CC0 where applicable" [stated, LICENSE text] | 2026-09-16 | Read in provider-facts §12 | ADR-0033 fallback |
| Protomaps basemaps | protomaps/basemaps | 768 | Not read | Code BSD-3-Clause [stated, LICENSE text] | 2026-09-11 | Style language list includes `{ lang: "ar" }` [stated, styles/src/language.ts]. Labels use `name:<lang>` with `name:en` fallback [stated, same file]. Arabic label rendering not checked on a map | Supports ADR-0033's Arabic labels for the fallback; needs a render check |
| OpenFreeMap | hyperknot/openfreemap | 6326 | Tag v0.3, date not read | MIT for the project (README) [stated]; tiles OSM-attributed [stated] | 2026-10-26 | Free public instance, "no API keys", "There are no limits on the number of map views or requests" [stated, openfreemap.org]. Self-hosting available [stated]. Attribution required [stated]. Arabic labels and tile refresh cadence: not stated | Not in an ADR. Hosted third-party tile origin: ADR-0033 flags a CSP change for any tile origin [inferred from ADR-0033 Consequences] |
| Martin | maplibre/martin | 4038 | v1.16.0, 2026-09-07 | Apache-2.0 [stated, LICENSE header] | 2026-11-01 | Serves "PostGIS tables and functions with automatic discovery", PMTiles, MBTiles, COG, GeoJSON, GeoParquet [stated, maplibre.org/martin] | Not in an ADR. A PostGIS tile server would serve zones and positions live; ADR-0033 has no such need stated [inferred] |
| pg_tileserv | CrunchyData/pg_tileserv | 1068 | v1.0.11, 2024-02-02 | Apache-2.0 [stated, GitHub API] | 2025-12-11 | "A very thin PostGIS-only tile server in Go" [stated, repo description]. Release is 20 months old at read date | Not in an ADR. Stale release |

## 5. Geofencing and spatial in Postgres

| Candidate | Repo | Stars | Latest release (tag, date) | Licence | Pushed | Stated facts (source) | Fit / conflict |
|---|---|---|---|---|---|---|---|
| **PostGIS (our choice)** | postgis/postgis (mirror) | 2258 | Not read | GPL-2.0 [stated, GitHub API] | 2026-10-30 | Read in ADR-0019 only | ADR-0019 chosen |
| pgRouting | pgRouting/pgrouting | 1446 | v4.0.2, 2026-09-05 | GPL-2.0 [stated] | 2026-10-28 | Vehicle routing category is "experimental" and includes `pgr_pickDeliver` (cost matrix), `pgr_pickDeliverEuclidean`, and `pgr_vrpOneDepot` (single depot) [stated, VRP-category.rst]. `pgr_vrpOneDepot` page: "No documentation available" and "Description... TBD" [stated, pgr_vrpOneDepot.rst]. "pgRouting does not try to implement all variants" [stated] | Not for VRP in production on current evidence. Not in an ADR. Routing features would sit beside PostGIS [inferred] |
| H3 core | uber/h3 | 6673 | v4.5.0, 2026-05-21 | Apache-2.0 [stated] | 2026-10-29 | Hierarchical hexagonal index [stated, repo description] | Not in an ADR |
| h3-pg (PostgreSQL bindings) | zachasme/h3-pg | 1 | Not read | Apache-2.0 [stated] | 2025-12-30. **Archived** [stated, GitHub API] | Only PostgreSQL H3 binding found by name. Search for other maintained bindings returned no useful result (not settled) | Not usable as a maintained dependency [inferred from archived flag] |

Notes:
- Zone coverage in ADR-0019 is planned with polygon containment on GiST indexes. H3 would be an index scheme on top, and no source read compares it for our zone sizes.

## 6. Reference open-source logistics and WMS products

| Candidate | Repo | Stars | Latest release (tag, date) | Licence | Pushed | Scope and stack facts (source) | Ledger design (code read) |
|---|---|---|---|---|---|---|---|
| Fleetbase | fleetbase/fleetbase | 4465 | v0.7.74, 2026-10-27 | AGPL-3.0 [stated, GitHub API] | 2026-11-01 | "Modular, open-source, operating system for logistics and supply chain operations... dispatch, fleet management, live tracking, commerce, warehousing, and finance" [stated, README]. Extensions: `fleetbase/ledger` (AGPL-3.0, "Accounting & Invoicing Extension", pushed 2026-10-14) [stated, GitHub API]. Ledger packages on Packagist and npm [stated, ledger README] | Ledger append-only behaviour: not stated in the README read; the packages/ledger tree is a submodule, so code not read [stated] |
| OpenBoxes | openboxes/openboxes | 920 | v0.9.9, 2026-10-23 | EPL-1.0 [stated, README] | 2026-11-01 | "warehouse management system designed to manage inventory and track stock movements for healthcare facilities" [stated, GitHub API description]. Grails/Groovy [inferred from `.groovy` domain files] | `Transaction` and `TransactionEntry` domain classes [stated, grails-app/domain]. `Transaction.beforeUpdate` only sets `updatedBy` [stated]. Not append-only in code read. Delete policy not checked |
| Odoo (stock) | odoo/odoo | 55455 | Not read | LGPL-3.0 [stated, LICENSE text] | 2026-11-01 | Stock module (`addons/stock`) | `stock.quant` is updated in place: `_update_available_quantity` calls `quant.write(vals)` [stated, stock_quant.py ~line 1130]. A quant is a mutable projection, not a ledger. Move-line model not read |
| ERPNext | frappe/erpnext | 40814 | v15.124.3, 2026-10-30 | GPL-3.0 [stated, GitHub API] | 2026-11-01 | Stock Ledger Entry (SLE). Individual SLE cancel is refused (`on_cancel` throws) [stated, stock_ledger_entry.py]. A bulk update sets `is_cancelled = 1` on existing SLE rows for the voucher, then reposts [stated, erpnext/stock/stock_ledger.py ~line 379] | Rows are flagged and reposted, not reversed by new rows. Not append-only as ADR-0011 defines it [inferred] |
| antonpiat/delivery-logistics | antonpiat/delivery-logistics | 11 | Not read | MIT [stated] | 2026-10-29 | "A modern backend for running last-mile delivery operations — from placing an order to live driver tracking and proof-of-delivery" [stated, repo description]. Stack not read | Not checked |
| OpenTMS-type projects | — | — | — | — | — | GitHub search: no repo found under the names OpenTMS/opentms or tms-project/tms (404) [stated] | Not settled |

Notes:
- AGPL: Fleetbase and its ledger are AGPL-3.0. The AGPL's network-use clause (section 13) is the point an operator would look at [inferred from general licence knowledge; the licence text was not fetched in this pass]. Reference reading only.
- EPL-1.0 (OpenBoxes) and LGPL-3.0 (Odoo) are weak copyleft; GPL-2.0 and GPL-3.0 (PostGIS, pgRouting, ERPNext, Nominatim) are copyleft on distribution [inferred, general licence knowledge; not fetched].
- No BSL or SSPL project appeared in this census.

## 7. Label and barcode printing, and Saudi e-invoice QR

| Candidate | Repo | Stars | Latest release (tag, date) | Licence | Pushed | Stated facts (source) | Fit |
|---|---|---|---|---|---|---|---|
| bwip-js | metafloor/bwip-js | 2428 | Not read | MIT (LICENSE text; GitHub reports NOASSERTION) | 2026-08-19 | "Barcode Writer in Pure JavaScript" [stated] | Candidate for barcodes in label PDFs (inferred) |
| JsBarcode | lindell/JsBarcode | 5896 | v3.12.3, 2026-01-07 | MIT [stated] | 2026-06-23 | Barcode generation in browser and Node [stated] | Candidate for barcodes (inferred) |
| pdfmake | bpampuch/pdfmake | 12359 | 0.3.13, 2026-10-25 | MIT (LICENSE text) | 2026-10-30 | Client and server PDF printing [stated] | Candidate for delivery notes |
| react-pdf | diegomura/react-pdf | 16849 | Latest tag read: `@react-pdf/ui@1.0.0`, 2026-08-27; core renderer tag not read | MIT [stated] | 2026-10-31 | "Create PDF files using React" [stated] | Candidate for delivery notes. Core release unverified |
| ZPL, JS (ZPLab) | u8array/ZPLab | 78 | — | MIT | 2026-10-31 | Visual ZPL label designer [stated] | Design tool, not a library |
| ZPL, JS (zpl-js) | tomoeste/zpl-js | 15 | — | MIT | 2026-10-26 | "ZPL II barcode label printing language in TypeScript and JavaScript" [stated] | Small. Stars and age make it low confidence |
| ZPL, JS (zplr) | le2ni/zplr | 15 | — | MIT | 2026-10-28 | "parsing and rendering ZPL code" [stated] | Small |
| ZPL renderer | Fabrizz/zpl-renderer-js | 62 | — | No licence in API | 2026-10-26 | Renders ZPL in browser or Node [stated] | No licence: not usable without asking the author [inferred] |
| ZATCA QR (unofficial) | SallaApp/ZATCA | 168 | v4.0.1, 2026-09-01 | MIT [stated] | 2026-10-12 | "An unofficial package maintained by Salla" [stated]. PHP [stated] | Not official. Stack is PHP |
| ZATCA XML (unofficial) | wes4m/zatca-xml-js | 91 | — | MIT [stated] | 2024-03-08 | "An implementation of Saudi Arabia ZATCA's E-Invoicing requirements... in TypeScript" [stated] | Stale (2024). TypeScript |

Saudi e-invoice facts:
- ZATCA FAQ (search excerpt only; PDF not fetched): simplified-invoice QR minimum fields are seller name, VAT registration number, timestamp, total with VAT, and VAT total [stated, zatca.gov.sa FAQ PDF, search excerpt 2026-11-01].
- Phase 2 additions for simplified invoices (UUID, previous-invoice hash, cryptographic stamp, fixed sequence): stated by third-party sources (Qoyod, ClearTax; search excerpts), not by ZATCA in pages read [stated by third parties].
- Whether a delivery note needs a QR or Phase 2 fields: not settled by any source read.
- Official ZATCA SDK: not found in this pass.

## Mapping to the ADRs

| ADR | Relevant candidate or fact | Fit |
|---|---|---|
| ADR-0010 | VROOM chosen; OSRM fallback; OR-Tools dropped | Valhalla and GraphHopper are not named. Adding either as a fallback is a change needing a new ADR (AGENTS rule 7) |
| ADR-0011 | Odoo quant write-in-place; ERPNext SLE flag update; OpenBoxes mutable Transaction | None of the three is append-only in the code read. ADR-0011 is stricter (inferred) |
| ADR-0019 | PostGIS, GPL-2.0 | Consistent. pgRouting VRP is experimental, so it cannot carry our routing |
| ADR-0033 | MapLibre GL JS web; Protomaps fallback; Arabic labels | Protomaps style supports `ar`. Driver-app mobile map (MapLibre RN, MIT) has no ADR |
| ADR-0004, ADR-0021 | Expo driver app | MapLibre RN needs a dev build, not Expo Go (stated) |
| ADR-0002, ADR-0005 | Own fleets, WMS plus delivery | Fleetbase covers both scopes but is AGPL and a broader platform |
| ADR-0009, ADR-0028 | Polling and SSE tracking | No OSS candidate in scope |

## Trade-offs the sources name

- VROOM custom matrices need `*_index` keys; `start`/`end` become optional when matrices exist [stated, API.md; provider-facts §10].
- OR-Tools: Apache-2.0 code, CC-BY 4.0 docs; per-vehicle start and end [stated].
- Timefold: Community Edition is Apache-2.0; Enterprise is non-OSS and needed for some features [stated]. Pick-up and delivery is a hosted product [stated, search excerpt].
- PyVRP: Enterprise features (break planning, compatibility, fairness, soft clustering) are separate [stated].
- OSRM: traffic via preprocessing speed files, not live [stated].
- Valhalla: time-dependent matrices are slower with `timedistancematrix`; `costmatrix` is faster, but time propagation has stated limits [stated].
- GraphHopper: speed mode is fast but fixed profiles; flexible and hybrid modes cost more memory and preparation [stated].
- Nominatim: public instance heavy-use cap 1 request per second; caching required; self-hosting recommended [stated].
- Photon: 95 GB disk and 64 GB RAM for planet; Java 21+; OpenSearch 3.x for external DB [stated].
- Pelias: Elasticsearch 7 or 8 are the supported versions [stated].
- MapLibre RN: not in Expo Go; native rebuild; config plugin [stated].
- OpenFreeMap: no request cap stated for public instance; attribution required; self-host option [stated].
- pgRouting: VRP experimental; one function undocumented [stated].
- ERPNext: flags and reposts, not reversing rows [stated in code].
- Fleetbase: AGPL-3.0 [stated].
- ZATCA: official source not found; unofficial libraries are PHP, TypeScript [stated].

## Unanswered

1. Solver speed at 50 to 300 stops (VROOM, OR-Tools, PyVRP, jsprit, Timefold): no source read gives a figure. Needs a benchmark on our own data.
2. Saudi road-data coverage in OSRM, Valhalla, GraphHopper: not settled. The GCC extract's Saudi coverage is also open (provider-facts §11).
3. Arabic result quality for Nominatim, Photon, Pelias: `accept-language` and `lang` are documented; no test or source shows Arabic address matching for KSA.
4. Valhalla matrix maximum locations: not stated in the matrix doc read.
5. Timefold pick-up-and-delivery and multi-depot in the Community Edition: not found in the pages read. Needs the full Timefold VRP docs (the latest path returned no VRP page).
6. pgRouting `pgr_vrpOneDepot`: "No documentation available" in the page read. Needs upstream confirmation before any use.
7. A maintained PostgreSQL H3 binding: not found (h3-pg is archived).
8. Ledger append-only status for Fleetbase (ledger submodule not read) and the OpenBoxes delete policy: not settled.
9. Odoo move-line model: not read. Only the quant write path was read.
10. ZATCA delivery-note requirements: not settled. ZATCA's official SDK and specification: not located (search returned third-party sources only).
11. MapLibre RN minimum Expo SDK, and whether a driver-app map is in scope at all: no ADR governs it.
12. React-pdf core renderer version: the latest GitHub release tag read is `@react-pdf/ui`.
13. Protomaps Arabic label rendering on a Saudi map: the style lists `ar`; no render check done.
14. OpenFreeMap Arabic labels and tile refresh cadence: not stated.
15. OpenTMS-type projects: no repo found under the names tried. The category may need a different search.
16. PMTiles in the browser (MapLibre protocol wiring) for ADR-0033's fallback: not checked in this pass.

## Sources (read 2026-11-01)

- GitHub API metadata (`repos/<owner>/<repo>`, `releases/latest`, `tags`, `license`) for each repo above, e.g. https://github.com/VROOM-Project/vroom, https://github.com/google/or-tools, https://github.com/TimefoldAI/timefold-solver, https://github.com/graphhopper/jsprit, https://github.com/PyVRP/PyVRP, https://github.com/Project-OSRM/osrm-backend, https://github.com/valhalla/valhalla, https://github.com/graphhopper/graphhopper, https://github.com/osm-search/Nominatim, https://github.com/komoot/photon, https://github.com/pelias/pelias, https://github.com/protomaps/PMTiles, https://github.com/protomaps/basemaps, https://github.com/hyperknot/openfreemap, https://github.com/maplibre/martin, https://github.com/CrunchyData/pg_tileserv, https://github.com/maplibre/maplibre-gl-js, https://github.com/maplibre/maplibre-react-native, https://github.com/postgis/postgis, https://github.com/pgRouting/pgrouting, https://github.com/uber/h3, https://github.com/zachasme/h3-pg, https://github.com/fleetbase/fleetbase, https://github.com/fleetbase/ledger, https://github.com/openboxes/openboxes, https://github.com/odoo/odoo, https://github.com/frappe/erpnext, https://github.com/bpampuch/pdfmake, https://github.com/diegomura/react-pdf, https://github.com/metafloor/bwip-js, https://github.com/lindell/JsBarcode, https://github.com/SallaApp/ZATCA, https://github.com/wes4m/zatca-xml-js
- OR-Tools routing tasks (per-vehicle starts and ends) and pickup-delivery page: https://developers.google.com/optimization/routing/routing_tasks ; https://developers.google.com/optimization/routing/pickup_delivery ; https://developers.google.com/optimization/routing/vrp (WebFetch, 2026-11-01)
- Timefold constraints quickstart (v2.7.1): https://docs.timefold.ai/timefold-solver/latest/quickstart/quarkus-vehicle-routing/vehicle-routing-constraints
- PyVRP features: https://pyvrp.org/
- VROOM API: https://github.com/VROOM-Project/vroom/blob/master/docs/API.md
- OSRM Table (5.x doc): https://project-osrm.org/docs/v5.24.0/api/#table-service
- Valhalla matrix: https://github.com/valhalla/valhalla/blob/master/docs/docs/api/matrix.md
- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
- Nominatim search API (5.3.3): https://nominatim.org/release-docs/latest/api/Search/
- Photon API and usage docs: https://github.com/komoot/photon/blob/master/docs/api-v1.md ; https://github.com/komoot/photon/blob/master/docs/usage.md
- Martin: https://maplibre.org/martin/
- OpenFreeMap: https://openfreemap.org/
- MapLibre RN Expo setup: https://github.com/maplibre/maplibre-react-native/blob/main/docs/content/setup/expo.md
- Protomaps language list: https://github.com/protomaps/basemaps/blob/main/styles/src/language.ts
- pgRouting VRP: https://github.com/pgRouting/pgrouting/blob/main/doc/categories/VRP-category.rst ; https://github.com/pgRouting/pgrouting/blob/main/doc/pickDeliver/pgr_vrpOneDepot.rst
- ZATCA FAQ (search excerpt only): https://zatca.gov.sa/en/E-Invoicing/Introduction/FAQ/Documents/E-Invoicing%20FAQ%20En.pdf
- Third-party ZATCA phase-2 notes (search excerpts): https://www.qoyod.com/en/knowledge-base/e-invoicing/e-invoicing-phases-1-and-2/ ; https://www.cleartax.com/sa/key-mandatory-fields-e-invoice-ksa
- Earlier notes: `docs/research/provider-facts-2026-10.md` (§§8, 10, 11, 12), ADRs 0002, 0004, 0005, 0009, 0010, 0011, 0012, 0018, 0019, 0021, 0028, 0033.
