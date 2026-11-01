# Commands

## Whole repo (from root)
- `pnpm install` (pnpm 10 runs no install scripts except those in `pnpm-workspace.yaml`).
- Lockfile trap (2026-11-01): main's `pnpm-lock.yaml` holds versions younger than `minimumReleaseAge` and a `trustPolicy` downgrade, so any re-resolving install fails. After a `package.json` change: `pnpm install --lockfile-only --config.minimum-release-age=0 --config.trust-policy=off`, check the lockfile diff is additions only and each new version is older than three days (`npm view <pkg> time`), then `pnpm install --frozen-lockfile`.
- `pnpm audit --audit-level moderate` — the CI `pnpm-audit` job (`.github/workflows/audit.yml`, every PR and weekly on main). Accepted advisories live in `pnpm-workspace.yaml` `auditConfig.ignoreGhsas`, each with a reason; add one only after checking it never reaches an image or bundle.
- `pnpm turbo run typecheck lint test build` — the full local gate.
- `pnpm format` / `pnpm format:check`.

## Per workspace (`--filter @eeasy-logistics/<api|web|admin|driver|config|db|i18n|ui|contracts>`)
- `pnpm --filter @eeasy-logistics/api run test:unit | test:integration | test:architecture | migrate | seed | dev` (`test:architecture` cruises `src` and `test/architecture/fixture`; the unit suite cruises `test/architecture/violations` and needs the contracts built) (`dev` sets `APP_ENV=local`; API role via `--role api|worker|migrate`; `worker` purges expired idempotency keys hourly when `REDIS_URL` and `DATABASE_URL_PLATFORM` are set, else warns and exits 0). `migrate` builds then runs the one-shot job as `elx_owner`; `seed` writes two fixture accounts, `seed --template` rebuilds `elx_seed` (needs `DATABASE_URL_ADMIN`).
- Integration suite locally: `APP_ENV=local DATABASE_URL_ADMIN=postgres://$(id -un)@127.0.0.1:5432/postgres ELX_RLS=off|on pnpm --filter @eeasy-logistics/api run test:integration` — migrates a scratch `elx_test_<hex>` per run and drops it; without the admin URL it refuses locally (in `ci` it uses the migrated ci database). Needs Redis on `REDIS_URL` (rate-limit suite) and storage on 9000 (`/ready`).
- `pnpm --filter @eeasy-logistics/web run typecheck` (runs `next typegen` first), `test:census` (Playwright census `ar`, `ar-390`, `en` with axe, locale and security checks and screenshot baselines; needs `build` + `start -p 3001` running, no API needed yet; `--update-snapshots` after a deliberate visual change, then review the Arabic images).
- `pnpm --filter @eeasy-logistics/ui run test` (Vitest jsdom: components in both directions + token contrast, then architecture); `pnpm --filter @eeasy-logistics/config-eslint run test` (`node --test`: the logical-CSS rule against its red and green fixtures).
- `pnpm --filter @eeasy-logistics/admin run dev | build | start` (port 3002 in the scripts), `typecheck`, `test` (architecture: `src`, `tests`, `next.config.ts`), `test:smoke` (Playwright `ar`+`en` against `http://127.0.0.1:3002`; needs `build` + `start` running).
- `pnpm --filter @eeasy-logistics/driver run test` (Jest + architecture), `doctor`.
- `pnpm --filter @eeasy-logistics/contracts run build` (`build:bundle` → `generated/openapi/<surface>.{yaml,json}`, `build:unions` → `generated/unions.ts`, `build:client` → Orval `generated/<surface>/`, `build:operations` → `zod.coerce.boolean()` rewritten to `zod.stringbool()` and `generated/<surface>/operations.ts`); `lint` (redocly with repo rules + eslint); `lint:bundles`; `typecheck`; `test` (Vitest incl. the contract-harness self-test + architecture); `test:contract -- --api http://127.0.0.1:3000` (self-test + every `test/scenarios/<surface>/<operationId>.ts` against a running API, advisory coverage table; falls back to `CONTRACT_API_URL` via `@eeasy-logistics/config/contract-test`; exit 2 without a URL). Turbo runs contracts `build` before its own and the apps' `typecheck`/`lint`/`test` (`^build` in `apps/{web,admin,driver}/turbo.json`).
- Contract change: edit YAML under `docs/contracts/openapi/`; a new permission goes in README §11 and `docs/contracts/permissions.yaml` together; a new write needs `Idempotency-Key` or an entry in the `exempt` list in `docs/contracts/redocly.yaml`; a stream needs `x-sse-events`. Implementing an operation: add its scenario `packages/contracts/test/scenarios/<surface>/<operationId>.ts` (`defineScenario({ expectedStatus, run: ({ fetcher }) => client.<op>(…, { fetcher }) })`).
- Quiet test output for agents: `vitest run --reporter=dot`; re-run a failing file verbosely only.

## Local stack (no Docker on the owner's machine)
- `tools/native-stack.sh migrate` runs the migration job against the `.env` database (process env wins, so `DATABASE_URL_OWNER=… tools/native-stack.sh migrate` targets a scratch db).
- `tools/native-stack.sh up | status | down | reset` — Homebrew postgresql@17 + postgis, redis, minio, mailpit, whatsapp-stub on the Compose `dev` ports; roles `elx_owner/app/platform/maintenance`, db `elx`. Data under `.local/native-stack`. Mode (dedicated cluster vs existing 5432) fixed at first `up`.
- Compose (`compose.yaml`, profiles `dev|ci|stack-a|stack-b`) only in CI; `tools/stack.sh` for isolated stack pairs there.

## Workflow
- `tools/pr-gate.sh <PR>` before any merge (checks head, CI, plan §8/§9, release note, template).
- `gh pr create` from `.github/pull_request_template.md`; branch `feat/<ORDER-ID>-<slug>` with `docs/orders/<ID>/plan.md` as first commit.
- `git worktree list` / `git worktree prune` — executor worktrees live under `.claude/worktrees/`.

## Darwin notes
- Homebrew paths: `/opt/homebrew/opt/postgresql@17/bin` (override `ELX_NATIVE_PG_BIN`). `brew install gitleaks` required for the pre-commit hook.
- BSD `sed -i ''`; `base64 -d` works; use `grep -E` not `grep -P`.
