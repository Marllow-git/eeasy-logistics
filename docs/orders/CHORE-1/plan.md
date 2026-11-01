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

### 8.1 Skills and documents consulted

### 8.2 Interpretations the lead should check

### 8.3 Not done here

## 9. Lead review
