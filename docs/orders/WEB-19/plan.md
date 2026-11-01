# WEB-19 · Admin console scaffold

- **Status:** in review (draft PR #45)
- **Date:** 2026-11-01
- **Wave:** 0 (roadmap §1.1, added by A-16). **Depends on:** PLAT-3 (merged, PR #30), PLAT-15 (merged, PR #36).
- **Lead:** architecture lead. **Executor:** `executor-web` (Opus), own worktree. **Adversary:** no (roadmap row; a scaffold with placeholders, no auth or data path).
- **Issue:** #43. **Merge danger:** two-way door. **Legs:** one (items A–E).
- **Paths:** `apps/admin` (new), `apps/web` (the `(platform)` group leaves; smoke spec), `packages/config` (one variable), `.env.example`, `.github/workflows`, `.dockerignore`, `README.md`, `.serena/memories`. PLAT-6 (in flight) touches `apps/api`, `packages/db` and `packages/config`; the config overlap is one added variable, `PUBLIC_ADMIN_URL`, which this order owns and PLAT-6 leg 2 consumes.

## 0. Goal

The platform console is its own Next.js application, `apps/admin`, built, tested and shipped like `apps/web`: its own standalone image and CI lane, Arabic default with RTL, the platform contracts surface and nothing else, so that WEB-4 builds its screens inside an application the merchant bundle never contains (ADR-0038).

## 1. Binding rules and ADRs

- ADR-0038 "Decision" (two applications; surface imports per app; per-host edge routing is OPS-1's; shared code stays in packages). ADR-0032 "Decision" bullet 1 (same-origin API per application). ADR-0016 (Arabic and English everywhere).
- `docs/architecture/web.md` §1 "Scope and surfaces" (the two tables), §1.1 "Layout of apps/web and apps/admin", §1.2 "Isolation between the groups" (separate root layouts, cookies, CSP; the `apps/admin` bullet), §5 "Locale" (the `el_locale` cookie, Arabic default).
- `docs/architecture/platform.md` §2 "The stack as containers" (the `admin` row), §4 (CI lanes; `admin-build-census`), §8 "Edge and network" (documented, not built here).
- `docs/handbook/03-testing.md` "Census" row and the A-17 "Test data comes from the contracts" rule (the smoke spec needs no API data).
- PLAT-1 plan decision 2.8 (the web skeleton pattern: route groups as empty layouts, one placeholder page per group, bilingual string from `packages/i18n`, `dir` from the locale) and PLAT-3 decisions 2.4 and 2.8 (the census lane shape; the image build, probe and scan), PLAT-15 item E (surface entry points and the web rule `web-contracts-surfaces`).
- Vercel and Next.js skills (owner rule): `vercel:knowledge-update` (2026-09-18) and `vercel:nextjs` loaded by the lead on 2026-11-01; Next.js 16.4.3 conventions (`proxy.ts` not `middleware.ts`, async `cookies()`, `output: 'standalone'` with `outputFileTracingRoot`).

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Application | `apps/admin`, package `@eeasy-logistics/admin`, Next.js 16.4.3 and React 19.3.0 exactly as `apps/web` (same pins, same `tsconfig`, ESLint and Prettier setup, same `turbo.json` with `^build` on typecheck, lint and test); `next.config.ts` with `output: 'standalone'`, `outputFileTracingRoot` at the repository root and `transpilePackages` for `config` and `i18n` |
| 2.2 | Route groups | `(auth)` with `sign-in/page.tsx` and `sign-in/totp/page.tsx`; `(platform)` with `page.tsx` at `/` (no `/platform` segment: ADR-0038) and the placeholder sub-routes WEB-4 fills later are **not** created now (empty folders are noise); each group has its own root layout rendering the same `RootHtml` pattern as `apps/web` (`lang` and `dir` from `el_locale`, Arabic default); the shared `root-html.tsx` and `locale.ts` are duplicated into `apps/admin/src` for now (two small files; WEB-1 moves them into `packages/ui` when the design system lands, recorded in §6) |
| 2.3 | i18n | placeholder keys `placeholder.admin` and `placeholder.admin_sign_in` added to `packages/i18n` `ar/common.json` and `en/common.json` (parity test); the `platform` namespace is WEB-4's |
| 2.4 | `apps/web` | the `(platform)` route group and its two files are deleted; `placeholder.platform` key removed from both catalogues; the smoke spec drops the `/platform` route; the `web-contracts-surfaces` rule stays as PLAT-15 wrote it |
| 2.5 | Config | `PUBLIC_ADMIN_URL` (http(s) URL, optional outside production, required in production) added to `packages/config` server schema next to `PUBLIC_WEB_URL`, exposed as `config.app.publicAdminUrl`; `.env.example` gets `PUBLIC_ADMIN_URL=http://localhost:3002` with a comment; `apps/admin` reads its public values through the existing `@eeasy-logistics/config/web` entry (`publicConfig()`; the `NEXT_PUBLIC_*` set is the same for both apps; a separate entry is created only when the sets diverge) |
| 2.6 | Ports | local dev `3002` (`next dev -p 3002`, `next start -p 3002`); the image listens on `3000` like the web image; CI runs the admin server on `3002` beside the API on `3000` and the web on `3001` |
| 2.7 | Image | `apps/admin/Dockerfile` identical in shape to `apps/web/Dockerfile` (build stage with the filtered install, standalone copy, non-root uid 1000, npm and corepack removed); `.dockerignore` already re-includes `docs/contracts/` and `docs/architecture/domain-model.md` (PLAT-15); verify nothing else the admin build reads is excluded |
| 2.8 | CI | `pr.yml`: new required job `admin-build-census` mirroring `web-build-census` (ci profile up, API built and started on 3000, admin standalone on 3002, Chromium, the admin smoke spec in `ar` and `en`, screenshots artifact `admin-build-census`); the contract-test step stays in `web-build-census` only; `main.yml`: matrix `app: [api, web, admin]`, probe `GET /` for admin like web, image `ghcr.io/marllow-git/eeasy-logistics/admin`; README "CI" section lists seven required checks and the branch-protection command gains `admin-build-census` |
| 2.9 | Architecture rules | `apps/admin/.dependency-cruiser.cjs`: the web's server-side-data-access rule, `environmentRules({ configEntry: 'web.ts' })`, and `admin-contracts-surfaces` allowing only `/platform`, `/http` and `/unions` (never `/staff`, `/recipient`, `/driver`, `/public`, and `/platform/mocks` only from `tests/`); `apps/admin/src/contracts.ts` with the same type-only import pattern as `apps/web/src/contracts.ts` to prove the pipeline; `apps/admin` depends on `@eeasy-logistics/contracts` and `@tanstack/react-query` 5.105.0 like the web |
| 2.10 | Smoke spec | `apps/admin/tests/smoke-locale.spec.ts` and `playwright.config.ts` (base URL `http://127.0.0.1:3002`, fixed, same reasoning as the web's): routes `/` and `/sign-in` set `lang` and `dir` per locale and render an `h1`; `test:smoke` script |
| 2.11 | Not built | `proxy.ts` (sessions are WEB-2's), CSP headers (WEB-1), the per-host edge `404` (OPS-1), Compose and native-stack entries (neither stack runs the web apps today) |

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | `apps/admin` per 2.1, 2.2, 2.3, 2.6, 2.10; `apps/web` changes per 2.4 | `pnpm --filter admin build` green; `pnpm --filter admin test:smoke` 4/4 (two routes, two locales) against `next start -p 3002`; the web smoke spec 6/6 after dropping `/platform`; i18n parity green; `GET /platform` on the web app is 404 |
| B | Config per 2.5 | config unit tests: valid URL, invalid URL named, required in production; `.env.example` comment |
| C | Dockerfile and ignore per 2.7 | the Dockerfile stages replayed by hand without Docker (as PLAT-3 did); CI's `image (admin)` dry run is the proof |
| D | CI per 2.8 and README | the PR's Actions run shows `admin-build-census` green with both screenshots and `image (admin)` built, probed and scanned; check names of the other lanes unchanged |
| E | Architecture rules per 2.9, `.serena/memories` per `memory_upkeep` (new app, scripts, lanes, surface rule), plan §8 | a planted `apps/admin` import of `/staff` and of `/platform/mocks` from `src` each red, green after removal; `pnpm turbo run typecheck lint test build` green from a clean tree |

## 4. Commit plan

One commit per item `WEB-19: <letter> <title>` with its §8.0 row; draft PR from the template; body lines `Release note: none (scaffold, nothing user-visible)` and the `Memories:` line.

## 5. Exit criteria

- `apps/admin` builds standalone, serves `/` and `/sign-in` in both locales with the right `dir`, and its image passes the probe and the scan on CI.
- `apps/web` has no platform route; its bundle cannot import the platform surface (rule exists since PLAT-15).
- Seven required checks on CI; README names them.
- `PUBLIC_ADMIN_URL` validated by the config module.

## 6. Not in this order

Sessions, sign-in forms, TOTP (WEB-2); the design system, CSP and `proxy.ts` (WEB-1); the platform screens (WEB-4); moving `root-html.tsx` and `locale.ts` into `packages/ui` (WEB-1); the edge routing and the admin IP allowlist (OPS-1); Compose services for the web apps (none exist for web either).

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | Admin hostname and brand (Q-21 pending) | `admin.<domain>`; the scaffold carries no hostname, only `PUBLIC_ADMIN_URL` |

## 8. Executor notes (filled by the executor)

### 8.0 Progress

| Item | Commit | Tests (counts) | Interpretation |
|---|---|---|---|
| A | 6e4e1cb | `pnpm --filter admin build` exit 0 (routes `/`, `/sign-in`, `/sign-in/totp`, standalone `server.js`); `pnpm --filter admin test:smoke` 4/4 against `next start -p 3002` (two routes, `ar` and `en`; Arabic screenshot reviewed: right-aligned, `dir=rtl`); web smoke 6/6 against `next start -p 3001` after dropping `/platform`; `GET /platform` on the web 404 (and on admin 404); i18n Vitest 8/8 (parity included); `pnpm turbo run typecheck lint test` for admin, web, i18n 12/12 tasks; admin `test:architecture` 18 modules clean; `pnpm install --frozen-lockfile` and `--lockfile-only` leave the lock unchanged; `pnpm audit --audit-level moderate` exit 0 | Lockfile importer `apps/admin` written as a copy of `apps/web`'s (identical specifiers): a plain `pnpm install` re-resolved and refused tslib 2.9.1 under `minimumReleaseAge` (§8.2); base `.dependency-cruiser.cjs` (server-side access, environment, unresolvable) lands here so `test` runs; the contracts surface rules are item E |
| B | f49ba45 | Config Vitest 87/87 (3 new in `define-config.test.ts`: valid URL → `config.app.publicAdminUrl`; `ftp://…` named `PUBLIC_ADMIN_URL: is invalid: expected an http(s) URL`, value not echoed; unset in staging accepted, unset in production `is required when APP_ENV=production`; plus `refuses production without PUBLIC_ADMIN_URL` from the `it.each` over `requiredInProduction('api')`). Red run with `src/server.ts` and `src/refusals.ts` reverted: 4 failed (the three new tests and `env-example.test.ts` "lists nothing the package does not read"), 82 passed; restored 87/87. `pnpm turbo run typecheck lint test --filter=@eeasy-logistics/config` 3/3 | "Required in production" applies to the `api` and `worker` roles (added to `requiredForRuntime` beside `PUBLIC_WEB_URL`), not to `migrate`; README "Configuration" production bullet names the admin URL |
| C | ea49685 | Dockerfile stages replayed by hand (no Docker locally): build context = the 343 tracked and untracked files filtered by the root `.dockerignore` (rsync rules, then `.claude/`, `.serena/`, `adr/` removed) → 252 files, `docs/` reduced to the 14 `docs/contracts/` files and `docs/architecture/domain-model.md`, no `.env*`; in that copy `pnpm install --frozen-lockfile --filter "@eeasy-logistics/admin..."` exit 0 and `pnpm --filter "@eeasy-logistics/admin..." run build` exit 0 (contracts generated, then `next build`: `/`, `/sign-in`, `/sign-in/totp`); runtime layout as the image (`.next/standalone` at the root, `.next/static` beside `apps/admin/server.js`), `node apps/admin/server.js` with `NODE_ENV=production`: `GET /` 200 (`<html lang="ar" dir="rtl">`), `GET /sign-in` 200, a `/_next/static` chunk 200. Scratch removed. CI's `image (admin)` dry run is the proof of the image itself | `.dockerignore` unchanged: the admin build reads nothing it excludes. The Next.js cache mount id is `next-cache-admin`, not the web's `next-cache`, so a builder that builds both images never mixes their caches |
| D | 24e69a6 | `actionlint` on `pr.yml` and `main.yml` clean; Prettier clean on README and workflows. CI evidence (the PR's Actions run: `admin-build-census` green with both screenshots, `image (admin)` built, probed and scanned): recorded in §8.0 "D (CI)" below once the run finished | `admin-build-census` builds and starts the API as decided, though the scaffold calls no API; own Next.js cache key prefix `next-admin-`; the `main.yml` probe step is shared by web and admin (`if: matrix.app == 'web' \|\| matrix.app == 'admin'`), its name now `Probe the <app> image (GET /)`; README also gains `apps/admin` in the layout table, `pnpm --filter admin dev` and `apps/admin/.env.local` |
| D (CI) | 24e69a6 | PR #45 Actions, pr.yml run 41291657186 and main.yml run 41291657225 on the merge ref of 24e69a6: `admin-build-census` pass (Playwright 4 passed; artifact `admin-build-census` with 6 files: the 4 screenshots, `api.log`, `admin.log`); `image (admin)` pass (built, `image user: 1000:1000`, `Probe the admin image (GET /)` → `GET / 200`, Trivy scan critical-fixable and report both success, dry run, nothing pushed); unchanged check names all pass: `typecheck-lint`, `api-test`, `api-test-rls`, `web-build-census` (web smoke 6 passed), `driver-test`, `gitleaks`, `image (api)`, `image (web)`, plus advisory `node-24` and `pnpm-audit` | Evidence row for item D (CI runs after the push, so it cannot sit in D's own commit) |
| E | this commit | `apps/admin` architecture test with the planted imports: `src/planted.ts` importing `/staff` → `admin-contracts-surfaces` error, exit 1; importing `/platform/mocks` → `admin-contracts-mocks-in-tests-only` error, exit 1; `src` importing `/platform` plus `tests/planted.ts` importing `/platform/mocks` → no violation, exit 0; `tests/planted.ts` importing `/staff/mocks` → `admin-contracts-surfaces` error, exit 1; plants removed → 21 modules clean, exit 0. Web rule unchanged and still red on a planted `apps/web/src` import of `/platform` (`web-contracts-surfaces`, exit 1). From a clean tree (`packages/contracts/generated`, `apps/{web,admin}/.next` removed) `pnpm turbo run typecheck lint test build --force` 32/32 tasks; `pnpm format:check` clean; after that build admin smoke 4/4 and web smoke 6/6 again, web `GET /platform` 404 | Mocks rule mirrors the driver's: `from.pathNot` `tests/`, so `test:architecture` cruises `src`, `tests` and `next.config.ts` (the web cruises `src` and `next.config.ts`); `src/contracts.ts` imports `Permission` from `/unions`, the same pattern as the web's |

### 8.1 Skills, documents and versions consulted

- Skills (2026-11-01, Vercel plugin 0.50.0): `vercel:knowledge-update` (documentation dated 2026-09-18) and `vercel:nextjs` (self-hosting with `output: 'standalone'`, `proxy.ts` in place of `middleware.ts` on 16, async `cookies()`). Context7 not needed: every Next.js detail used is already in `apps/web` on 16.4.3.
- ADRs: 0038 "Decision", 0032 "Decision" bullet 1, 0016, 0033 "Decision". Architecture: web.md §1, §1.1, §1.2, §5; platform.md §2, §4, §8. Handbook 01 "Context", 03 "Census" row and A-17 rule, 04 "Orders and plan files". Plans: PLAT-1 2.8, PLAT-3 2.4 and 2.8, PLAT-15 item E and §8.2.
- Code: all of `apps/web`, `apps/driver/.dependency-cruiser.cjs`, `dependency-cruiser.shared.cjs`, `packages/config/src/{server,refusals,web}.ts` and tests, `packages/i18n` catalogues and tests, `.github/workflows/{pr,main}.yml`, `.dockerignore`, README "CI" and "Development", `.serena/memories/{core,web/core,memory_upkeep,suggested_commands,task_completion,tech_stack,conventions}`.
- Pins: no new version; `apps/admin` pins exactly what `apps/web` pins (Next.js 16.4.3, React 19.3.0, TanStack Query 5.105.0, Playwright 1.64.1, dependency-cruiser 18.7.0, ESLint 9.39.5, TypeScript 6.0.3). `pnpm audit --audit-level moderate` exit 0 after the lockfile change.

### 8.2 Interpretations the lead should check

1. **Lockfile written by hand for the new importer.** A plain `pnpm install` with the new workspace re-resolved `next`'s tree and refused tslib 2.9.1 (published 2026-10-30) under `minimumReleaseAge: 4320`, though 2.9.1 is already in the lock. The `apps/admin` importer block is a copy of `apps/web`'s (identical specifiers and resolved versions); `pnpm install --frozen-lockfile` accepts it and `pnpm install --lockfile-only` leaves it byte-identical, so the lock is what pnpm itself would write. No `minimumReleaseAgeExclude` entry was added. CI's frozen installs and the `image (admin)` filtered install accept it too.
2. **The base `.dependency-cruiser.cjs` lands in item A** (server-side data access, environment, unresolvable), so `pnpm --filter admin test` runs from the first commit; item E adds the two contracts rules and `src/contracts.ts` as 2.9 lists.
3. **`/sign-in/totp` renders the same `placeholder.admin_sign_in` text** as `/sign-in`: decision 2.3 names only two keys. The smoke spec covers `/` and `/sign-in` (2.10); `/sign-in/totp` was checked with `curl` (200) only.
4. **`PUBLIC_ADMIN_URL` required in production for the `api` and `worker` roles** (beside `PUBLIC_WEB_URL` in `requiredForRuntime`), not for `migrate`. This makes every production API deployment fail to start without it from this merge on; there is no production deployment yet.
5. **`admin-build-census` builds and starts the API** as 2.8 says, although the scaffold calls no API; it costs about a minute and keeps the lane ready for WEB-2. Its Next.js cache key prefix is `next-admin-`, so it never restores the web's cache.
6. **The image's Next.js cache mount id is `next-cache-admin`** (the web's is `next-cache`): BuildKit shares a cache mount by id across builds, so one builder building both images would otherwise mix the two apps' caches.
7. **README edits beyond the "CI" section:** the "Development" table gains `apps/admin` (the `apps/web` row loses "platform"), the commands line gains `pnpm --filter admin dev`, the `.env.local` sentence names `apps/admin/.env.local`, and the "Configuration" production bullet names the admin URL. `.gitignore` comment names `apps/admin` (the `test-results/` pattern already covered it).
8. **`.dockerignore` unchanged**: the replayed context build (§8.0 C) read nothing it excludes.
9. The `apps/web` `(platform)` deletion leaves `docs/architecture/web.md` §1.1, which still shows `platform/sign-in/` under the web's `(auth)` group, untouched: architecture documents are outside this order's paths. The lead may want a one-line amendment.

### 8.3 Not done here

- Docker is not available locally: the image was proven by the PR's `image (admin)` job (built, non-root check, `GET /` probe, Trivy), not on this machine (§8.0 C replays the stages by hand).
- Not built, per §2.11 and §6: `proxy.ts`, CSP, sessions and TOTP, platform screens, the per-host edge 404, Compose and native-stack entries for the web apps.
- Branch protection: the README command now lists `admin-build-census`; applying it needs an admin and a paid plan (README "CI").

## 9. Lead review and adversary

Adversary: not required (roadmap). Lead review rulings are recorded here after `/code-review`.
