# eeasy-logistics — project overview

Standalone last-mile delivery + WMS product for merchants with their own drivers and stock. Monorepo: `apps/web` Next.js 16 App Router, `apps/api` NestJS 11, `apps/driver` Expo Router, `packages/{contracts,ui,i18n,config,db}`. PostgreSQL 16 + PostGIS (17 locally via Homebrew), Drizzle + SQL migrations, BullMQ on Redis, SSE for realtime, VROOM over Hudhud for routing. pnpm + Turborepo.

**Phase (2026-11-01): wave 0 foundation, code exists.** PLAT-1 to PLAT-4 merged; PLAT-5 in flight. Order of work: `docs/roadmap.md` §1.1; in-flight ledger: `docs/orders/README.md`.

## Where things are
- `AGENTS.md`: short rules every agent reads first. Pipeline: `docs/handbook/01-workflow.md`; roles and briefs: `docs/handbook/05-roles-and-agents.md`; conventions and plan-file sections: `docs/handbook/04-conventions.md`.
- Decisions: `adr/` (0000–0037). Architecture: `docs/architecture/*.md`. Contracts: `docs/contracts/`. Plans: `docs/orders/<ID>/plan.md`.
- Config: `packages/config` is the only `process.env` reader (`src/node.ts`, `src/web.ts`, `src/driver.ts`); lint and dependency-cruiser enforce it.
- Local stack: `tools/native-stack.sh` (no Docker on the owner's machine); Compose profiles in `compose.yaml` run in CI only. CI lanes: `.github/workflows/pr.yml`, `main.yml`.
- Merge gate: `tools/pr-gate.sh <PR>`.

## Hard rules in one line each
Tenancy: every operational row has `account_id`, from the token. Ledgers append-only via ledger services. Side effects via outbox. Allowlist rollout for new modules. `ar` and `en` for every string. No secrets in code; config module only.
