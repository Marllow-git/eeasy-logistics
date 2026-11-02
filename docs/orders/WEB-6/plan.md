# WEB-6 · Zones, drivers and vehicles

- **Status:** planned 2026-11-02; registers and briefs when DEL-5 (PR #140) is on `main` (the trail and position doors), the design references (`docs/references/design/WEB-6.md`, researcher in flight) are merged, and the web executor slot is free (files disjoint from the API orders: `apps/web`, `packages/ui/map`, the `delivery` i18n namespace).
- **Date:** 2026-11-02
- **Wave:** 1 (roadmap §1.2). **Depends on:** WEB-3 (merged, PR #109: `DataTable`, `Form`, `Can`, the settings pages), DEL-1 (merged: zones and coverage doors), DEL-4 (merged: drivers, devices, vehicles doors), DEL-5 (shifts, trails, positions), Q-19 on its provisional default (§7 #1). **Unblocks:** WEB-7 (the dispatch board reuses the map, markers and the driver kit), WEB-5's order pin picker.
- **Lead:** architecture lead. **Executor:** `executor-web` (Opus), own worktree, native stack (the API on a scratch port with DEL-1, DEL-4 and DEL-5's doors, the worker, Mailpit, the WhatsApp stub, `seed:census`). **Adversary:** no (roadmap row; the API enforces every rule; the map renders data the session may read).
- **Issue:** opened at registration. **Merge danger:** two-way door (no migration, no contract change). Blast radius: the merchant app's first module screens; a new `map` entry in `packages/ui` with MapLibre loaded only on map routes; the CSP gains `worker-src blob:` (web §3.6).
- **Paths:** `apps/web` (`(merchant)/zones/*`, `(merchant)/drivers/*`, `(merchant)/vehicles/*`; `src/routes.ts` entries with the `delivery` feature key; `src/server/*` readers; `proxy.ts` the CSP directive; `public/map/` the fixture basemap of 2.2; `tests/census-delivery.spec.ts`), `packages/ui` (`src/map/*` new: `MapProvider`, `Map`, `ZonePolygonEditor`, `DriverMarkers`, `TrailLine`, `PinPicker` (the component, used by WEB-5 later); the driver kit pieces that are generic), `packages/i18n` (`delivery` namespace new, both locales), `packages/config` (`PUBLIC_MAP_STYLE_URL`, `PUBLIC_MAP_TILES_URL` in `publicConfig()` for the web app), `apps/api/src/seed/census.ts` (the `delivery` flag for the census accounts, zones, drivers, vehicles, a shift and a trail; a seam shared with no in-flight web order; the executor checks the ledger), `docs/architecture/web.md` §1 (the tree) and §6.4 (the chosen provider and the fixture), `docs/release-notes`, `.serena/memories`.
- **Design references:** `docs/references/design/WEB-6.md` (Mobbin; layout and states only; ADR-0016 and ADR-0033 win).

## 0. Goal

A dispatcher opens the Delivery module, sees the account's zones drawn on a map of the city, creates a zone by drawing a polygon or importing an official boundary as GeoJSON, edits it, deactivates it, and sets which sites cover it; manages drivers (create by phone, change the home site, capacity and status, see and revoke devices, reset a locked cash PIN) and vehicles; reads a driver's trail for a day and the latest positions of drivers on shift; every control is gated by the session's permissions and the module's feature flag, and every screen works in Arabic and English with the census proving it against the real API, so that WEB-7's dispatch board inherits a map, markers and a driver kit that already behave as the web document says.

## 1. Binding rules and ADRs

- AGENTS.md hard rules: Arabic and English for every string (zone names are bilingual; the map labels follow the locale); the API enforces tenancy, permission, site scope and the feature gate on every call; no server actions; allowlist by default (the module appears only when `me.features` holds `delivery`, web §4).
- ADR-0033 (MapLibre GL JS behind `MapProvider` in `packages/ui/map`; the two providers), ADR-0016, ADR-0029 (cursor lists), ADR-0032 (writes through the session fetcher with an `Idempotency-Key`), ADR-0015 (coverage is explicit data: the editor writes polygons, the API decides coverage).
- `docs/architecture/web.md` §3.6 (`worker-src blob:` for MapLibre; a tile origin added to `img-src` and `connect-src` only for a third-party provider), §4 (the route manifest with the feature key: a module whose feature is not visible is absent from the navigation and its routes answer `notFound()`), §6.3 and §6.4 in full (the provider interface, the components, `next/dynamic` with `ssr: false` on map routes only, geocoding never in the browser, the editor writes GeoJSON in the `Zone` schema and never computes coverage), §8 wave 1 rows "Zones map and coverage", "Drivers and devices", "Vehicles", §5 (RTL: the map and its controls do not mirror; the panels beside it do), §11.
- `docs/contracts/openapi/staff-delivery.yaml` `listZones`, `createZone`, `getZone`, `updateZone`, `listCoverage`, `replaceSiteCoverage`, `checkCoverage`; `listDrivers`, `createDriver`, `getDriver`, `updateDriver`, `listDriverDevices`, `revokeDriverDevice`, `resetDriverCashPin`, `clearDriverCashBlock` (if DEL-4 built it: the executor checks, else the control waits for DEL-8); `listVehicles`, `createVehicle`, `updateVehicle`; `getDriverTrail`, `listLatestDriverPositions`; `listShifts` (the driver's shifts on the detail page); schemas `Zone`, `Coverage`, `SiteCoverageRequest`, `CoverageCheck`, `Driver`, `DriverDevice`, `Vehicle`, `DriverTrail`, `DriverPosition`, `DriverShift`; `docs/contracts/errors.md`.
- DEL-1 plan §2 and §8.2 (the zone bounds: at most 20 polygons and 10,000 positions, inside the Saudi bounding box, `ST_IsValid` with the reason in `details`; the 200-zone limit; `replaceSiteCoverage` needs an active `branch` or `both` site; the list omits `boundary`; the smallest zone wins an overlap), DEL-4 plan §2 and §8.2 (`createDriver` by phone; the `duplicate` code; the device list without `device_id`; `revokeDriverDevice` by the row id; the PIN reset; `updateDriver` status rules), DEL-5 plan §2.7 (positions only for drivers on a live shift; a day without a trail is `404`), WEB-3 plan 2.1 to 2.4 and §8.2 (the shared components and their exports), WEB-2 2.4 (the session fetcher).
- Owner rule: Vercel skills first (`vercel:nextjs`, `vercel:react-best-practices`, `vercel:shadcn`); Context7 for MapLibre GL JS, the drawing library of 2.3 and `pmtiles`; versions and dates in §8.1.
- Memories `web/core`, `ui/core`, `core`.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | `MapProvider` and `Map` | `packages/ui/src/map/`: `MapProvider` interface (`styleUrl`, `attribution`, `transformRequest?`, `glyphsUrl`, `spriteUrl`), `ProtomapsMapProvider` (a PMTiles basemap served from `PUBLIC_MAP_TILES_URL` with the Protomaps basemap style built for `ar` and `en` labels from `name:ar` and `name:en`, the glyphs and sprites self-hosted beside the tiles), `HudhudMapProvider` as a stub that throws "not configured" until Q-28 (§7 #1); the `Map` component loads MapLibre with `next/dynamic` and `ssr: false`, takes `provider`, `locale`, `bounds` or `center` and `zoom`, children layers, exposes the map instance through a context for the layers; attribution shown; the CSP gains `worker-src blob:`; tiles and style come from the same origin as the app (no third-party origin), so `connect-src 'self'` holds |
| 2.2 | Tiles in local and ci | A fixture basemap `apps/web/public/map/fixture.pmtiles` of a small area (central Riyadh and central Jeddah, zoom 8 to 14, at most 8 MB) built by the executor from an OpenStreetMap extract with the `pmtiles` and `tilemaker` or `planetiler` tools and recorded in `tools/map-fixture/README.md` with the exact commands and the extract's date and licence line (ODbL attribution shown on the map); the census and local development use it through `PUBLIC_MAP_TILES_URL=/map/fixture.pmtiles`; a full Saudi basemap for staging and production is built by OPS-1's successor order with INT-1's object storage (§6; §7 #2); the fixture is also where the boundary-rendering check of web §6.4 starts (§7 #3) |
| 2.3 | Zone editor | `ZonePolygonEditor` on a maintained MapLibre drawing library (the executor picks after a Context7 check: `terra-draw` or `@mapbox/mapbox-gl-draw` with the MapLibre adapter; record the pick, its version and why) with draw, select, move a vertex, add and delete a vertex, delete a ring, and a MultiPolygon result; a client-side preview of DEL-1's bounds (polygon and position counts, the Saudi bounding box) shown as a warning before the save, the API's `validation_failed` with `ST_IsValidReason` rendered on the field; an **Import GeoJSON** control (a file input or a textarea for a `Polygon`, `MultiPolygon` or a `Feature` holding one) so an official boundary is loaded without drawing and the census can create a zone without map gestures; **Export** copies the zone's GeoJSON; the editor never computes coverage |
| 2.4 | Zones screens | `/zones` (`delivery.zones.read`; feature `delivery`): the map with every active zone as a filled polygon (inactive ones hatched when the filter shows them), a `DataTable` beside it (name in the locale with the other under it, source chip, active chip, sites count, created) with `active` and `q` filters in the URL and sort by `name_<locale>`; selecting a row fits the map to the zone; "New zone" (`delivery.zones.manage`) opens `/zones/new`: the editor plus a `Form` (`BilingualInput` names, `source` radio); `/zones/[zoneId]`: the editor loaded with the boundary, the form (`updateZone` PATCH of changed fields; `version` handled by the form), "Deactivate" and "Activate" with a confirmation that says coverage rows stay and the check ignores an inactive zone; the **Coverage** section: the account's `branch` and `both` sites as a checkbox list ("sites that deliver to this zone"), saved by `replaceSiteCoverage` per changed site with that site's full set (read from `listCoverage`), for `delivery.coverage.manage`; a **Check a point** tool (`checkCoverage` by a clicked point or a typed short code; the answer shows the zone and the sites) for `delivery.orders.read` |
| 2.5 | Drivers screens | `/drivers` (`delivery.drivers.read`): a `DataTable` (name, phone in `<bdi>`, home site, status chip, cash blocked chip, capacity, last seen from the positions call when on shift) with filters `status`, `site_id`, `cash_blocked`, `q` (name or phone tail) in the URL; a **Live** toggle that shows the positions map (`listLatestDriverPositions` every 15 s while the toggle is on, ADR-0009's polling twin; markers with the driver's name and the shift status; no stream until WEB-7); "New driver" (`delivery.drivers.manage`; dialog: name, phone with the `+966` prefix offered, home site select of `branch` and `both` sites, capacity; `duplicate` and `limit_exceeded` rendered); `/drivers/[driverId]` (`getDriver`): the header with status and cash state; the edit `Form` (`updateDriver`: name, home site, capacity, status with the arrows DEL-4 allows, a confirmation for `suspended` and `archived` saying sessions end); **Devices** (`listDriverDevices`; platform, app version, registered, revoked; "Revoke" with a confirmation naming the consequence: this phone signs out and cannot sign in again with a code); **Cash PIN** ("Reset PIN" with the `ReasonDialog`, `resetDriverCashPin`; "Clear cash block" with a reason if `clearDriverCashBlock` exists); **Shifts** (`listShifts` for the driver, newest first, status chips); **Trail** (a date picker defaulting to today, `getDriverTrail`, the `TrailLine` on the map with start and end markers; a `404` shows "no trail for this day") for `delivery.locations.read` |
| 2.6 | Vehicles screen | `/vehicles` (`delivery.drivers.read`): a `DataTable` (plate in `<bdi>`, kind chip, capacity, active chip) with `active` filter and sort by `plate`; "New vehicle" and the row's "Edit" (`delivery.vehicles.manage`): a dialog `Form` (plate upper-cased on blur, kind radio with one-line meanings, capacity, active switch); `duplicate` on the plate rendered on the field |
| 2.7 | Navigation and gating | `routes.ts` gains the `delivery` group (zones, drivers, vehicles) with feature key `delivery`; the navigation shows the group only when `me.features` holds it; the segment layout answers `notFound()` otherwise and `requirePermission` per route; `403 feature_not_enabled` from a hook refetches `me` (web §4); the census seed enables the `delivery` flag for the census accounts (a `core_feature_flags` row per account with `provisioned_by` the seed's platform user), since the rollout default is `allowlist` |
| 2.8 | i18n and RTL | `packages/i18n/<locale>/delivery.json` (new namespace: the three screens' strings, zone sources, driver statuses, device platforms, vehicle kinds, the editor's controls and warnings, the coverage copy); the map itself never mirrors (web §5); the panels and tables beside it do; map labels switch with the locale through the style's `name:<locale>` field; Latin digits on the map's scale |
| 2.9 | Tests and census | Component tests for `Map` (provider wiring, lazy load), `ZonePolygonEditor` (import, export, the bounds preview, a MultiPolygon result), `TrailLine` and `DriverMarkers` (data to layers), in both directions. Census `apps/web/tests/census-delivery.spec.ts` against the isolated stack with the fixture tiles and the seeded identities (the owner, a dispatcher with `delivery.*`, a viewer): zones: the map renders the seeded zones (a screenshot with the map canvas masked to its bounds, the layer count asserted through the exposed map instance), import a GeoJSON polygon, save, the row appears, edit the name, set coverage for one site, check a point inside and outside; the viewer sees no write control; drivers: create by phone (the WhatsApp stub receives the invitation), open the detail, revoke a seeded device with the confirmation, reset the PIN with a reason, see the seeded trail for its day, the live toggle shows the seeded driver on shift; vehicles: create and edit; a census account without the `delivery` flag has no module in the navigation and `/zones` is not found; `ar` and `en`, screenshots at 1440 and 390 reviewed in §8.0 (the map canvas masked; the Arabic layout reviewed); axe on every page; the `(merchant)` budget: MapLibre stays out of the shared floor (loaded on map routes only; the `check:budget` route classes updated for the map routes with a documented allowance, §7 #4); the Linux baselines committed from CI's first run before the PR is marked ready |
| 2.10 | Release note | Arabic `docs/release-notes/2026-11-<dd>-zones-drivers-vehicles.md` (the delivery module's first screens: zones on the map with coverage, drivers with devices and trails, vehicles) |

### 2a. Lead's improvements over the roadmap row

- **A fixture basemap** (2.2) so the map works offline in local and CI and the census can assert it, instead of waiting for the production tiles that need OPS-1 and INT-1.
- **GeoJSON import and export** on the editor (2.3): official boundaries load without drawing, the census creates zones deterministically, and merchants can move zones between accounts.
- **The first feature-gated module** (2.7) exercises web §4's K-6 path end to end, including the census seed's flag, before the dispatch board depends on it.
- **The client-side bounds preview** (2.3) mirrors DEL-1's limits so a dispatcher learns the problem before the save.
- **Coverage from the zone page** (2.4) with per-site full-set writes keeps DEL-1's `replaceSiteCoverage` contract intact and avoids a new matrix door.
- **The live positions toggle** (2.5) uses the polling twin the architecture names, so WEB-7 adds the stream on top instead of first building the map.

## 3. Build list

### Leg 1 (the map and zones)

| Item | Delivers | Verify |
|---|---|---|
| A | `MapProvider`, `Map`, the Protomaps provider, the fixture basemap and its README, the CSP directive, the config keys per 2.1, 2.2 | component tests; the map renders in the census harness |
| B | `ZonePolygonEditor` with import and export, the zones screens, coverage and the point check per 2.3, 2.4; the manifest group and the seed flag per 2.7; the `delivery` catalogue skeleton per 2.8 | census zones cases in `ar` and `en` |
| C | Plan §8 for the leg, memories, draft PR | full local gate; counts in §8.0 |

### Leg 2 (drivers, vehicles, release note)

| Item | Delivers | Verify |
|---|---|---|
| D | Drivers list with the live toggle, create, detail with devices, PIN, shifts and the trail per 2.5; `DriverMarkers`, `TrailLine` | census drivers cases |
| E | Vehicles per 2.6; web.md §1 and §6.4 amendments; release note per 2.10; the Linux baselines from CI; plan §8 complete; memories | census vehicles case; gate passes |

## 4. Commit plan

One commit per item `WEB-6: <letter> <title>` with its §8.0 row, pushed after each; draft PR from the template with the exact headings; body lines `Release note: docs/release-notes/2026-11-<dd>-zones-drivers-vehicles.md` and `Memories:`.

## 5. Exit criteria

- A dispatcher creates a zone by import and by drawing, sets its coverage, and a point check answers from the API; a viewer sees the map without write controls.
- A driver is created by phone, a device revoked, a PIN reset, and a day's trail rendered; a vehicle created and edited.
- An account without the `delivery` flag has no module in the navigation and its routes are not found; a `403 feature_not_enabled` refetches `me`.
- The map loads only on map routes from same-origin tiles with the CSP satisfied; the `(merchant)` budget holds outside the map routes and the map routes stay within their documented allowance.
- Both languages pass the census with the Arabic screenshots reviewed; the Linux baselines are committed; the Arabic release note exists.

## 6. Not in this order

The dispatch board, the live stream and assignment (WEB-7); the order pin picker's use (WEB-5 consumes `PinPicker`); the production basemap build and hosting (an OPS order after OPS-1 and INT-1; the boundary check §7 #3); the Hudhud tile provider (Q-28); official boundary imports as a seed (DEL-1 §7 #1); shift planning screens (WEB-7); the cash block clear if DEL-4 did not build the door (DEL-8).

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | Map tiles (Q-19) | Protomaps PMTiles behind the provider interface; Hudhud's provider when Q-28 settles and the agreement includes tiles |
| 2 | Where the production basemap lives | INT-1's object storage behind Cloudflare, built by an OPS order after OPS-1; until then staging uses the fixture area only |
| 3 | The boundary-rendering check for Saudi requirements (web §6.4) | A research note on the OpenStreetMap boundaries of the Kingdom in the Protomaps build before any public page shows a map; raised now so it is not found at launch |
| 4 | A budget allowance for map routes | MapLibre (about 250 KB gzipped) on `/zones`, `/drivers` (live and trail) only, as a documented per-route allowance in `check:budget` |

## 8. Executor notes (filled by the executor)

### 8.0 Counts

### 8.1 Deviations

### 8.2 Notes

### 8.3 Not done here

## 9. Lead review
