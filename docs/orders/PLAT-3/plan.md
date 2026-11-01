# PLAT-3 · CI lanes

- **Status:** planned (starts after PLAT-2 merges; rebase this branch onto main then)
- **Date:** 2026-10-31
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-1 (merged, PR #22), PLAT-2.
- **Lead:** architecture lead. **Executor:** Opus, own worktree. **Adversary:** no.
- **Context:** the owner's Mac has no Docker runtime and none is planned (ruling 2026-10-31: verify locally). Local verification uses the native Homebrew stack of PLAT-2 item H; CI is the only place the Compose profiles and the production-shaped stack run. This order is therefore on the critical path for every later order.

## 0. Goal

Every pull request runs the five required checks of the platform blueprint plus the RLS-enabled lane, on GitHub Actions, against the Compose `ci` profile, with Turborepo remote caching, so that "CI green on every check" (handbook 02) is real from the first feature order. Images are built, scanned and pushed on merge to `main`.

## 1. Binding rules and ADRs

- Platform blueprint §4 (the five checks: `typecheck-lint`, `api-test`, `web-build-census`, `driver-test`, `gitleaks`; images built once per merge, tagged with the commit, scanned, pushed), §1 (`ci` environment: ephemeral, fixtures only), amendment A-6 (RLS-enabled integration lane), platform §10.3 and register Q-12 default (GitHub Container Registry).
- Handbook 03 (testing lanes, isolated stacks), handbook 02 ("CI is green on every check").
- Data architecture §4.5 (the RLS lane runs the integration suite with RLS enabled from the first table), §11 (migrations applied from zero in CI; PLAT-5 supplies them, this order runs an empty migration step until then).
- PLAT-2 plan 2.2 (`ci` profile: random host ports, tmpfs) and 2.8 (the smoke workflow this order replaces).
- Web architecture §11 (Playwright census in `ar` and `en` on an isolated stack with screenshots as artifacts); driver app §12.1 (`driver-test` is typecheck and unit; Maestro is DRV-6's).

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Workflows | `.github/workflows/pr.yml` (pull requests: the six checks as separate jobs so each reports its own status), `.github/workflows/main.yml` (push to `main`: the same checks, then image build and push), `.github/workflows/compose-smoke.yml` removed (PLAT-2 2.8) |
| 2.2 | Runner and cache | `ubuntu-latest`; pnpm store cache; Turborepo remote cache through Vercel Remote Cache if a token exists as a secret, else the GitHub Actions cache adapter; Next.js build cache; never cache `node_modules` as a whole |
| 2.3 | `api-test` | `docker compose --profile ci up -d --wait`, then migrations from zero (`pnpm --filter api migrate` once PLAT-5 exists; a no-op script until then), then Vitest unit plus integration (integration suite is empty until PLAT-5), then the architecture test; a second job `api-test-rls` runs the same suite with `ELX_RLS=on` (A-6; data §4.5), both required |
| 2.4 | `web-build-census` | standalone build, start the `ci` profile and the API, run the Playwright census in `ar` and `en` (the census harness is WEB-1's; this order installs Playwright and runs one smoke spec per locale that asserts `lang` and `dir` on the four placeholder routes), upload screenshots as artifacts |
| 2.5 | `driver-test` | Expo typecheck, lint, Jest; `expo-doctor` |
| 2.6 | `typecheck-lint` | `pnpm turbo run typecheck lint` over every workspace, plus `pnpm format:check` and the contracts Redocly lint |
| 2.7 | `gitleaks` | the official action with the repository's `.gitleaks.toml`; plus a pre-commit hook via a `prepare` script that installs it (lefthook or simple-git-hooks; choose and record) |
| 2.8 | Images | `apps/api` (one image, roles `api`, `worker`, `migrate`) and `apps/web` (standalone) Dockerfiles with multi-stage builds, non-root user, `pnpm deploy --filter`; built with Buildx, cached, tagged `sha-<commit>` and `main`, scanned with Trivy (fail on critical), pushed to `ghcr.io/marllow-git/eeasy-logistics/<app>` on merge to `main` only; staging deploy is OPS-1's |
| 2.9 | Required checks | branch protection on `main` requiring the six PR jobs; set with `gh api` and recorded in the PR; the owner's merge habit does not change |
| 2.10 | Node version matrix | Node 22 for the required jobs; a non-required `node-24` job runs `typecheck lint test` to prepare amendment A-14 |
| 2.11 | Concurrency and timeouts | cancel in-progress runs per branch; 20-minute timeout per job; the census job 30 |

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | `pr.yml` with `typecheck-lint`, `driver-test`, `gitleaks` | the three jobs green on the PR |
| B | `api-test` and `api-test-rls` against the `ci` profile | both green; a planted failing test shown red, then removed |
| C | Playwright install and the two-locale smoke spec; `web-build-census` job with screenshot artifacts | green; artifacts contain `ar` and `en` screenshots |
| D | Dockerfiles for `api` and `web`, Buildx and Trivy in `main.yml`, GHCR push | a `main.yml` dry run on the PR (build and scan, no push) green; the push step gated on `main` |
| E | Pre-commit gitleaks hook and `.gitleaks.toml` | a planted fake secret blocked locally and in CI, then removed |
| F | Branch protection with the six required checks; `node-24` advisory job; remove `compose-smoke.yml`; README "CI" section | `gh api` shows the rules; README updated |

## 4. Commit plan

One commit per item, `PLAT-3: <item>`.

## 5. Exit criteria

- A pull request shows six required checks, all green, and the advisory `node-24` job.
- The RLS lane runs the integration suite with `ELX_RLS=on` and passes (empty suite until PLAT-5).
- Screenshot artifacts in `ar` and `en` are attached to the census job.
- A planted secret is blocked by the hook and by the `gitleaks` job (shown, then removed).
- `main.yml` builds, scans and pushes both images on merge; the images run (`/health` 200 from the api image; web serves `/`).
- Branch protection on `main` requires the six checks.

## 6. Not in this order

Staging deployment and the registry secret store (OPS-1), migrations and the seed template (PLAT-5), the real census harness (WEB-1), Maestro (DRV-6), EAS builds (DRV-1), production compose.

## 7. Owner questions

1. Turborepo remote cache: Vercel Remote Cache (needs a Vercel account token in repository secrets) or the GitHub Actions cache adapter (default until a token exists).
2. GHCR visibility for the images: private (default).

## 8. Rulings during the build

- 2026-10-31, Turborepo cache (2.2, owner question 1 default): no Vercel token exists, so the Turborepo local cache directory `.turbo/cache` is kept in the GitHub Actions cache by the first-party `actions/cache`, one scope per job, in the shared setup action `.github/actions/setup`. No third-party remote-cache server receives the Actions cache token. The pnpm store is cached by `actions/setup-node`; `node_modules` is never cached. Test runs against the `ci` stack are invoked directly, not through Turborepo, so a cached result can never stand in for a run against the database.
- 2026-10-31, `gitleaks` (2.7): `gitleaks/gitleaks-action` requires a `GITLEAKS_LICENSE` secret for repositories owned by an organisation, and `Marllow-git` is one with no such secret. The job therefore runs the official gitleaks release binary (v8.30.1), checksum-pinned, over the full history on every run. Switching to the action later needs only the licence secret.
- 2026-10-31, `expo-doctor` is a pinned dev dependency of `apps/driver` (script `doctor`), not an `npx` download; CI calls `pnpm --filter @eeasy-logistics/driver run doctor` because `pnpm doctor` is a built-in pnpm command.
- 2026-10-31, `api --role migrate` (2.3, 2.8): the existing `--role` flag gains `migrate` so the one image serves the three roles of data §11 step 5. Until PLAT-5 the role logs "No migrations yet (PLAT-5)" and exits 0; `pnpm --filter api migrate` builds the API and runs that role. The integration suite is `apps/api/test/integration/**` run by `test:integration` (`vitest.integration.config.ts`, passes with no tests until PLAT-5); `test:unit` excludes that folder. Both lanes set `APP_ENV=ci` for the PLAT-4 config module. `ELX_RLS` is only set by the lane; reading it belongs to the config module and the PLAT-5 test harness.
- 2026-10-31, standalone web build (2.4, 2.8): skills consulted before touching `apps/web`: `vercel:knowledge-update` and `vercel:nextjs` (reference `self-hosting.md`: `output: 'standalone'`, copy `.next/static` beside `server.js`, non-root user, `PORT` and `HOSTNAME`). In this monorepo `outputFileTracingRoot` is the repository root, so the server is `.next/standalone/apps/web/server.js`. `pnpm --filter web start` (`next start`) still serves the build for local runs, with a Next.js warning that standalone output prefers `server.js`; CI and the image run `server.js`.
- 2026-10-31, Playwright (2.4): `@playwright/test` 1.64.1 in `apps/web`; config at `apps/web/tests/playwright.config.ts` (the shared ESLint default project for root `*.config.ts` files cannot see Node types), projects `ar` and `en`, run by `pnpm --filter web test:smoke` against `PLAYWRIGHT_BASE_URL` (default `http://127.0.0.1:3000`). The smoke spec `tests/smoke-locale.spec.ts` sets the `el_locale` cookie per project, asserts HTTP 200, `lang`, `dir` and a visible heading on `/`, `/sign-in`, `/platform` and `/track/smoke-token`, and writes `test-results/screenshots/<locale>/<route>.png`. WEB-1's census specs join the same config.
- 2026-11-01, pre-commit hook (2.7): simple-git-hooks over lefthook. One hook (gitleaks on the staged changes) needs no runner: simple-git-hooks has no dependencies, keeps its one line in the root `package.json`, resolves the shared hooks directory of git worktrees, and skips cleanly where there is no `.git` (image builds, tarballs). Lefthook ships a platform binary through optional dependencies and an install script, which pnpm 10 blocks unless approved, for features one hook does not use. The root `prepare` script installs the hook on `pnpm install`; the package's own postinstall is in `ignoredBuiltDependencies`. The hook needs the `gitleaks` binary and fails with the install command when it is missing; `SKIP_SIMPLE_GIT_HOOKS=1` or `--no-verify` bypass it locally, and the CI job is the gate that cannot be bypassed.
- 2026-11-01, `.gitleaks.toml`: the default rules plus one path allowlist, `.env.example`, whose values are local placeholders (PLAT-4 puts `user:password` database URLs there). Shown locally: a `ghp_` token planted in another file and in `.env.example` at once was blocked by the hook with one finding, the other file's; committed past the hook, the CI command (`gitleaks git` over the full history) failed with exit 1 naming the commit; both then removed.
