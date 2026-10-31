# PLAT-3 · CI lanes

- **Status:** planned (starts after PLAT-2 merges; rebase this branch onto main then)
- **Date:** 2026-10-31
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-1 (merged, PR #22), PLAT-2.
- **Lead:** architecture lead. **Executor:** Opus, own worktree. **Adversary:** no.
- **Context:** the lead's Mac has no Docker runtime (2026-10-31), so CI is the only place integration checks run until the owner installs one. This order is therefore on the critical path for every later order.

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
