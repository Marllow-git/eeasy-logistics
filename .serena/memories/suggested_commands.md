# Commands

## Whole repo (from root)
- `pnpm install` (pnpm 10 runs no install scripts except those in `pnpm-workspace.yaml`).
- `pnpm audit --audit-level moderate` — the CI `pnpm-audit` job (`.github/workflows/audit.yml`, every PR and weekly on main). Accepted advisories live in `pnpm-workspace.yaml` `auditConfig.ignoreGhsas`, each with a reason; add one only after checking it never reaches an image or bundle.
- `pnpm turbo run typecheck lint test build` — the full local gate.
- `pnpm format` / `pnpm format:check`.

## Per workspace (`--filter @eeasy-logistics/<api|web|driver|config|db|i18n|ui|contracts>`)
- `pnpm --filter @eeasy-logistics/api run test:unit | test:integration | test:architecture | migrate | dev` (`dev` sets `APP_ENV=local`; API role via `--role api|worker|migrate`).
- `pnpm --filter @eeasy-logistics/web run typecheck` (runs `next typegen` first), `test:smoke` (Playwright, both locales; needs API + web built and running).
- `pnpm --filter @eeasy-logistics/driver run test` (Jest + architecture), `doctor`.
- `pnpm --filter @eeasy-logistics/contracts run lint` (redocly).
- Quiet test output for agents: `vitest run --reporter=dot`; re-run a failing file verbosely only.

## Local stack (no Docker on the owner's machine)
- `tools/native-stack.sh up | status | down | reset` — Homebrew postgresql@17 + postgis, redis, minio, mailpit, whatsapp-stub on the Compose `dev` ports; roles `elx_owner/app/platform/maintenance`, db `elx`. Data under `.local/native-stack`. Mode (dedicated cluster vs existing 5432) fixed at first `up`.
- Compose (`compose.yaml`, profiles `dev|ci|stack-a|stack-b`) only in CI; `tools/stack.sh` for isolated stack pairs there.

## Workflow
- `tools/pr-gate.sh <PR>` before any merge (checks head, CI, plan §8/§9, release note, template).
- `gh pr create` from `.github/pull_request_template.md`; branch `feat/<ORDER-ID>-<slug>` with `docs/orders/<ID>/plan.md` as first commit.
- `git worktree list` / `git worktree prune` — executor worktrees live under `.claude/worktrees/`.

## Darwin notes
- Homebrew paths: `/opt/homebrew/opt/postgresql@17/bin` (override `ELX_NATIVE_PG_BIN`). `brew install gitleaks` required for the pre-commit hook.
- BSD `sed -i ''`; `base64 -d` works; use `grep -E` not `grep -P`.
