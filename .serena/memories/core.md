# eeasy-logistics · core

Standalone last-mile delivery + WMS for merchants with own drivers and stock. pnpm + Turborepo monorepo. Phase: wave 0 foundation (code exists since PLAT-1, 2026-10-31).

## Source map
- `apps/api` NestJS API, three bounded contexts → `mem:api/core`
- `apps/web` Next.js 16 App Router, four route groups → `mem:web/core`
- `apps/driver` Expo Router driver app → `mem:driver/core`
- `packages/config` the only `process.env` reader; Zod schemas, `Secret` wrapper, credentials AES-GCM, production refusals (`src/refusals.ts`). Entry points: `node.ts` (server), `web.ts`, `driver.ts` (public vars only).
- `packages/db` Drizzle + SQL migrations (PLAT-5 fills it). `packages/i18n` `ar`/`en` catalogues, typed `t()`. `packages/ui` Radix + Tailwind tokens. `packages/contracts` OpenAPI, `redocly lint`. `packages/config-ts`, `packages/config-eslint` shared configs.
- `tools/native-stack.sh` Homebrew stack (no Docker on owner's Mac); `tools/stack.sh` Compose stack pairs; `tools/pr-gate.sh <PR>` merge gate.
- Governance: `AGENTS.md` (hard rules), `docs/handbook/01..05`, `adr/0000-0037`, `docs/architecture/*.md`, `docs/roadmap.md` (order graph), `docs/orders/<ID>/plan.md`, `docs/orders/README.md` (in-flight ledger).

## Invariants (AGENTS.md hard rules, enforced where stated)
- Every operational row has `account_id`; account from token/request context, never a parameter.
- Ledgers (stock, cash custody, driver liability) append-only; writes only through ledger services.
- External side effects only via outbox (ADR-0024); driver location pings exempt (ADR-0028).
- No `process.env` outside `packages/config` — enforced by shared ESLint `no-restricted-*` rules and dependency-cruiser `environmentRules()` in every workspace's `test:architecture`.
- Bounded contexts `kernel`, `delivery`, `wms`: kernel imports no context; a context imports another only via `modules/<ctx>/public/` — dependency-cruiser in `apps/api`.
- API types come only from `@eeasy-logistics/contracts` (doc 3 §9, roadmap A-17): no hand-written DTOs, no `class-validator`/`class-transformer`/`nestjs-zod`/`@nestjs/swagger`; strict generated Zod schemas parse every controller input through the kernel `ContractPipe` (PLAT-6); contract types only in `*.controller.ts` and `*.presenter.ts`; services, repositories and Drizzle keep their own types. Dependency-cruiser enforces it once PLAT-6 lands.
- Every string in `ar` and `en`; Arabic default and RTL (ADR-0016). Gregorian dates, Western digits.
- New modules behind rollout mode, default allowlist (ADR-0006).
- Never commit to `main`; one order → one PR; plan file first commit on `feat/<ID>-<slug>`.

See `mem:tech_stack` for versions, `mem:suggested_commands` for running things, `mem:conventions` for code style and plan-file rules, `mem:task_completion` for the done checklist. Read `mem:memory_upkeep` before finishing any change to scripts, pins, modules, lint rules or conventions: it lists which memory each kind of change must update.
