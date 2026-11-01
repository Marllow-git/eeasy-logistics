# eeasy-logistics · core

Standalone last-mile delivery + WMS for merchants with own drivers and stock. pnpm + Turborepo monorepo. Phase: wave 0 foundation (code exists since PLAT-1, 2026-10-31).

## Source map
- `apps/api` NestJS API, three bounded contexts → `mem:api/core`
- `apps/web` Next.js 16 App Router, four route groups → `mem:web/core`
- `apps/driver` Expo Router driver app → `mem:driver/core`
- `packages/config` the only `process.env` reader; Zod schemas, `Secret` wrapper, credentials AES-GCM, production refusals (`src/refusals.ts`). Entry points: `node.ts` (server), `web.ts`, `driver.ts` (public vars only).
- `packages/db` database helpers (PLAT-5): root entry `createAppPool`, `withUnitOfWork`, `ScopedRepository`, `getContext`, `verifyPoolRole`, `uuidv7`; `/platform` (elx_platform pool, `PlatformRepository.unscoped()`), `/migrate` (runner, advisory lock, history check), `/admin` (superuser scratch-db helpers, local/ci), `/testing` (context setter). Migrations live in `apps/api/drizzle/` (reviewed SQL, `-- reviewed` header); integration harness `apps/api/test/integration/global-setup.ts` migrates a scratch database per run. `packages/i18n` `ar`/`en` catalogues, typed `t()`. `packages/ui` Radix + Tailwind tokens. `packages/contracts` (PLAT-15): Redocly lint with repo rules (`redocly/plugin.js`, catalogue `docs/contracts/permissions.yaml`), per-surface bundles + Orval clients/hooks/Zod/MSW + unions under `generated/` (gitignored, built by `build`, never committed or edited); entry points `./{staff,platform,public,driver,recipient}`, `./<staff|platform|public>/mocks`, `./http` (`createFetcher`, `apiFetch`, `ApiError`), `./unions` (`Permission`, `StreamEventName`, `ErrorCode`). `packages/config-ts`, `packages/config-eslint` shared configs.
- `tools/native-stack.sh` Homebrew stack (no Docker on owner's Mac); `tools/stack.sh` Compose stack pairs; `tools/pr-gate.sh <PR>` merge gate.
- Governance: `AGENTS.md` (hard rules), `docs/handbook/01..05`, `adr/0000-0037`, `docs/architecture/*.md`, `docs/roadmap.md` (order graph), `docs/orders/<ID>/plan.md`, `docs/orders/README.md` (in-flight ledger).

## Invariants (AGENTS.md hard rules, enforced where stated)
- Every operational row has `account_id`; account from token/request context, never a parameter.
- Ledgers (stock, cash custody, driver liability) append-only; writes only through ledger services.
- External side effects only via outbox (ADR-0024); driver location pings exempt (ADR-0028).
- No `process.env` outside `packages/config` — enforced by shared ESLint `no-restricted-*` rules and dependency-cruiser `environmentRules()` in every workspace's `test:architecture`.
- Database (PLAT-5): only `packages/db` imports `postgres`/`drizzle-orm/postgres-js` (depcruise `database-driver-only-in-packages-db`); `/platform` only from `modules/kernel/platform/`, `src/worker/system/`, `src/seed/`; `/testing` never in `src/`; `/admin` only `src/seed/`; ESLint forbids the strings `set_config`/`elx.account_id` outside `packages/db/src` and `.tx` on a unit of work outside `*.repository.ts`; schema test `apps/api/test/schema/tenancy.test.ts` enforces `account_id`, policies, append-only triggers.
- Web and driver reach the API only through `@eeasy-logistics/contracts`; dependency-cruiser limits `apps/web` to `/staff`, `/recipient`, `/http`, `/unions` (no `/platform` until the admin-console decision, no `/mocks` in src) and `apps/driver` to `/driver`, `/http`, `/unions`. Generated code under `packages/contracts/generated/` is never committed.
- Bounded contexts `kernel`, `delivery`, `wms`: kernel imports no context; a context imports another only via `modules/<ctx>/public/` — dependency-cruiser in `apps/api`.
- API types come only from `@eeasy-logistics/contracts` (doc 3 §9, roadmap A-17): no hand-written DTOs, no `class-validator`/`class-transformer`/`nestjs-zod`/`@nestjs/swagger`; strict generated Zod schemas parse every controller input through the kernel `ContractPipe` (PLAT-6); contract types only in `*.controller.ts` and `*.presenter.ts`; services, repositories and Drizzle keep their own types. Dependency-cruiser enforces it once PLAT-6 lands.
- Every string in `ar` and `en`; Arabic default and RTL (ADR-0016). Gregorian dates, Western digits.
- New modules behind rollout mode, default allowlist (ADR-0006).
- Never commit to `main`; one order → one PR; plan file first commit on `feat/<ID>-<slug>`.

See `mem:tech_stack` for versions, `mem:suggested_commands` for running things, `mem:conventions` for code style and plan-file rules, `mem:task_completion` for the done checklist. Read `mem:memory_upkeep` before finishing any change to scripts, pins, modules, lint rules or conventions: it lists which memory each kind of change must update.
