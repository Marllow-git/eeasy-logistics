# DEL-1 · Zones and coverage

- **Status:** registered 2026-11-02; briefs as the second executor beside WEB-4 (files disjoint: `apps/api` and `packages/db` against `apps/admin`).
- **Date:** 2026-11-02
- **Wave:** 1 (roadmap §1.2; the critical path's next step, started under the owner's "any next order whose dependencies are merged"). **Depends on:** PLAT-13 (merged, PR #104: the provisioning door, `FeatureGate`), PLAT-12 (merged, PR #89: sites), INT-2 (merged, PR #105: the geocoder for an address check), PLAT-8 (merged). **Unblocks:** DEL-2 (orders: coverage at intake), WEB-6 (zones screens), WMS-7's own-fleet card through the port, the provisioning trio WEB-4 leaves out.
- **Lead:** architecture lead. **Executor:** `executor-api` (Opus), own worktree, native stack scratch databases (PostGIS is in migration 0001), Redis. **Adversary:** no (roadmap row): every door is tenant-scoped through PLAT-6's frame and PLAT-10's guard; no credential, money or private data; the lead reviews the cross-tenant provisioning doors against PLAT-13's patterns.
- **Issue:** #125. **Merge danger:** one-way door (one migration: `del_zones`, `del_coverage`). Blast radius: the staff delivery doors of DEL-4 (drivers, vehicles, devices) become feature-gated by `delivery` (2.9); nothing else changes behaviour.
- **Paths:** `apps/api` (`modules/delivery/zones/` new: zones, coverage, check, the platform provisioning controller for zones and coverage; `modules/delivery/public/index.ts` the port; `modules/delivery/delivery.module.ts`; `modules/kernel/provisioning/` additive: `platformProvisionSite`; `modules/kernel/schema/zones.ts` new; `modules/kernel/public/index.ts` one export block if the geocoder port is not public yet; `drizzle/<timestamp>_del_zones.sql` and its snapshot; `test/integration/zones*.http.test.ts`, `provisioning*.http.test.ts`; `test/integration/global-setup.ts` one rollout row), `packages/db` (a `geometry` custom type if none exists; the exemption and RLS lists), `docs/architecture/data.md` (the zone bounds note), `docs/contracts/errors.md` only if a code is missing, `.serena/memories`. Shared seam `packages/contracts`: nothing expected; a needed change is recorded in §8.1 and checked against WEB-4 (which touches no contract).
- **Design references:** none (API only).

## 0. Goal

A dispatcher creates zones from an official boundary or a drawn polygon, lists and edits them, sets which zones each site serves, and asks whether an address or point is covered and from which sites; a platform admin provisions a new account's first site, zones and coverage through the cross-tenant door so an account is never created without coverage (ADR-0015); DEL-2 and WMS-7 ask the same question through a port in the same transaction; and the staff delivery doors answer `403 feature_not_enabled` for an account whose `delivery` module is not visible, so that the first order of DEL-2 can be refused with a typed reason instead of silently waiting.

## 1. Binding rules and ADRs

- AGENTS.md hard rules: tenancy from the token (every staff door in the token's account; the platform doors through `@CrossTenant()` with the door's account); side effects through the outbox (none here); allowlist by default (the `delivery` key stays `allowlist`; 2.9 gates the doors); Arabic and English names on every zone.
- ADR-0015 "Decision" (coverage is explicit data created with the account; an order outside coverage is refused with a typed reason), ADR-0025 (tenancy), ADR-0031 (`del_*` on the app pool with both RLS policies), ADR-0026 (Delivery's public surface: ports and DTOs only), ADR-0006 (rollout modes).
- `docs/architecture/domain-model.md` §1.1 (`CoverageQueryPort`: WMS → Delivery, sync read, same transaction), §3.4 (Zone: `name_ar`, `name_en`, `boundary` MultiPolygon 4326 with a GiST index, `source` official or drawn, `active`; Coverage: `(site_id, zone_id)`), W-11 (the refusal reason when the address is not covered).
- `docs/architecture/data.md` §2.1 rows `del_zones`, `del_coverage` (columns, indexes, CHECK `ST_IsValid`), §8 spatial rules (SRID 4326; contracts carry `{lat, lng}`; the API converts with `ST_SetSRID(ST_MakePoint(lng, lat), 4326)`), D-3 (the coverage query with `ST_Covers`, so a boundary point counts), §11 (migrations: timestamp names, CHORE-3; the `-- reviewed` header; hand-written index and CHECK lines).
- `docs/contracts/openapi/staff-delivery.yaml` `listZones`, `createZone`, `getZone`, `updateZone`, `listCoverage`, `replaceSiteCoverage`, `checkCoverage` with their permissions (`delivery.zones.read`, `delivery.zones.manage`, `delivery.coverage.manage`, `delivery.orders.read`) and schemas `SiteCoverageRequest`, `SiteCoverage`, `CoverageCheckRequest`; `platform.yaml` `platformProvisionSite`, `platformProvisionZone`, `platformProvisionCoverage` (`platform.accounts.provision`, cross-tenant) and `CoverageProvisionRequest`, `CoverageList`; `components.yaml` `Zone`, `Coverage`, `CoverageCheck`, `Point`, `Address`, `Site`; `docs/contracts/errors.md`.
- Kernel in place: PLAT-12 sites (`SitesService`, `createSite` rules, `site_kind_mismatch`, the `<account>/core_sites` lock), PLAT-13 (`@CrossTenant()` with `reason: 'optional'` on the account configuration doors, one platform transaction per door, `FeatureGate` and `@Feature(key)`, the rollout tables), INT-2 (`Geocoder` port: text or short code to a point), PLAT-6 `ContractPipe`, PLAT-7 `AuditSink`, PLAT-12's page helper and `ScopedRepository` (`transactionLock`), DEL-4's module registration (`DeliveryModule.forRoot`) and its 8.2 #10 lock pattern.
- Memories `core`, `api/core`, `api/delivery` (if DEL-4 wrote one).

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Tables | One generated, timestamp-named migration (CHORE-3; `drizzle-kit generate` from the schema, then the hand-written lines added and `-- reviewed`): `del_zones` (`account_id`, `name_ar`, `name_en` 1 to 120 code points, `boundary geometry(MultiPolygon, 4326) NOT NULL`, `source` CHECK official, drawn, `active boolean NOT NULL DEFAULT true`, `version`, timestamps; index `(account_id, active)`; GiST `(boundary)`; CHECK `ST_IsValid(boundary)`; both RLS policies); `del_coverage` (`account_id`, `site_id → core_sites`, `zone_id → del_zones`, `created_at`; unique `(account_id, site_id, zone_id)`; index `(account_id, zone_id)`; both policies); grants `elx_app` CRUD, `elx_platform` none (the platform doors write through the cross-tenant door on the app pool, as PLAT-13's `platformUpdateAccount` does for `core_accounts`: the executor confirms which pool that door uses and records it); a `geometry` custom type in `packages/db` (`customType` over `text` with `ST_AsGeoJSON` read and `ST_GeomFromGeoJSON` write, SRID set) if none exists |
| 2.2 | Zone bounds | The body's `boundary` is GeoJSON `MultiPolygon` (a `Polygon` is accepted and wrapped, recorded as a contract note); at most 20 polygons and 10,000 positions in total, coordinates inside Saudi Arabia's bounding box (lat 16 to 33, lng 34 to 56: a zone outside it is a data fault, `400 validation_failed` at `/body/boundary`), `ST_IsValid` checked in SQL before the insert (`400 validation_failed` with the reason text from `ST_IsValidReason` in `details`); the stored boundary is the given one (data §8, no simplification); the answered `boundary` is the stored GeoJSON; names trimmed, one line; `source` required on create (`official` or `drawn`); at most 200 zones per account (a constant, `422 limit_exceeded` with `details.limit`; `AccountLimits` has no zones key: §7 #2) |
| 2.3 | Zone doors | `listZones` (`active` filter, `q` over both names, sort `name_<locale>`? no: `name_ar`, `name_en`, `created_at`; the list omits `boundary` (a contract note: a list item carries `boundary: null`? no: the executor checks whether the generated schema allows omission; if not, the list carries boundaries and the limit defaults to 25), paged in SQL by cursor); `createZone` (`@Idempotent()`, under the account lock `<account>/del_zones` for the count); `getZone` (with the boundary); `updateZone` (PATCH of the sent fields: names, `boundary`, `active`; `version + 1`; deactivating a zone keeps its coverage rows and makes the check ignore it); audit `delivery.zone.created` and `delivery.zone.updated` with changed keys (the boundary recorded as its polygon and position counts, never the geometry) |
| 2.4 | Coverage doors | `listCoverage` (`site_id` filter; rows as `Coverage`); `replaceSiteCoverage` (`@Idempotent()`, `delivery.coverage.manage`): the site must belong to the account and be `active` of kind `branch` or `both` (a warehouse delivers nothing: `422 site_kind_mismatch`, DEL-4's code), every zone id must exist in the account (`400 validation_failed` at `/body/zone_ids/<i>`), the set is replaced under the account lock `<account>/del_coverage` (delete the rows not in the set, insert the missing, duplicates in the body collapsed), answered as `SiteCoverage`; audit `delivery.coverage.replaced` with `before` and `after` zone ids |
| 2.5 | Coverage check and port | `checkCoverage` (`delivery.orders.read`): `point` wins when both are sent; an `address` alone goes through INT-2's `Geocoder` (short code first, then text; no result → `covered: false`, `zone_id: null`, `site_ids: []`, `point` omitted); with `site_id` only that site's coverage counts; D-3's query over active zones with `ST_Covers`; when several zones cover the point the smallest by `ST_Area(boundary::geography)` is the `zone_id` and `site_ids` is the union of the sites covering any of them (recorded); the same service backs `CoverageQueryPort` in `modules/delivery/public`: `coverage(point, { siteId? }) → { zoneId, siteIds }` in the caller's unit of work (DEL-2 at intake, WMS-7 on the pack bench), plus `outsideCoverage` as the typed reason DEL-2 will store in `pending_reason` |
| 2.6 | Platform provisioning doors | In the provisioning flow after `platformProvisionAccount` (PLAT-13 2.2): `platformProvisionSite` (kernel provisioning, `@CrossTenant()` path with `reason: 'optional'`, `@Idempotent()`; PLAT-12's `createSite` rules and limit under the door's account; `201 Site`); `platformProvisionZone` (Delivery's platform controller under the same door; 2.2 and 2.3's create; `201 Zone`); `platformProvisionCoverage` (`PUT`, `entries` of `site_id` and `zone_ids`: every site and zone must belong to the account, each entry replaces that site's set as 2.4 does, in one app transaction; answered as `CoverageList` of the account's rows); each door audits as PLAT-13's doors do (actor the platform user, the door's one `platform.cross_tenant.accessed` row); a `provisioned`, `active` or `suspended` account accepts them, a `closed` one answers `409 invalid_transition`; the executor records whether the cross-tenant door reaches the app pool for `del_*` writes or whether these doors need the platform pool's bypass (PLAT-13 8.2 pattern) |
| 2.7 | Audit actions | `delivery.zone.created`, `delivery.zone.updated`, `delivery.coverage.replaced` (catalogue rows added to the domain model §6.3 table and data.md as A-26 amendments were); no outbox event (no consumer yet; DEL-2 reads coverage synchronously) |
| 2.8 | Fixtures and seeds | `apps/api/src/seed/fixtures.ts` gains two drawn zones per fixture account (small rectangles in Riyadh and Jeddah) and coverage from the fixture branch sites, deterministic ids; official city boundaries (data §8 "imported by a seed script per city") wait on a source ruling (§7 #1) and are not in this order; the census seed is untouched (WEB-6 adds what its census needs) |
| 2.9 | Feature gate | `@Feature('delivery')` on the staff controllers of this order and of DEL-4 (drivers, vehicles, devices, the driver staff doors); the driver surface (`/v1/driver/*`) and the platform doors stay ungated; the integration harness's `global-setup.ts` sets the `delivery` rollout mode to `all` on the scratch database (one row), so DEL-4's suites keep passing; one test proves a tenant under `allowlist` without the flag answers `403 feature_not_enabled` on `listZones` and passes after `platformSetFeatureFlag` |
| 2.10 | Tests | Unit: the boundary bounds and the GeoJSON wrap, the smallest-zone choice. HTTP on the PLAT-5 harness: create a zone from a polygon and a multipolygon, an invalid ring is `400` with the reason, outside the bbox `400`, the 201st zone `422`; list and get in both locales' sort; update a name and the boundary, deactivate and see the check ignore it; replace a site's coverage, a warehouse site `422`, a foreign zone `400`, the audit row's before and after; check by point inside, on the boundary (covered), outside, with `site_id`, by address through the stub geocoder, two overlapping zones give the smaller; the port in a transaction; the provisioning trio as a platform admin on a `provisioned` account (the door row with and without a reason) and `409` on a closed one; tenancy: a second account's zone is invisible and `404`; both RLS lanes; contract scenarios for the ten operations; `migrate` twice |

### 2a. Lead's improvements over the roadmap row

- **The provisioning trio completes here**, `platformProvisionSite` included: the contract lists it for wave 0 but PLAT-13 did not build it and WEB-4 left it out; without it the console cannot finish ADR-0015's "coverage with the account".
- **The first feature gate** goes on with this order (2.9), DEL-4's doors included, so the `allowlist` default means something before DEL-2 ships orders; the harness row keeps the existing suites green.
- **Bounds on geometry** (2.2) before any UI exists: a 10 MB boundary or a zone in the Atlantic is refused at the door, not found in a slow query later.
- **One deterministic answer for overlapping zones** (2.5) so DEL-2's intake and WMS-7's card agree.
- **The port carries the typed reason** DEL-2 stores, so the refusal text is defined once.

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | Migration, schema files, the `geometry` type, exemption and RLS lists, fixtures per 2.1, 2.2, 2.8 | migrate twice; tenancy schema test; both RLS lanes |
| B | Zone and coverage doors per 2.3, 2.4, 2.7 | HTTP per 2.10 (zones, coverage) |
| C | Coverage check, the port, the provisioning trio per 2.5, 2.6 | HTTP per 2.10 (check, port, provisioning) |
| D | Feature gate per 2.9; contract scenarios; data.md and domain-model rows; plan §8; memories; draft PR | gate test; full local gate; counts in §8.0 |

## 4. Commit plan

One commit per item `DEL-1: <letter> <title>` with its §8.0 row, pushed after each; draft PR from the template with the exact headings; body lines `Release note: none (API only; the console's provisioning screens carry the visible change)` and `Memories:`.

## 5. Exit criteria

- A platform admin provisions an account, a site, two zones and the coverage through the three doors; the owner's dispatcher then asks `checkCoverage` and gets the zone and the site.
- A point on a zone boundary is covered; an invalid or out-of-bbox boundary is refused with a typed error; the smallest zone wins an overlap.
- DEL-2 can call the port inside its transaction and get the typed reason for an uncovered address.
- The staff delivery doors answer `feature_not_enabled` under `allowlist` without the flag; the existing DEL-4 suites pass under the harness row.
- Both RLS lanes green; the migration applies twice; no contract change.

## 6. Not in this order

Official city boundary imports (§7 #1); the zones screens (WEB-6) and the map provider (Q-19); slot days per zone (DEL-3); coverage at intake and `pending_reason` (DEL-2); gating the driver surface by module; a zones key in `AccountLimits`; an outbox event for zone changes.

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | Source of official zone boundaries (city districts) | Drawn polygons only in this order; a research note picks the source (National Address districts or OpenStreetMap admin levels, licence checked) before the seed script |
| 2 | A zones limit per account | A constant of 200 until an `AccountLimits.zones` key is wanted (contract change) |
| 3 | Overlapping zones | Allowed; the smallest covering zone answers |

## 8. Executor notes (filled by the executor)

### 8.0 Counts

| Item | Commit | Tests (red, then green) | Interpretation |
|---|---|---|---|
| A | b63a510 | `packages/db` `geometry.test.ts` 3/3 (new); integration `ELX_RLS=on` `zones-table` + `sample`: red 3 failed / 3 passed with the migration as drizzle-kit generated it (no CHECK, no grants, no policies); green with `tenancy` + `drivers-table`: 5 files, 32/32; `drizzle-kit generate` twice: second "No schema changes"; `migrate` twice on `elx_del1_scratch` (`ELX_RLS=on`): applied 20, then "Nothing to migrate" | 8.2 #1 (pool and grants), #2 (EWKB read) |
| B | faa198b | unit `zone-input.test.ts` 5/5 (new); integration `ELX_RLS=on` `zones.http`: red 6 failed / 6 with the two controllers unregistered, green 6/6 | 8.2 #3 (list omits `boundary`), #4 (inactive site, foreign ids) |
| C | a141b6e | unit `coverage-query.test.ts` 2/2 (new; zones unit 7/7); integration `ELX_RLS=on` `coverage-check.http`: red 4 failed / 1 passed with item B's two controllers and module restored (the port case passes: the port file stayed), green 5/5; with `zones.http`, `sites.http`, `provisioning.http`: 4 files, 34/34 once a Mailpit of my own ran on 1025/8025 (3 PLAT-13 mail cases need it; 31/34 without) | 8.2 #1, #5 (check semantics), #6 (geocoder locale, unavailable) |
| D | see `git log` (`DEL-1: D`) | integration `ELX_RLS=on` `delivery-gate.http` (new): red 1 failed / 1 with the four controllers ungated, green 1/1; with `zones*`, `coverage-check`, `drivers*`, `vehicles`, `driver-*`, `features.http`: 12 files, 75/75 (WhatsApp stub of my own on 8080 for `drivers.http` createDriver, Mailpit for `features.http`); api unit 92 files, 1023/1023; api architecture clean (1115 modules); `packages/db` 22/22 + architecture clean; typecheck and lint of api, db, contracts clean; Prettier over every changed file | 8.2 #7 (harness row and `features.http`), #8 (audit catalogue) |

### 8.1 Deviations

- Consulted (2026-11-02): Context7 `/drizzle-team/drizzle-orm-docs` (custom types; the codec layer it documents is newer than the pinned drizzle-orm 0.45.4, whose `customType` has `dataType`/`toDriver`/`fromDriver` only); local drizzle-kit 0.31.11, @nestjs/common 12.3.2, postgres.js 3.4.9, PostgreSQL 17.9 with PostGIS 3.7.0. No NestJS, BullMQ or Zod docs needed.
- 2.1 grants: `elx_platform` is not "none". It keeps SELECT and INSERT on `del_zones`, SELECT, INSERT and DELETE on `del_coverage`, and gains INSERT on `core_sites` (8.2 #1).
- 2.1 geometry type: reads decode EWKB in JS, not `ST_AsGeoJSON` (8.2 #2).
- No contract change.

### 8.2 Notes

1. **Pool of the provisioning doors (2.6).** A `@CrossTenant()` door's unit of work runs on the platform pool with `elx.account_id` set (`unit-of-work.interceptor.ts`, `withCrossTenantUnitOfWork`), as `platformUpdateAccount` does. The trio therefore writes on elx_platform, so the migration grants it INSERT on `del_zones` and `core_sites` (0014 had revoked it) and INSERT, DELETE on `del_coverage`, with no UPDATE or DELETE on zones and sites. The door's audit row commits in the same transaction. The alternative was a second, app-pool transaction per door, which would split the door row from the write.
2. **GeoJSON read.** drizzle-orm 0.45 cannot wrap a selected column in SQL. `multiPolygon.fromDriver` decodes the hex EWKB PostgreSQL sends: exact doubles, Polygon wrapped, any other type throws. Writes go through `ST_SetSRID(ST_GeomFromGeoJSON(...), 4326)`.
3. **2.3, the list and `boundary`.** The generated `Zone` schema makes every field optional, so `listZones` leaves `boundary` out and keeps the default limit. `selectWhere` is the new scoped column read in `packages/db`. `evaluate` runs `ST_IsValidReason` before the write, so the CHECK never fires on a door.
4. **2.4, coverage refusals.** An inactive branch answers `409 invalid_transition` (`details.current_status`). A warehouse answers `422 site_kind_mismatch`. A foreign zone answers `400` at `/body/zone_ids/<i>` on the staff door and `404` on the platform door, as `platform.yaml` says. Sets over 200 zones (or over 100 entries on the platform door) are `400 too_long`. An unchanged set writes no audit row.
5. **2.5, check semantics (D-3).** Candidate zones are the active zones covering the point that some site covers (only that site when `site_id` is sent). With no candidate the answer is `zone_id: null, site_ids: []`, even when an uncovered zone contains the point. `covered` means `site_ids` is not empty. `checkCoverage` is not site-scoped.
6. **2.5, geocoder.** The text is geocoded with `locale: 'ar'`: the contract carries no locale, and the lint rule bans raw header decorators. A geocoder that is `unavailable` (`degraded: true`) is treated like not found: `covered: false` with no point. `GeocoderInputError` is `400` at the address field.
7. **2.9, harness row.** `global-setup.ts` sets `delivery` to `all`, so `Me.features` lists `delivery` for every account in a run. `features.http.test.ts` had five expectations changed to match: four `Me.features` lists now include `delivery`, and the rollout list shows `delivery: all`. Its gate checks still run on `wms`; nothing was removed. The new gate suite overrides the resolver's mode to `allowlist`.
8. **2.7, audit catalogue.** Domain model §6.3 lists events only, and no audit-action catalogue exists in the docs, so the three actions are recorded here and in the code only. No outbox event.
9. **2.8, fixtures.** The fixtures had no sites yet. Each fixture account gets a Riyadh and a Jeddah branch, a drawn rectangle zone around each, and the matching coverage. All have fixed ids and are written on the seed's platform pool.
10. **Tables.** `del_coverage` has an `id` primary key (data §1.3) besides the unique `(account_id, site_id, zone_id)`. Names are CHECKed with `char_length` 1 to 120.

### 8.3 Not done here

- Contract scenarios for the ten operations were added (401 without a session) but not run against a booted API locally; CI's contract lane runs them.
- `ELX_RLS=off` lane, the full integration suite and Compose: CI only (token budget). The RLS-on lane ran the suites listed in §8.0.
- Official boundaries (§7 #1), a zones key in `AccountLimits` (§7 #2) and gating the driver surface: out of scope (§6).

## 9. Lead review
