# eeasy-logistics

Standalone last-mile delivery and warehouse (WMS) product for merchants that run their own drivers and their own stock. Built as one monorepo: Next.js web app, NestJS API, Expo driver app.

**Current phase: architecture.** This repository holds documents only: architecture decision records, the domain model, contracts, and the engineering handbook. No application code lands until the owner approves the foundation package (see `docs/README.md`).

## Layout

| Path | Holds |
|---|---|
| `adr/` | Architecture decision records, one decision per file, numbered. `adr/README.md` is the index. |
| `docs/handbook/` | How we work: workflow, definition of done, testing, conventions. `AGENTS.md` at the root is the short form every agent and engineer reads first. |
| `docs/architecture/` | Domain model, data architecture, platform blueprint, web, driver app and integration architecture (arrive as later PRs). |
| `docs/contracts/` | OpenAPI documents and the webhook event catalogue (arrive as later PRs). |
| `docs/references/` | Reference-product censuses: Logestechs, OTO Flex, Bolesa (arrive as later PRs). |

## Development

Requirements: Node 22 LTS (`.nvmrc`) and pnpm 10 through Corepack.

```sh
corepack enable          # once per machine; pins pnpm from package.json "packageManager"
pnpm install
pnpm turbo run typecheck lint test build   # the local gate (CI wiring is PLAT-3)
```

| Path | Holds |
|---|---|
| `apps/api` | NestJS API; contexts `kernel`, `delivery`, `wms` under `src/modules/` (ADR-0026) |
| `apps/web` | Next.js App Router web app (merchant, platform, recipient, auth route groups) |
| `apps/driver` | Expo driver app with Expo Router (ADR-0021) |
| `packages/contracts` | OpenAPI lint now; generated clients later (PLAT-15) |
| `packages/i18n` | Arabic and English catalogues and the typed `t()` helper |
| `packages/config`, `packages/db`, `packages/ui` | placeholders for PLAT-4, PLAT-5 and WEB-1 |
| `packages/config-ts`, `packages/config-eslint` | shared TypeScript and ESLint configuration |

Useful commands: `pnpm --filter api dev` (API on port 3000, `GET /health`), `pnpm --filter web dev`, `pnpm --filter driver start`, `pnpm --filter api test:architecture` (module boundary check), `pnpm --filter contracts lint`.

## Lineage

This product replaces the Delivery module and the WMS plan that lived inside `Marllow-git/eeasynew` until 2026-10-31. That code is reference material, not a dependency. The one eeasynew capability this product calls is the Eeasy shipping public API, for carrier shipments created at pack time.

## Working rules

Every change arrives as a pull request from a `docs/`, `feat/`, `fix/` or `chore/` branch. Nothing is committed to `main` directly. The owner merges. See `AGENTS.md`.
