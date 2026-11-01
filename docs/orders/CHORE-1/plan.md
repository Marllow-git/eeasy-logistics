# CHORE-1 · Runtime and build chores: Node 24, drop dotenv, SWC builder

- **Status:** planned
- **Date:** 2026-11-01
- **Wave:** 0. **Depends on:** PLAT-6 (merged, PR #41). **Blocks:** PLAT-7 by agreement between the two lead sessions (it is briefed when all three legs land).
- **Lead:** architecture lead (session `eeasy-logistics-6e`). **Executor:** `executor-api` (Opus), own worktree, native stack database `elx_chore1` (scratch databases through the PLAT-5 harness). **Adversary:** no (no auth, tenancy, ledger, payment or private-data path).
- **Issue:** #49. **Merge danger:** two-way door for every leg (a revert undoes it).
- **Legs:** three, **one PR each**, stacked: leg 1 on `chore/node-24` (from `main`), leg 2 on `chore/drop-dotenv` (from `chore/node-24`, PR base `chore/node-24`), leg 3 on `chore/nest-swc` (from `chore/drop-dotenv`, PR base `chore/drop-dotenv`). GitHub retargets each base to `main` when the one below merges and its branch is deleted. One executor run builds all three.
- **Stack:** native (`tools/native-stack.sh`), database `elx_chore1`.

## 0. Goal

Three small changes the 2026-11-01 dependency review queued for the first window after PLAT-6, because each touches `apps/api`, `packages/config` or `packages/db` and every later wave 0 API order holds those paths again: the runtime moves to Node 24 LTS (roadmap A-14), `packages/config` stops depending on `dotenv`, and `nest build` compiles with SWC.

## 1. Binding rules and ADRs

- `AGENTS.md` "Hard rules" (configuration only through `packages/config`; secrets never in code) and "Sizing a change".
- `docs/roadmap.md` §5 row A-14 (Node 24 before wave 1 exit).
- `docs/architecture/platform.md` §2 (runtime and images) and §4 (CI lanes).
- `README.md` "Requirements" and the CI table row `node-24`.
- `.github/workflows/pr.yml` job `node-24`; `.github/actions/setup/action.yml`; `.github/dependabot.yml` (the `@types/node` major ignore).
- `packages/config/src/node.ts` (the only `dotenv` user) and `packages/config/test/env-example.test.ts`.
- `apps/api/nest-cli.json`, `apps/api/package.json` `build`, `apps/api/Dockerfile`.
- ADR-0003 (one monorepo), ADR-0022 (containers on a Gulf host: images are what ships).
- PLAT-6 facts from its lead (2026-11-01): the API routes case-sensitively and strictly (`/health/` is 404; probes use the exact path), and the API image builds `packages/contracts` in its build stage and copies `generated/` into the runtime stage. A Dockerfile change must keep both.
- `pnpm-workspace.yaml`: `minimumReleaseAge: 4320` (three days) and `trustPolicy: no-downgrade` apply to every version you pin.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Node version | Latest Node 24 LTS patch at build time (24.22.2 on 2026-11-01), recorded in §8.1. `.nvmrc` holds the major (`24`) as today's file holds `22`; `engines.node` becomes `>=24.11.0 <25` (24.11 is the first 24 LTS release; adjust if §8.1 shows otherwise). |
| 2.2 | Images | `NODE_IMAGE` in `apps/api`, `apps/web` and `apps/admin` Dockerfiles becomes `node:<2.1 version>-alpine@sha256:<digest>`. Resolve the digest from the Docker Hub registry API (no container runtime on this machine), the multi-arch index digest, as the current pins are. Nothing else in the Dockerfiles changes. |
| 2.3 | Types | `@types/node` moves to the latest `24.x` in every workspace that pins it (exact pin, as today). The Dependabot ignore for `@types/node` majors stays (it now holds 24). |
| 2.4 | CI | The default lanes already read `.nvmrc`, so they move with it. The advisory `node-24` job in `pr.yml` is removed, with its README row; no Node 22 lane is kept. |
| 2.5 | Local verification on Node 24 | The machine runs Node 22. Use an existing version manager (`fnm`, `nvm`, `volta`, `mise`) if present; otherwise `brew install node@24` (keg-only, not linked) and put its `bin` first on `PATH` for your commands only. Do not change the system default. Record which in §8.1. |
| 2.6 | `dotenv` replacement | `util.parseEnv` from `node:util`. Before replacing, compare `dotenv.parse` and `util.parseEnv` on `.env.example` and on the test fixtures (quotes, `#` comments, empty values, `export` prefix, multi-line values, `=` inside values). If any input our files or tests use parses differently, keep `dotenv`, record the difference in §8.3, and close leg 2 without a code change. Check the Node 24 stability index of `util.parseEnv` and record it in §8.1; if it is below "Stable" and emits a warning at runtime, the same stop rule applies. |
| 2.7 | SWC | `apps/api/nest-cli.json` `compilerOptions.builder: "swc"` with `typeCheck: false` (`tsc --noEmit` stays the type check in `typecheck`). Pin `@swc/cli` and `@swc/core` exactly (latest stable older than three days). Keep decorator metadata: Nest's DI needs `emitDecoratorMetadata`-equivalent output (`.swcrc` `legacyDecorator` and `decoratorMetadata`, or what the Nest 12 SWC docs say), and ESM output for `"type": "module"`. Record the `.swcrc` or the Nest default you rely on in §8.2. `@swc/core` ships its binary through optional dependencies: add it to `ignoredBuiltDependencies` in `pnpm-workspace.yaml`, not to `onlyBuiltDependencies`. |
| 2.8 | SWC stop rule | If the SWC build breaks DI, ESM resolution, a test or the image, and the Nest 12 docs give no supported fix, record it in §8.3 and close leg 3 without the change. |

## 3. Build list

### Leg 1 · `chore/node-24` (PR 1)

| Item | Delivers | Verify |
|---|---|---|
| A | `.nvmrc`, root `engines.node`, `@types/node` 24 in every workspace per 2.1 and 2.3; lockfile | on Node 24 per 2.5: `pnpm install --frozen-lockfile` after the lockfile update; `pnpm turbo run typecheck lint test` green with counts; `pnpm audit --audit-level moderate` exit 0 |
| B | The three Dockerfiles per 2.2 | `hadolint` if installed, else a manual read; CI `image (api)`, `image (web)`, `image (admin)` green on the PR |
| C | CI per 2.4: `node-24` job and README row removed; `docs/architecture/platform.md` §2 and `README.md` "Requirements" say Node 24; roadmap A-14 status `done <date> (CHORE-1)`; memories (`tech_stack`, `suggested_commands` if a command changed) | `actionlint` clean; API integration on Node 24 with `ELX_RLS=off` and `on` against the native stack, counts recorded; the API boots (`node dist/main.js`) and answers `GET /health` with 200 |

### Leg 2 · `chore/drop-dotenv` (PR 2)

| Item | Delivers | Verify |
|---|---|---|
| D | Comparison per 2.6 recorded in §8.2 (a short table: input, `dotenv.parse`, `util.parseEnv`); then `packages/config/src/node.ts` on `util.parseEnv`, `dotenv` removed from `packages/config/package.json`; a unit test that pins the parsing of the cases in 2.6 that our files use | red then green: the new test fails against a deliberately broken parse, passes with `util.parseEnv`; `pnpm --filter @eeasy-logistics/config test` with counts; full `pnpm turbo run typecheck lint test` green |

### Leg 3 · `chore/nest-swc` (PR 3)

| Item | Delivers | Verify |
|---|---|---|
| E | SWC per 2.7; memories (`suggested_commands` or `api/core` if the build command or a quirk changed) | `nest build` time before and after (three runs each, median) in §8.0; `pnpm --filter @eeasy-logistics/api run test:unit` and integration with `ELX_RLS=off` and `on` green with counts; the built API boots and answers `GET /health` 200 and one authenticated route through the PLAT-6 test signer, proving DI and guards resolve; CI `image (api)` green |

## 4. Commit plan

One commit per item, `CHORE-1: <letter>, <what>`, each with its §8.0 row. The plan file and the ledger row are the first commit on `chore/node-24` (lead). Leg 2 branches from the tip of leg 1 and leg 3 from the tip of leg 2. Each leg ends with a **draft** PR from `.github/pull_request_template.md`, its base the branch below, the body naming its leg and saying "Release note: none (technical PR)" and listing the memories changed or "Memories: unchanged".

## 5. Exit criteria

- Three draft PRs, each green on CI, each with the template filled and exact counts.
- Node 24 everywhere the runtime is pinned (`.nvmrc`, `engines`, images, `@types/node`); no `node:22` image left; no `node-24` advisory job.
- `dotenv` gone from the lockfile's direct dependencies of `packages/config`, or §8.3 says why it stays.
- `nest build` on SWC with the API booting and DI working, or §8.3 says why it does not.

## 6. Not in this order

ESLint 10, TypeScript 7 (owner rulings 2026-11-01: hold), Fastify (stay on Express), any Expo or React bump, any change to `packages/contracts` generation.

## 7. Owner questions

None open. Rulings relied on: Node 24 move (A-14, owner OK 2026-11-01 in the dependency review); stay on ESLint 9 and Express (2026-11-01).

## 8. Executor notes (filled by the executor)

### 8.0 Progress

| Item | Commit | Tests (counts) | Interpretation |
|---|---|---|---|
| A | 72f47ac | On Node 24.22.2 (Homebrew `node@24`, keg-only, first on `PATH`): `pnpm install --frozen-lockfile` clean; `pnpm turbo run typecheck lint test` 29/29 tasks green (config 90 tests in 7 files, contracts 55/6, api 140/15 plus depcruise, db 10/2, i18n 11/2, driver Jest 4 tests in 3 suites, web, admin and ui depcruise green); `pnpm audit --audit-level moderate` exit 0 (summary: 1 low, 6 moderate, 4 ignored by `auditConfig`) | `.nvmrc` `24`, `engines.node` `>=24.11.0 <25`, `@types/node` `24.19.2` in the seven workspaces that pin it (driver pins none). Lockfile diff: only `@types/node` 22.20.5 → 24.19.2 (and the peer suffixes naming it) and `undici-types` 6.21.0 → 7.24.6. How the lockfile was resolved: §8.2 item 1 |
| B | cba09c3 | `hadolint --failure-threshold warning` on the three Dockerfiles exit 0 (two `info` DL3059 on api lines 28 and 31, unchanged lines, already on `main`); manual read: only `ARG NODE_IMAGE` changed, the contracts build step and the `generated/` copy into the api runtime stage are untouched; `node --test tools/whatsapp-stub/server.test.mjs` on Node 24: 8 tests, 8 pass; CI `image (api)`, `image (web)`, `image (admin)`: see the PR checks | `NODE_IMAGE` = `node:24.22.2-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85` (OCI index digest from `registry-1.docker.io`, same method as the 22 pin, whose index digest the same call returns). Also `compose.yaml` `x-whatsapp-stub` image and its README image-table row to `node:24.22.2-alpine` (§8.2 item 2) |
| C | 49056f0 | `actionlint` exit 0; `pnpm format:check` clean; on Node 24.22.2 against the native stack (owner's PostgreSQL 17 on 5432, Redis on 6379, scratch MinIO on 9000): `APP_ENV=local DATABASE_URL_ADMIN=postgres://$(id -un)@127.0.0.1:5432/postgres ELX_RLS=off pnpm --filter @eeasy-logistics/api run test:integration` 97 tests in 15 files passed, the same with `ELX_RLS=on` 97/15 passed, scratch databases dropped; `elx_chore1` created as the harness does (owner `elx_owner`, `postgis`, `citext`, `pgcrypto`), `pnpm --filter @eeasy-logistics/api run migrate` (builds, then applies 6 migrations, at `0005_core_idempotency_keys`), `node dist/main.js` on Node 24: `GET /health` 200 `{"status":"ok"}`, `GET /health/` 404 (strict routing kept), `GET /ready` 200; server stopped | Removed the advisory `node-24` job from `pr.yml` and its README row and mention; README "Requirements" and the native-stack line say Node 24; platform §2 gains one sentence on the Node 24 images (§8.2 item 3); roadmap A-14 `done 2026-11-01 (CHORE-1)`; memories `tech_stack` (Node pins) and `suggested_commands` (Node 24 on this Mac, scratch MinIO when `up` refuses). The setup action's `node-version` input is now unused and kept (§8.2 item 4) |
| D | 2ac9bb3 | Red then green on `packages/config/test/node.test.ts` (new case "parses comments, empty values and `=` inside values as dotenv did"): with `dotenv.parse` still in `node.ts` 11/11 (parity), with a deliberately broken parse (split each line on `=`, no comment handling) 1 failed / 10 passed, with `util.parseEnv` 11/11 (the parity run used a higher-entropy padded value for `AUTH_SIGNING_KEY`, which the gitleaks pre-commit hook flagged; the committed fixture uses `A…A==`, and red and green were re-run with it: 1 failed / 10 passed, then 11/11); `pnpm --filter @eeasy-logistics/config test` 91 tests in 7 files plus depcruise (30 modules) green; full `pnpm turbo run typecheck lint test` 29/29 tasks; `pnpm audit --audit-level moderate` exit 0; `pnpm format:check` clean; `pnpm install --frozen-lockfile` clean; extra: API integration `ELX_RLS=off` 97/97 in 15 files (the harness reads `.env` through `readEnvironment`) | Comparison table and the key-order finding: §8.2 item 5. `node.ts` reads the file as UTF-8 text and calls `parseEnv`; `env-example.test.ts` parses with `parseEnv` and compares the undeclared names as sorted lists; `dotenv` leaves `packages/config/package.json` and the lockfile (it had no other user). Memory `tech_stack` (Config line) |
| E | c2bf721 | `nest build` wall time on Node 24, three runs each: tsc 1.79 s, 1.49 s, 1.48 s (median **1.49 s**); SWC 1.04 s, 0.35 s, 0.35 s (median **0.35 s**; swc itself reports about 50 ms for 54 files). Same 54 `.js` files and 54 source maps; ESM (no `require(`/`exports.`); `design:paramtypes` 12 in both. `pnpm --filter @eeasy-logistics/api run test:unit` 140 tests in 15 files; integration (`APP_ENV=local DATABASE_URL_ADMIN=postgres://$(id -un)@127.0.0.1:5432/postgres ELX_RLS=off|on pnpm --filter @eeasy-logistics/api run test:integration`) 97/97 in 15 files with `off` and 97/97 with `on`; the SWC-built API on `elx_chore1`: `node dist/main.js` `GET /health` 200, `GET /health/` 404, `GET /ready` 200; an authenticated probe on the SWC-built `AppModule` with the PLAT-6 test signer (`test/support/access-tokens.ts`): no token 401 `unauthenticated`, token under another key 401, signed driver token 200 with the token's `acc` and `dev` from `getContext()` (4/4); `--role worker` with only `APP_ENV=ci` starts and exits 0 as the image probe expects; `nest start --watch` (the `dev` script) compiles with SWC and answers `/health` 200, then stopped; full `pnpm turbo run typecheck lint test` 29/29; `pnpm audit --audit-level moderate` exit 0 (same summary as `main`); `pnpm install --frozen-lockfile` clean; CI `image (api)`: see the PR checks | `nest-cli.json` `builder: "swc"`, `typeCheck: false`; `@swc/cli` 0.8.2 (2026-10-28) and `@swc/core` 1.16.20 (2026-10-22; 1.16.21 is from 2026-10-31, under three days) pinned exactly in `apps/api` devDependencies; `@swc/core` in `ignoredBuiltDependencies`. No `.swcrc`: §8.2 item 6. Lockfile: §8.2 item 7. Probe design: §8.2 item 8. Memories `tech_stack`, `api/core` (build), `suggested_commands` (lockfile trap) |
| CI | (evidence, after each push) | PR #52 (leg 1, head 7f36f62): all 11 checks green, `pr.yml` run 41297931033, `main.yml` run 41297930803 (`image (api)`, `image (web)`, `image (admin)` built on Node 24, probed and scanned). PR #53 (leg 2, head acbfe39): 11/11 green, runs 41298364251 and 41298364257. PR #54 (leg 3, head df035a0): `api-test` failed once on the flaky PLAT-6 assertion in §8.3, green on re-run; then 11/11 green, runs 41298978848 and 41298978925 (`image (api)` built with SWC on Alpine) | Evidence row; the CI runs come after each push, so the row sits on the leg 3 branch |

### 8.1 Skills and documents consulted

Leg 1, all on 2026-11-01:

- **Node version (2.1).** `https://nodejs.org/dist/index.json`: latest 24 LTS ("Krypton") is **24.22.2**, released 2026-10-27 (five days old); the first 24 LTS release is 24.11.0 (2025-10-28), so `engines.node` `>=24.11.0 <25` stands as planned.
- **Local Node 24 (2.5).** No version manager on this machine (`fnm`, `nvm`, `volta`, `mise` absent). `brew install node@24` (24.22.2, keg-only, not linked); every command ran with `PATH=/opt/homebrew/opt/node@24/bin:$PATH`; the system default stays Node 22.23.4.
- **Image digest (2.2).** Docker Hub registry API (`auth.docker.io` token, `HEAD registry-1.docker.io/v2/library/node/manifests/24.22.2-alpine` with the OCI index and manifest-list `Accept` types): `docker-content-digest` `sha256:8a32c8cf…542f85`, `application/vnd.oci.image.index.v1+json`; the Hub tag API gives the same digest, last pushed 2026-10-28T23:40Z. The same call on `22.23.4-alpine` returns the existing pin's digest, so the method matches.
- **Types (2.3).** npm registry: `@types/node` latest 24.x is **24.19.2** (2026-10-09); it requires `undici-types >=7.24.0 <7.24.7`, resolved to 7.24.6 (2026-03-25).
- **Context7.** Node.js v24 API docs (`/websites/nodejs_latest-v24_x_api`): `util.parseEnv` history ("v24.10.0: no longer experimental") and the env-file format (read for leg 2; recorded here because it was fetched now).
- **Tools.** pnpm 10.34.9, hadolint (Homebrew), actionlint (Homebrew), PostgreSQL 17 (Homebrew, owner's server on 5432), Redis on 6379 (owner's, reused, not stopped), MinIO (Homebrew) from `/tmp/chore1-minio` on 9000 (stopped at the end of the run, after leg 3).
- **Leg 2 (2026-11-01).** Node v24 API docs via Context7 (`/websites/nodejs_latest-v24_x_api`: `util.parseEnv`, env-file format) and the page `https://nodejs.org/docs/latest-v24.x/api/util.html` (`util.parseEnv` section: no stability label, history "v24.10.0: This API is no longer experimental"). dotenv 18.0.9 (the version removed) as the comparison baseline. Documents: plan §1 `packages/config/src/node.ts`, `packages/config/test/env-example.test.ts`, and `node.test.ts` (its fixtures are inputs 2.6 names).
- **Leg 3 (2026-11-01).** Context7 NestJS docs (`/nestjs/docs.nestjs.com`, `content/recipes/swc.md` and `content/cli/workspaces.md`: `builder: "swc"`, `typeCheck`, `.swcrc` with `legacyDecorator` and `decoratorMetadata`, `swcrcPath`, `@swc/cli` and `@swc/core` installation, the `WrapperType` note for ESM circular imports). The installed Nest CLI 12.0.11 source `lib/compiler/defaults/swc-defaults.js` (the defaults in §8.2 item 6) and its peer ranges (`@swc/cli ^0.8.0`, `@swc/core ^1.15.18`). npm registry: `@swc/core` 1.16.20 (2026-10-22) and 1.16.21 (2026-10-31, too young), `@swc/cli` 0.8.2 (2026-10-28); `@swc/core` `postinstall.js` (checks the native binary, falls back to `npm install @swc/wasm`). Documents: plan §1 `apps/api/nest-cli.json`, `apps/api/package.json` `build`, `apps/api/Dockerfile`; `test/support/access-tokens.ts` and `test/integration/tenancy.http.test.ts` (how the PLAT-6 tests sign and mount a probe).
- **Documents.** Plan §1 only: AGENTS.md "Hard rules" and "Sizing a change"; roadmap §5 row A-14; platform §2 and §4; README "Requirements", "Without Docker: the native stack" (for the Node mention), the image table and "CI"; `pr.yml` job `node-24`; `.github/actions/setup/action.yml`; `.github/dependabot.yml` ignore block; the three Dockerfiles; memories `memory_upkeep`, `tech_stack`, `suggested_commands`, `api/core`; PLAT-5 and PLAT-6 plan §8 lines on how they ran the native stack.

### 8.2 Interpretations the lead should check

1. **Lockfile resolution under the supply-chain gates (item A).** `main`'s lockfile cannot be re-resolved today under its own gates: any manifest change makes pnpm 10.34.9 re-resolve large subtrees (every package with an `@types/node` peer), and it then refuses versions `main` already locks: `tslib@2.9.1` (published 2026-10-30, under `minimumReleaseAge`), `@expo/log-box@58.0.14` (a driver direct dependency, published 2026-10-31) and `semver@6.3.1` (`ERR_PNPM_TRUST_DOWNGRADE`, via `@react-native/jest-preset` → `babel-jest`). Frozen installs (CI) do not re-check them. I resolved once with `minimumReleaseAge: 0` and `trustPolicy: off` set in a local copy of `pnpm-workspace.yaml`, restored the file byte for byte before anything was staged, and accepted the result only after checking the diff: the only versions it adds are `@types/node@24.19.2` (2026-10-09, same publisher as 22.20.5) and `undici-types@7.24.6` (2026-03-25, with SLSA provenance), both older than three days; every other locked version is unchanged. `pnpm install --frozen-lockfile` then passes with the real gates. The next order that changes a manifest before 2026-11-03 meets the same wall (the trust downgrade on `semver@6.3.1` does not age out); a `trustPolicyExclude` entry for it is the lead's call, not this order's. The `suggested_commands` memory already records this trap and its recipe; I followed it, setting the two values in a local copy of the file because pnpm ignored `--config.minimum-release-age-exclude` on the command line.
2. **`compose.yaml` WhatsApp stub image (item B).** Plan 2.2 names the three Dockerfiles; §5 says "no `node:22` image left". The Compose stub service ran `node:22.23.4-alpine`, so it moves to `node:24.22.2-alpine`, pinned by tag as before (Compose pins no digests; changing that is not this order's). Its README row says "same major as `.nvmrc`", which this keeps true.
3. **Platform §2 (item C).** The section's table names no Node version, so "say Node 24" became one sentence under it (images on Node 24 LTS Alpine by digest, major from `.nvmrc`, amendment marker A-14/CHORE-1) rather than a new column.
4. **Setup action input (item C).** `.github/actions/setup` keeps its optional `node-version` input although no job passes it after the `node-24` job goes: plan 2.4 does not ask for a change to the shared action, and the empty default (read `.nvmrc`) is what every job uses. The lead may drop it in a later chore.
5. **dotenv versus `util.parseEnv` (item D, plan 2.6), and why the stop rule did not fire.** Run on Node 24.22.2 against dotenv 18.0.9 with `/tmp` script `compare-parse.mjs`: `.env.example` 56 keys, 0 values differ; the three `node.test.ts` fixtures, 0 differ. Edge cases (`.env.example` uses only full-line `#` comments (115 lines), empty values (19) and plain unquoted values; its instructions produce base64 keys with `=` padding):

   | Input | `dotenv.parse` | `util.parseEnv` | Same |
   |---|---|---|---|
   | `K="a b"`, `K='a b'`, `` K=`a b` `` | `a b` | `a b` | yes |
   | `K="a\nb"` (escape in double quotes) | newline | newline | yes |
   | `K='a\nb'` | literal `\n` | literal `\n` | yes |
   | `# comment` line, `K=v # comment`, `K="v" # comment` | comment dropped | comment dropped | yes |
   | `K="a#b"` / `K=a#b` | `a#b` / `a` | `a#b` / `a` | yes |
   | `K=`, `K=""` | empty string | empty string | yes |
   | `export K=v` | `v` | `v` | yes |
   | `K="line1⏎line2"`, single-quoted too | two lines | two lines | yes |
   | `K=…?sslmode=require&a=b`, `K=YWJj==`, `K=k1:…=,k2:…=` | whole value | whole value | yes |
   | `K = v`, `K=v   `, CRLF endings, duplicate key (last wins), a line without `=` | same | same | yes |
   | `K: v` (colon separator) | `v` | key absent | **no** |

   The one value difference (`K: v`) is a form no file or test of ours uses. `util.parseEnv` carries no stability label of its own in the Node 24 docs (history: "v24.10.0: no longer experimental"; the `util` module is Stability 2, Stable) and emits no warning at run time on 24.22.2; the engines floor 24.11.0 is past 24.10. **One difference that is not a value:** `util.parseEnv` returns its keys in name order, dotenv in file order. Nothing reads the order at run time (`readEnvironment` spreads the result into an object that `defineConfig` reads by name), but the existing `.env.example` test compared the undeclared names as an ordered list and failed (1 of 90) after the swap. I read 2.6's "parses differently" as the values our inputs yield, the six properties it lists, so the stop rule did not fire, and changed that assertion to compare sorted lists: the same exact membership, no longer the file's order. **Lead, check this first:** if order counts as "parses differently", close PR 2 per 2.6 and rebase leg 3 onto leg 1 (leg 3 touches neither `packages/config` nor `dotenv`; only the lockfile would need re-resolving).
6. **SWC options (item E, plan 2.7).** I rely on the Nest CLI 12.0.11 SWC defaults (`lib/compiler/defaults/swc-defaults.js`), with no `.swcrc`: `module.type: "es6"` with `resolveFully` (chosen because `apps/api` is `"type": "module"` and `tsconfig` `module` is `NodeNext`), `jsc.transform.legacyDecorator: true`, `decoratorMetadata: true`, `useDefineForClassFields: false`, `keepClassNames: true`, `target: "es2021"`, `keepImportAttributes`, source maps from `tsconfig.build.json`, `.test.ts` excluded through its `exclude`. These are the Nest 12 SWC recipe's settings, so a `.swcrc` would only restate them. Two output differences from tsc, both checked: (a) `useDefineForClassFields` was effectively `true` under tsc (target ES2023); SWC's `false` is what Nest documents, and no class in `src` relies on define semantics (unit, integration and the boot probe pass); (b) SWC also emits `design:type` metadata on decorated methods (12 against tsc's 2), which Nest ignores. Helpers are inlined, so the runtime image needs no `@swc/helpers`.
7. **Lockfile for leg 3.** Resolved as in item 1 (gates relaxed in a local copy, file restored byte for byte), which keeps every `main` lock. The only removal is `@nestjs/cli`'s old peer-suffixed key (now naming `@swc/cli` and `@swc/core`); 117 versions are added, all under `@swc/cli` and `@swc/core`. I checked each added version against the registry with a script: one, `http2-wrapper@2.2.2` (under `@swc/cli` → `@xhmikosr/bin-wrapper` → `got`), was 0.45 days old, so I pinned it back by hand to `2.2.1` (same dependencies and engines, its `dist.integrity`), which is what pnpm picks with the gates on; after that, 117 of 117 are older than three days and none has weaker trust evidence than an earlier release (provenance or trusted publisher). Resolving with the gates on plus targeted excludes for `main`'s too-young locks was tried first and rejected: it re-resolved `rolldown` 1.2.16 → 1.2.15 and added four `@babel` versions outside this order.
8. **Authenticated route (item E verify).** `src` has no authenticated route yet (only `/health` and `/ready`), so the probe mounts a plain-JavaScript controller (`v1/driver/chore1-probe`, decorators applied as functions, no constructor dependencies) on the SWC-built `AppModule.forRoot(config)` from `dist/`, composed as `main.ts` does (`createHttpAdapter`, `httpAppOptions`, `configureHttp`, `BootChecks`), and signs tokens with the PLAT-6 test signer through Node type stripping. Everything under test (global guards, unit-of-work interceptor, filters, their constructor injection) is SWC output; the probe file lived in `apps/api/dist/` during the run only.

### 8.3 Not done here

- No stop rule fired (2.6: §8.2 item 5; 2.8: SWC broke no DI, ESM resolution, test or local boot).
- Images were not built locally (no container runtime on this machine; plan 2.2): `image (api)`, `image (web)` and `image (admin)` on each PR are the evidence, including the api image building with SWC on Alpine (musl binary `@swc/core-linux-x64-musl`).
- **A flaky PLAT-6 assertion, not fixed here.** On PR 3's first CI run `api-test` (`ELX_RLS=off`) failed one test: `test/integration/cross-tenant.http.test.ts` line 225, "a platform handler without @CrossTenant() cannot read tenant rows", `expect(response.text).not.toContain('b-1')`. The response was the correct `500 internal_error` with no row in it; its server-minted `request_id` `01a196b9-d94e-7143-afcb-19e904733268` contains `b-1` (`…afcb-19e9…`). A random UUIDv7 does that in roughly 1 run in 100. The integration suite runs under Vitest, not `nest build`, so SWC cannot cause it; the failed job was re-run. The fix (assert on the parsed body or a label that is not hex-like) is a one-line test change for the lead to route to PLAT-6's owner or a follow-up; this order does not edit PLAT-6 tests.
- `admin` and `web` builds, Playwright censuses and the driver app were not run locally; nothing in this order reaches them beyond Node 24 itself, which their CI lanes run.

## 9. Lead review
