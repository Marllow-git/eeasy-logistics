# PLAT-15 · Contracts generation

- **Status:** planned
- **Date:** 2026-11-01
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-1 (merged, PR #22), PLAT-3 (merged, PR #30).
- **Lead:** architecture lead. **Executor:** `executor-api` (Opus), own worktree. **Adversary:** no (roadmap row `Adv. no`; generated code over documented contracts, no auth or data path).
- **Legs:** two. Leg 1 (items A–E) stays inside `packages/contracts` and may run beside PLAT-5. Leg 2 (items F–G) touches `.github/workflows/pr.yml` and starts only after PLAT-5 merges (handbook 01 "Running orders in parallel").
- **Stack:** none for leg 1; leg 2 uses the Compose `ci` profile in CI and the native stack locally (`tools/native-stack.sh`, database name `elx_plat15`).

## 0. Goal

The OpenAPI files in `docs/contracts/openapi/` become the one typed seam between the API, the web app and the driver app: the repository lint rules of document 3 §9 run in CI, each surface is bundled to one file, and from the bundles come TypeScript types, a fetch client, TanStack Query hooks, Zod schemas and MSW handlers per surface, plus the `Permission`, `StreamEventName` and `ErrorCode` unions, so a misspelt permission, event or code fails typecheck; a contract-test harness exercises the generated client against the running API and fails on any undocumented status, field or error code.

## 1. Binding rules and ADRs

- `docs/contracts/README.md` §9 "OpenAPI files and validation" (lint rules, bundle per surface, generated types and clients for `apps/web` and `apps/driver`, contract tests in Compose, YAML is the source of truth, generated code never edited), §1 "Surfaces and base paths", §3 "Conventions" (`Idempotency-Key`, `If-Match`, `X-EL-Client`), §4 "Error model" and `docs/contracts/errors.md` (the `ErrorCode` set), §6 "Server-sent events" (the `StreamEventName` set), §11 "Permission catalogue" (the `Permission` set).
- `docs/architecture/web.md` §2.2 "Boundaries" (the web app reaches the API only through the generated clients; the dependency-cruiser rule exists since PLAT-1) and §2.3 "Code generation" (Orval per surface: fetch client, TanStack Query hooks, Zod schemas, MSW handlers; the three unions; TanStack Query as the cache).
- `docs/architecture/driver-app.md` §1 "Shape" (the driver app shares `packages/contracts` types and client; React Native runtime, no Node APIs in the client).
- `docs/handbook/03-testing.md` table row "Contract" (`packages/contracts/test/`, runs in CI) and "Rules".
- ADR-0003 (one monorepo, contracts as the seam), ADR-0026 (staff surface split by bounded context), ADR-0029 (cursor pagination and SSE event names), ADR-0032 (browser reaches the API on the web origin: same-origin base URL in the browser client, `API_INTERNAL_URL` on the server).
- PLAT-4: any base URL or environment value comes through `packages/config` (`publicConfig()` for web and driver); the generated client takes a base URL and a fetch as parameters and reads no environment.
- Owner decision pending (raised 2026-11-01): a separate admin console application on its own hostname. The per-surface entry points of item E serve both outcomes; nothing here presumes one web app.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Lint | `@redocly/cli` (already pinned in `packages/contracts`) with `docs/contracts/redocly.yaml` extended by the repository rules of document 3 §9 that are still missing: every `$ref` resolves (built-in `no-unresolved-refs: error`), every write (`post`, `put`, `patch`, `delete`) declares the `Idempotency-Key` parameter unless its `operationId` is in an exempt list kept in the config (sign-in, refresh, logout, OTP, token exchanges, SSE and stream routes), `x-wave` is an integer 0 to 4, and `x-permission` values are members of the catalogue (a custom rule that reads `docs/contracts/README.md` §11 is fragile; instead the catalogue is a YAML list `docs/contracts/permissions.yaml` added by this order, cross-checked against README §11 by a test); `x-cross-tenant` only on platform operations |
| 2.2 | Bundle | `redocly bundle` per surface into `packages/contracts/generated/openapi/<surface>.yaml` (and `.json`), dereferencing `./components.yaml` refs; surfaces: `staff` (the three staff files merged into one bundle with `redocly join`, operationIds already unique), `platform`, `driver`, `recipient`, `public` |
| 2.3 | Generator | Orval, latest stable at build time, pinned exactly and recorded in §8.1; one `orval.config.ts` with one entry per surface; outputs per surface: `fetch` client (`client: 'fetch'`, custom mutator), TanStack Query hooks (`client: 'react-query'`, `httpClient: 'fetch'`), Zod schemas (`client: 'zod'`), MSW handlers (`mock: true`); `driver` and `recipient` entries emit the fetch client and Zod schemas only (no hooks, no MSW) so the driver app pulls in no browser-only code |
| 2.4 | Custom mutator | `src/http.ts`: `createFetcher({ baseUrl, fetch, headers })` returning the function Orval calls; adds `Accept-Language`, `X-Request-Id` (UUID per call) and `X-EL-Client: web` on every non-GET; parses the error body into a typed `ApiError` carrying `code: ErrorCode`, `message`, `details`, `request_id`, `status`; no retry, no refresh logic (web §3.2's single-flight refresh is WEB-1's wrapper around this fetcher); reads nothing from the environment |
| 2.5 | Unions | A small generator script `scripts/unions.ts` (run as part of `build`) writes `generated/unions.ts`: `Permission` from `docs/contracts/permissions.yaml`, `StreamEventName` from the `x-sse-events` extension this order adds to the four stream operations (the names of README §6; wildcard families expanded from the domain event catalogue are out of scope, the union lists what the table lists), `ErrorCode` parsed from the first column of every table in `docs/contracts/errors.md` with a test that the count matches a committed snapshot |
| 2.6 | Generated code and git | Generated output lives under `packages/contracts/generated/` and is **not committed** (gitignored); `pnpm --filter contracts build` regenerates it; Turborepo `build` for `packages/contracts` has inputs `docs/contracts/**`, `orval.config.ts`, `scripts/**`, `src/**` and outputs `generated/**`; dependants already run `^build` before `build`, and this order adds `^build` to `typecheck`, `lint` and `test` of `packages/contracts`' dependants through the package-level `turbo.json` of `apps/web` and `apps/driver` (not the root), so a fresh worktree typechecks without a manual step; a CI step runs the generation twice and `git diff --exit-code` is not applicable, so determinism is asserted by hashing `generated/` across two runs |
| 2.7 | Package layout | `exports`: `./staff`, `./platform`, `./driver`, `./recipient`, `./public` (each `{ client, hooks?, schemas, mocks? }` barrels from `generated/<surface>/`), `./http` (the fetcher and `ApiError`), `./unions`; no root export, so an app imports only the surfaces it serves and a bundle holds no other surface's operations; `sideEffects: false` |
| 2.8 | Contract-test harness | `packages/contracts/test/`: Vitest; a runner that loads a surface bundle, and for each **scenario** file (`test/scenarios/<surface>/<operationId>.ts`: a request builder and an expected status) calls the API through the generated client and validates the response status, headers and body against the bundle with `ajv` (OpenAPI 3.1 schemas, `formats`), failing on an undocumented status, an undocumented field (`additionalProperties` treated as false for the assertion even when the schema allows it, reported as `undocumented_field`) or an error `code` outside `ErrorCode`; operations without a scenario are listed in a coverage table printed at the end (advisory); the API base URL and the credentials come from command-line flags or a scenario-provided sign-in, never from `process.env` directly (the shared dependency-cruiser rule) — the runner script reads `CONTRACT_API_URL` once through a tiny `packages/config` entry `contractTestConfig()` |
| 2.9 | Wave 0 scenarios | The API exposes only `/health` and `/ready` today and neither is an OpenAPI operation; the harness therefore ships with zero scenarios and a **self-test**: a Vitest test starts an in-process `http` server that returns (a) a documented response, (b) an undocumented status, (c) an undocumented field, (d) an unknown error code for one real operation (`platformListAccounts` from the platform bundle) and asserts green, red, red, red. Later orders add scenarios in the PR that implements the operation (handbook 03 "Contract" row) |
| 2.10 | CI | Leg 2: `typecheck-lint` already runs `pnpm turbo run typecheck lint`, which after 2.6 builds the contracts first; add a step "Contracts generate twice and compare" there; `api-test` lane: after the API is started for `web-build-census` (it already is), run `pnpm --filter contracts test:contract -- --api http://127.0.0.1:3000` in `web-build-census` (the lane that already has an API process), so no new job is needed; the check names of PLAT-3 stay |
| 2.11 | Web and driver consumption | Not in this order beyond the architecture rules: `apps/web` and `apps/driver` keep their placeholder pages; this order adds the dependency `@eeasy-logistics/contracts` to both `package.json` files and one typecheck-only import each (`import type { Permission } from '@eeasy-logistics/contracts/unions'`) so the pipeline order is proven; WEB-1 and DRV-1 wire the clients |

## 3. Build list

### Leg 1 (packages/contracts only)

| Item | Delivers | Verify |
|---|---|---|
| A | Lint rules per 2.1, `docs/contracts/permissions.yaml`, the idempotency exempt list, `x-sse-events` on the four stream operations; any contract fix the new rules force is made in the YAML and listed in §8.2 | `pnpm --filter contracts lint` green; a planted write without `Idempotency-Key`, a planted permission outside the catalogue and a planted dangling `$ref` each shown red |
| B | Bundles per 2.2, `build:bundle` script, `generated/` gitignored, Turborepo inputs and outputs per 2.6 | five bundles produced; `redocly lint` on each bundle green; bundle hash identical across two runs |
| C | Orval configuration and outputs per 2.3, custom fetcher per 2.4 with unit tests (headers, `ApiError` parsing, no environment read) | `pnpm --filter contracts build` green; `tsc --noEmit` over `generated/` green; fetcher tests with counts |
| D | Unions per 2.5 with the snapshot test | `Permission` count equals README §11; `ErrorCode` count equals the errors.md tables; `StreamEventName` lists README §6; a planted typo in a permission string in a test file fails typecheck |
| E | Package exports per 2.7, README of the package, `apps/web` and `apps/driver` dependency and type import per 2.11, `apps/web` dependency-cruiser rule extended so `apps/web` may import only `@eeasy-logistics/contracts/{staff,recipient,http,unions}` (platform excluded until the admin-console decision) and `apps/driver` only `/driver`, `/http`, `/unions` | `pnpm turbo run typecheck lint test` green from a clean `generated/`; a planted `apps/web` import of `@eeasy-logistics/contracts/platform` red in the web architecture test |

### Leg 2 (after PLAT-5 merges; touches `.github`)

| Item | Delivers | Verify |
|---|---|---|
| F | Contract-test harness per 2.8 and the self-test per 2.9; `test:contract` script; `contractTestConfig()` in `packages/config` | self-test green, red, red, red as listed; `pnpm --filter contracts test` green with counts |
| G | CI per 2.10; `.serena/memories` updated per `memory_upkeep` (scripts, package entry points, generated-code rule); package README | the PR's Actions run shows the generate-twice step and the contract self-test in `web-build-census`; check names unchanged |

## 4. Commit plan

One commit per item `PLAT-15: <item letter> <short title>`; §8.0 row committed with each. Leg 1 ends with the draft PR; leg 2 is a fresh executor on the same branch after a rebase onto main.

## 5. Exit criteria

- `pnpm --filter contracts lint` enforces every rule of document 3 §9 and is green on the current contracts.
- Five bundles, five generated surface packages, three unions; `pnpm turbo run typecheck lint test build` green from a clean checkout with no manual generation step.
- No generated file committed; generation deterministic.
- The harness self-test proves red on undocumented status, field and error code; the CI lanes run it.
- `apps/web` cannot import the platform surface; `apps/driver` cannot import hooks or MSW.

## 6. Not in this order

Wiring the clients into screens (WEB-1, DRV-1); the single-flight refresh wrapper (WEB-1); MSW handlers in the driver app; a public SDK package for API-key customers (wave 4); scenario files for real operations (each implementing order); the admin-console split (owner decision pending, ADR-0038 if accepted); committing generated code (2.6 rules it out; revisit only if IDE friction is reported).

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | Generated code committed or built? | Built, not committed (2.6). A revert of this order removes nothing from `main` but the generator. |
| 2 | Should the platform surface's generated package live in a separate workspace package from day one (`packages/contracts-platform`) in anticipation of the admin-console split? | No: one package with per-surface exports and an architecture rule in `apps/web` (item E) gives the same bundle guarantee; a separate package is a rename later if ADR-0038 is accepted. |

## 8. Executor notes (filled by the executor)

### 8.0 Progress

| Item | Commit | Tests (counts) | Interpretation |
|---|---|---|---|
| A | e98457d | `pnpm --filter contracts lint` green on the 8 contract files; `vitest run test/lint-rules.test.ts` 8/8 (clean fixture green; missing key, unknown permission, dangling `$ref`, `x-wave: 5`, `x-cross-tenant` off platform, stream without `x-sse-events` each red; exempt id and platform cross-tenant green). Real-file plant in `staff-wms.yaml` (key removed, `wms.stok.read`, `ClientErrorr`): lint exit 1 with `eeasy/idempotency-key` ×1, `eeasy/permission-in-catalogue` ×1, `no-unresolved-refs` ×2; restored, exit 0 | Rules as a local Redocly plugin `packages/contracts/redocly/plugin.js` (configurable rules cannot test a resolved parameter or a numeric range); exempt list = README §3 doors, 30 operationIds; outbound `webhooks:` skipped by the rule; no contract fix was forced (§8.2) |
| B | 3f32520 | Clean `generated/` then `pnpm turbo run build --filter=@eeasy-logistics/contracts`: 10 files (5 surfaces × yaml, json); `pnpm --filter contracts lint:bundles` exit 0, 5 of 5 validated; two consecutive `node scripts/bundle.ts` runs give the same sha256 over `generated/openapi` (`b97a8829…`); second turbo run `1 cached, 1 total`; `git check-ignore` confirms `generated/` ignored | Staff join forced a contract fix: tags `locations` (staff-delivery, driver positions) and `channels` (staff-wms, publications) collided with staff-wms and staff; renamed to `driver-locations` and `channel-publications` (tags only, no path or operationId change). Bundles are linted with the recommended ruleset (the repository rules run on the sources) |
| C | this commit | From a clean `generated/`: `pnpm turbo run typecheck lint test --filter=@eeasy-logistics/contracts` 4/4 tasks green (build, then `tsc --noEmit` over `src`, `test`, `scripts` and all of `generated/`: 0 errors). `test/http.test.ts` 12/12 (base URL join, `Accept-Language`, fresh `X-Request-Id`, per-call locale and headers, `X-EL-Client` on non-GET only and off with `webClient: false`, 2xx shape, 204, `ApiError` from the `Error` body, `unexpected_response` fallback, missing fetcher, network error unchanged, no `process.env` read); red run with the header lines removed: 3 failed, 9 passed; restored 12/12. Package total 20/20. Two consecutive `pnpm run build`: same sha256 over 861 generated files (`30753f68…`) | Base URL and fetch are per call (`{ fetcher }`), never module state; generated paths include the `servers` base path (`getBaseUrlFromSpecification`), so `baseUrl` is the origin only; `webClient` and `requestId` options added for the driver app; `ApiError.code` typed `string` until item D |

### 8.1 Skills, documents and versions consulted

### 8.2 Interpretations the lead should check

### 8.3 Not done here

## 9. Lead review and adversary

Adversary: not required (roadmap). Lead review rulings are recorded here after `/code-review`.
