# PLAT-10 · Roles and permissions

- **Status:** planned; brief after PLAT-8 closes (both touch `apps/api`, `packages/contracts`, `packages/db`)
- **Date:** 2026-11-01
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-6 (merged, PR #41); PLAT-15 (merged, PR #36) for the generated `Permission` union; PLAT-7 (merged, PR #61) for audit rows.
- **Lead:** architecture lead. **Executor:** `executor-api` (Opus), own worktree, native stack scratch databases. **Adversary:** yes (authorization, site visibility, separation of duties).
- **Issue:** #67. **Merge danger:** one-way door (migration 0008 seeds `core_roles`; every later order relies on the enforcement being on). **Legs:** one (items A–E).
- **Paths:** `apps/api`, `packages/contracts` (one generated map), `docs/contracts` (one new file, README §11 untouched), `.serena/memories`.

## 0. Goal

Every operation on the staff, platform and driver surfaces is allowed only to a principal whose roles hold the operation's `x-permission`, site-scoped roles see and touch only their sites, and the role combinations the ledgers forbid cannot be created, so that PLAT-11 onward issue tokens into a frame where authorization is enforced by the kernel from the contracts, not by each handler.

## 1. Binding rules and ADRs

- AGENTS.md hard rules: tenancy from the token; ledgers (separation of duties, M9); config through `packages/config`.
- ADR-0025 "Decision"; ADR-0006 "Decision" (allowlist rollout; the `feature_not_enabled` check is PLAT-13's, this order leaves the hook).
- `docs/architecture/identity-and-tenancy.md` §2 "Roles and permissions" (flat permission strings; system roles in wave 0; the role table; site restriction is data on the membership; separation of duties: cashier never driver, no single role approves and records an adjustment above the threshold), §4 "Tokens and sessions" (claims `roles`, `sites`, `scopes`), §9 "Adversary checklist" items 1, 2 and 5.
- `docs/contracts/README.md` §1 "Surfaces and base paths" (the authorization paragraph: one `x-permission` per operation; `core.auth.anonymous`, `core.auth.self`, `platform.auth.self`; recipient permissions granted by the token's `purpose`), §4 "Error model" (another account's or another site's resource is `404 not_found`, never `403`), §11 "Permission catalogue" (the catalogue and the role bundles, proposed; this order makes the bundles a file); `docs/contracts/permissions.yaml`; `docs/contracts/errors.md` §1 `forbidden`, §2 `role_combination_forbidden` (422), §4 `separation_of_duties` (403).
- `docs/architecture/data.md` §2.1 rows `core_roles` (`key` PK, `permissions text[]`, `custom boolean`; seeded by migration), `core_memberships` (`roles text[]`, `site_ids uuid[]`; the table itself is PLAT-12's), `core_platform_staff` (`role` CHECK super_admin, admin, support; PLAT-11's).
- PLAT-6 kernel: `Principal` (claims validated: `roles`, `sites`, `scopes`), `TenancyGuard`, `@Public()`, `ContractPipe`, the error filter; PLAT-15: `operationSchemas` keyed by operationId per surface and the `Permission` union; PLAT-7: `AuditWriter`.
- A-17 (contract types only in controllers and presenters; the permission map is generated, never hand-written).

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Bundles as a contract file | `docs/contracts/roles.yaml`: one entry per role of README §11's role table (`owner`, `admin`, `dispatcher`, `site_staff`, `warehouse_staff`, `cashier`, `viewer`, `driver`, `platform_super_admin`, `platform_admin`, `platform_support`) with `scope` (`account` or `platform`), `site_scoped` (true for site staff, warehouse staff, cashier), `surface` (`staff`, `driver`, `platform`) and the explicit permission list expanded from README §11 (no wildcards in the file; `owner` and `admin` list every core, delivery and wms permission; `viewer` every `*.read`); the contracts lint gains `eeasy/role-permissions-in-catalogue` (every bundle entry is in `permissions.yaml`), and a test in `packages/contracts` keeps the file equal to README §11's table (same mechanism as the catalogue test) |
| 2.2 | Generated maps | The contracts build (`scripts/unions.ts` or a sibling) emits, per surface, `operationPermissions: Record<operationId, Permission>` from `x-permission` and `crossTenantOperations` from `x-cross-tenant`, exported from `./<surface>/schemas` (server-safe), plus `roles.ts` with the bundles as typed constants from `roles.yaml`; a determinism test as for the other generated files |
| 2.3 | Seed | Migration `0008_core_roles` (hand-written, `-- reviewed`): `core_roles` per data §2.1 (`key text PRIMARY KEY`, `scope text CHECK (account, platform)`, `site_scoped boolean`, `permissions text[] NOT NULL`, `custom boolean NOT NULL DEFAULT false`, `updated_at`), seeded with the eleven bundles by `INSERT … ON CONFLICT (key) DO UPDATE SET permissions = EXCLUDED.permissions` so a later migration can re-seed; runtime roles get `SELECT` only; `core_roles` is a platform-table exemption in the schema test; a unit test asserts the SQL seed equals `roles.yaml` (parse the migration's VALUES or regenerate the SQL from the file and diff) |
| 2.4 | Permission resolution | `PermissionResolver` in `modules/kernel/authz/`: loads `core_roles` once at boot through the platform pool into an immutable map (system roles only in wave 0; a custom-roles order adds invalidation); `permissionsOf(principal)` = union of the bundles named in the token's `roles` claim (staff and driver) or the platform staff role (platform); unknown role names are ignored and logged once; the result is cached on the request frame |
| 2.5 | Enforcement | `PermissionGuard` (global, after `TenancyGuard`): looks up the handler's operationId (a `@Operation(id)` decorator the controllers already use for `ContractPipe`, or the route metadata it leaves) in the surface's `operationPermissions`; a handler without an operation id is refused at boot (a boot check like the `@HttpCode` one) unless `@Public()`; `core.auth.anonymous` and `core.auth.self`/`platform.auth.self` pass once the principal matches the surface; otherwise the principal's permission set must contain the operation's permission, else `403 forbidden` (no detail of which permission); driver surface permissions `delivery.driver.*` come from the `driver` bundle; recipient operations are granted by the token's `purpose` and belong to the recipient verifier (DEL order), so the guard skips `/v1/recipient` with a logged reason; API-key scopes (`scopes` claim) are wave 4's: the guard refuses the public surface for now (already 401 at the principal) |
| 2.6 | Site scoping | Site-scoped bundles (`site_scoped: true`) are evaluated against the membership's `site_ids` from the token's `sites` claim: (a) a `@SiteScoped({ from: 'path' \| 'query' \| 'body', name: 'site_id' })` decorator makes the guard answer `404 not_found` when the declared site is outside the principal's sites (README §4: never 403); (b) `siteFilter(ctx)` helper for repositories (`site_id = ANY(ctx.siteIds)` when the principal is site-scoped, no predicate otherwise) exposed from the kernel for list handlers; (c) a principal with a site-scoped role and an empty `sites` claim sees nothing (fails closed); non-site-scoped roles ignore `sites` |
| 2.7 | Separation of duties | `assertRoleCombination(roles)` in `modules/kernel/authz/`: throws `422 role_combination_forbidden` when `driver` is combined with any role holding a `delivery.cash.*` permission (M9); exported through `modules/kernel/public` for PLAT-12's membership writes; `assertSeparation({ approver, counter, requester })` throws `403 separation_of_duties` when the approver equals the counter or the requester (W-16), exported for the WMS orders; both unit-tested; no caller in this order beyond the tests |
| 2.8 | Audit | A `403 forbidden` on a non-public operation writes a committed audit row `core.authorization.denied` (actor, operation id, required permission, account) through `AuditWriter.recordCommitted`, rate-limited to one row per principal and operation per minute so a probing client cannot flood the log |
| 2.9 | Probe routes | Test-only controllers under `apps/api/test/` exercise the guard: an operation with `delivery.orders.read`, one site-scoped by path, one by body, one platform operation; each declared with real operation ids of the contracts so the generated map is used (the contracts stay the source) |
| 2.10 | Tests | Unit: resolver union, unknown role ignored, bundles equal README §11, SQL seed equals the file; HTTP with the test signer: owner passes, viewer refused on a write, dispatcher passes dispatch, cashier refused dispatch, site staff 404 outside their sites and 200 inside, empty sites fails closed, platform support refused `platform.rollout.manage`, super admin passes, a handler without an operation id refused at boot, the denial audit row written once per minute, driver bundle on the driver surface; integration in both RLS lanes |

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | `roles.yaml`, the lint rule, the README §11 parity test, the generated maps and `roles.ts` per 2.1 and 2.2 | contracts tests with counts; a planted bundle entry outside the catalogue red; two generations identical |
| B | Migration 0008 and the seed parity test per 2.3; schema-test exemption | migrate twice; psql shows eleven rows and `SELECT` only for runtime roles; seed test red on a planted difference |
| C | `PermissionResolver` and `PermissionGuard` per 2.4, 2.5, 2.8 with the boot check | HTTP tests per 2.10 (allowed, refused, anonymous and self doors, boot refusal, denial audit) |
| D | Site scoping per 2.6 and the separation helpers per 2.7 | HTTP tests per 2.10 (404 outside sites, fails closed); unit tests for both helpers |
| E | README "Authorization" section; memories per `memory_upkeep`; plan §8; draft PR | `pnpm turbo run typecheck lint test` green; `test:integration` green with `ELX_RLS` off and on; counts in §8.0 |

## 4. Commit plan

One commit per item `PLAT-10: <letter> <title>` with its §8.0 row; draft PR from the template with `Release note: none (technical PR)` and the `Memories:` line.

## 5. Exit criteria

- Every non-public operation on the staff, platform and driver surfaces is refused without the required permission; the required permission comes only from the contracts.
- Site-scoped principals cannot see or touch another site's resources (404), and an empty site list sees nothing.
- The eleven bundles are seeded and equal README §11; the forbidden role combination cannot be built.
- The adversary pass finds no critical or high; identity §9 items 1, 2 and 5 answered in §9.

## 6. Not in this order

Memberships, users and sites tables and their writes (PLAT-12); platform staff table and TOTP (PLAT-11); custom roles; API-key scopes (wave 4); recipient token purposes (DEL order); `feature_not_enabled` (PLAT-13); the stock-adjustment threshold setting (wave 3).

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | README §11's catalogue and bundles are marked "proposed, for the owner to confirm". Confirm as written? | Applied as written; a change is a `roles.yaml` edit plus a re-seed migration. |
| 2 | Should a `403 forbidden` tell the client which permission is missing? | No: the body carries only `forbidden`; the audit row has the detail. |

## 8. Executor notes (filled by the executor)

### 8.0 Progress

| Item | Commit | Tests (counts) | Interpretation |
|---|---|---|---|
| A | `PLAT-10: A roles.yaml, lint rule and generated maps` | contracts vitest 66/66 (new `roles.test.ts` 8: README §11 parity phrase by phrase, `never` clauses, site scoping and surfaces, M9 shape, `roles.ts` = yaml, maps = bundles, frozen entries, render twice = disk; `lint-rules.test.ts` +2); planted `delivery.driver.teleport` in the real `roles.yaml`: `redocly lint` exit 1 "Error was generated by the eeasy/role-permissions-in-catalogue rule", restored exit 0; two `pnpm build` runs: 868 generated files, identical checksums; typecheck (contracts, api, web, admin, driver), eslint, depcruise, prettier clean | doors (`core.auth.*`, `platform.auth.self`) are not listed in any bundle, so support drops README's `platform.auth.self` (8.2 #1); "every … delivery … permission" reads as the delivery (staff) row (8.2 #2); the lint rule runs once, on the `components` api; the guard reads `operationId`, `surface` and `permission` from each frozen generated `operationSchemas` entry, beside the plan's `operationPermissions` and `crossTenantOperations` (8.2 #3); `roles.ts` is exported from `/unions` |
| B | `PLAT-10: B migration 0008 core_roles and seed` | unit `test/roles-seed.test.ts` 3/3; red run with `'delivery.cash.deposit'` removed from the migration's owner row: 1 failed / 2 passed, restored 3/3; integration `roles-table.test.ts` + `test/schema/tenancy.test.ts` + `migrate.test.ts` 23/23; migration job twice on scratch `elx_plat10_b`: "Applied 9 migration(s); the database is at 0008_core_roles", then "Nothing to migrate"; psql: eleven rows (owner 55, admin 55, dispatcher 18, site_staff 4 site-scoped, warehouse_staff 13 site-scoped, cashier 6 site-scoped, viewer 18, driver 3 on `driver`, platform 12/10/5), grants elx_app SELECT, elx_platform SELECT; typecheck, eslint, prettier clean | `scope`, `surface` and `site_scoped` columns beside data §2.1's `key`, `permissions`, `custom` (plan 2.3 asks for `scope` and `site_scoped`; `surface` added so a bundle counts only on its surface, 8.2 #4); the re-seed skips `custom` rows; the seed test reads `roleBundles` (generated from `roles.yaml`) and parses the migration's VALUES |

### 8.1 Skills, documents and versions consulted

### 8.2 Interpretations the lead should check

### 8.3 Not done here

## 9. Lead review and adversary

Adversary: required (authorization, site visibility, separation of duties).
