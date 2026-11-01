# Done checklist (handbook 02)

Run from the repo root unless noted; all must be green before a PR leaves draft.

1. `pnpm turbo run typecheck lint test --filter=<changed workspaces>...` then the full `pnpm turbo run typecheck lint test build` once.
2. API behaviour change: `pnpm --filter @eeasy-logistics/api run test:integration` with `DATABASE_URL_ADMIN` set, once with `ELX_RLS=off` and once with `ELX_RLS=on` (CI lanes `api-test` and `api-test-rls` run `migrate`, `seed`, `test:unit`, `test:integration`, `test:architecture` with `APP_ENV=ci`) — real PostgreSQL, never a mock; show red-then-green in the PR. A new table: policies and `account_id` per the schema test, exemptions in `apps/api/test/schema/exemptions.ts`.
3. Architecture rules: `test:architecture` in every touched workspace (runs inside `test`).
4. Web UI change: `pnpm --filter @eeasy-logistics/web run test:smoke` in `ar` and `en`; Arabic RTL screenshot reviewed; `ar`+`en` keys added; Arabic release note.
5. Driver change: `pnpm --filter @eeasy-logistics/driver run test` and `doctor`.
6. Contracts touched: `pnpm --filter @eeasy-logistics/contracts run lint`.
7. `pnpm format:check`.
8. Plan `docs/orders/<ID>/plan.md` §8 complete (8.0 progress rows per item, 8.1–8.3); `.serena/memories/` updated if a convention, command, invariant or source-map entry changed (see `mem:memory_upkeep`).
9. PR body from `.github/pull_request_template.md` with exact counts; then `tools/pr-gate.sh <PR>` must print `GATE PASS`.
