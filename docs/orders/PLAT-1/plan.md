# PLAT-1 · Monorepo scaffold

- **Status:** in progress
- **Date:** 2026-10-31
- **Wave:** 0 (roadmap §1.1)
- **Owner delegation:** wave 0 proceeds on the register defaults (roadmap §4) until the owner rules.
- **Lead:** architecture lead (Fable). **Executor:** Opus, own worktree. **Adversary:** no (roadmap: no auth, no data).

## 0. Goal

The repository becomes a runnable pnpm + Turborepo monorepo with the four applications and five packages the foundation plan names, each starting and passing typecheck, lint and an empty test suite, with the three-context module boundary enforced by a lint rule that demonstrably fails on a violation. No feature code: this order gives every later order a place to land.

## 1. Binding rules and ADRs

- ADR-0003 (one monorepo: Next.js web, NestJS API), ADR-0021 (driver app in the monorepo as `apps/driver`), ADR-0026 (three bounded contexts: `kernel`, `delivery`, `wms` under `apps/api/src/modules/`, each importing another only from its `public/` folder; the kernel imports no context; an architecture test fails CI on a violation), ADR-0020 (Drizzle, SQL migrations; the `packages/db` helpers live here, no schema yet).
- Foundation plan §3 stack table; data architecture §1.2 (schema file layout, `packages/db`); web architecture §2.2 (the web app never imports `apps/api`, `drizzle-orm`, `pg`, `ioredis` or an S3 SDK; dependency-cruiser rule); contracts §9 (`packages/contracts` generates from `docs/contracts/openapi`; `redocly lint` with `docs/contracts/redocly.yaml`).
- AGENTS.md hard rules: no raw environment reads outside the config module (PLAT-4 builds it; this order reads nothing from the environment except `PORT` in the API bootstrap, marked for PLAT-4 to replace); secrets never in code; Arabic and English for every string (the placeholder pages ship both).
- Handbook 04 conventions: branch `feat/PLAT-1-monorepo-scaffold`, one commit per build-list item, plan file first.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Package manager and task runner | pnpm 10 workspaces, Turborepo 2, Node 22 LTS pinned in `.nvmrc` and `package.json` `engines`; `corepack` enabled |
| 2.2 | Language and lint | TypeScript 6.0.x strict everywhere (ruled 2026-10-31: Expo SDK 58 pins ~6.0.3; 7.x excluded by typescript-eslint) with a shared `packages/config-ts` base (`tsconfig.base.json`); ESLint 9 flat config shared from `packages/config-eslint`; Prettier; `.editorconfig` |
| 2.3 | Test runner | Vitest for packages and `apps/api` unit tests; Jest with `jest-expo` only in `apps/driver` (driver app architecture §12.1); Playwright is PLAT-3's |
| 2.4 | Versions | Latest stable at scaffold time of Next.js (App Router), NestJS, Expo SDK with Expo Router, Drizzle ORM and drizzle-kit, recorded in §8 of this file by the executor with the date; no pre-releases |
| 2.5 | Workspace layout | `apps/web`, `apps/api`, `apps/driver`; `packages/contracts`, `packages/ui`, `packages/i18n`, `packages/config`, `packages/db`, plus the two shared tooling packages of 2.2 |
| 2.6 | API skeleton | NestJS with `apps/api/src/modules/{kernel,delivery,wms}/`, each with an empty `public/index.ts` and a module file; `GET /health` returning `{ status: "ok" }` (platform §5; `/ready` is PLAT-5's); the `--role worker` flag parsed and logged, no worker yet (platform §2) |
| 2.7 | Module boundary enforcement | dependency-cruiser with rules: a context imports another only via `modules/<ctx>/public`; `kernel` imports no context; `apps/web` imports none of the forbidden packages; the `elx_platform` pool rule is PLAT-6's. A fixture violation under `apps/api/test/architecture/` proves the rule fails (red), then is removed (green), both shown in the PR |
| 2.8 | Web skeleton | Next.js App Router, route groups `(merchant)`, `(platform)`, `(recipient)`, `(auth)` as empty layouts (web §1), one placeholder page per group rendering a bilingual string from `packages/i18n` with `dir` set from the locale; no design system yet (WEB-1) |
| 2.9 | Driver skeleton | Expo with Expo Router, groups `(auth)`, `(setup)`, `(app)` as empty layouts (driver app §9), one placeholder screen, `ar` default; no native modules yet |
| 2.10 | `packages/i18n` | `ar/common.json` and `en/common.json` with the placeholder keys; a typed `t()` helper; a test that fails when a key exists in one locale and not the other (handbook 04) |
| 2.11 | `packages/contracts` | `redocly lint` wired as `pnpm --filter contracts lint` against `docs/contracts/openapi/*.yaml` using `docs/contracts/redocly.yaml`; bundling and code generation are PLAT-15's; this order proves the lint runs green |
| 2.12 | `packages/config`, `packages/db`, `packages/ui` | empty typed placeholders with a README line each naming the order that fills them (PLAT-4, PLAT-5, WEB-1) |
| 2.13 | Turborepo pipeline | `typecheck`, `lint`, `test`, `build` tasks with caching; `pnpm turbo run typecheck lint test build` is the local gate; CI wiring is PLAT-3's |
| 2.14 | Git hygiene | `.gitignore` gains `.claude/`, `.serena/`, `.turbo/`, `.next/`, `.expo/`, `dist/`, `coverage/`; `CODEOWNERS` not added (owner merges) |

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | Root: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc`, `.editorconfig`, `.gitignore`, `README.md` "Development" section | `pnpm install` clean; `pnpm turbo run typecheck` runs (empty) |
| B | `packages/config-ts`, `packages/config-eslint`, Prettier | a deliberate type error and lint error fail; removed after |
| C | `packages/i18n` with the locale parity test | test green; a removed key makes it red |
| D | `packages/contracts` with `redocly lint` | lint green against the eight files |
| E | `packages/config`, `packages/db`, `packages/ui` placeholders | typecheck green |
| F | `apps/api` skeleton with three context modules and `/health` | `pnpm --filter api dev` answers `GET /health` 200; unit test for the health controller |
| G | dependency-cruiser architecture test with red-then-green fixture | `pnpm --filter api test:architecture` |
| H | `apps/web` skeleton with route groups and bilingual placeholder | `pnpm --filter web build` green; both locales render |
| I | `apps/driver` skeleton with Expo Router groups | `pnpm --filter driver typecheck` green; `expo-doctor` clean |
| J | §8 of this plan filled with the versions chosen, dated | – |

## 4. Commit plan

One commit per build-list item A to J, subjects `PLAT-1: <item>` in the imperative, under 72 characters, each ending with the co-author line the tooling supplies.

## 5. Exit criteria

- `pnpm install && pnpm turbo run typecheck lint test build` is green from a clean clone on Node 22.
- `GET /health` answers 200 from `apps/api`; the web app renders the placeholder in `ar` and `en`; the driver app typechecks.
- The architecture test is shown failing on a violation fixture and passing without it.
- `pnpm --filter contracts lint` is green against the merged contracts.
- The i18n parity test exists and is green.
- No environment variable is read outside `apps/api/src/main.ts` (`PORT`, marked `// PLAT-4 replaces`).

## 6. Not in this order

Compose and stubs (PLAT-2), CI lanes (PLAT-3), the config module and its schema (PLAT-4), any database schema, migration or Drizzle table (PLAT-5), the request context and guards (PLAT-6), the design system (WEB-1), code generation from the contracts (PLAT-15), EAS configuration (DRV-1), any feature.

## 7. Owner questions

None blocking. Q-21 (brand name) is not needed: placeholders use the working name "Eeasy Logistics".

## 8. Versions chosen (filled by the executor)

Checked against the npm registry on **2026-10-31** (`npm view <pkg> version`; no pre-releases). Exact versions are pinned in each `package.json` and resolved in `pnpm-lock.yaml`.

| Tool | Version | Latest stable on 2026-10-31 | Note |
|---|---|---|---|
| Node | 22 LTS (`.nvmrc` `22`, `engines` `>=22.13.0 <23`); verified on 22.23.4 | 24 LTS exists | plan 2.1 pins 22; Expo SDK 58 needs ≥ 22.13 |
| pnpm | 10.34.9 (`packageManager`, Corepack) | 12.16.1 | plan 2.1 pins pnpm 10; latest 10.x taken |
| Turborepo | 2.11.10 | 2.11.10 | |
| TypeScript | 6.0.3 | 7.0.2 | ruling on 2.2 above; typescript-eslint 8.72.1 supports < 6.1 |
| Next.js | 16.4.3 (App Router, Turbopack) | 16.4.3 | |
| React | 19.3.0 | 19.3.1 | one version across the repository, the one Expo SDK 58 pins |
| NestJS | 12.3.2 (`@nestjs/core`, `common`, `platform-express`, `testing`); CLI 12.0.11 | 12.3.2 | ESM (`"type": "module"`) as Nest 12 ships |
| Expo SDK | 58.0.22 | 58.0.22 | React Native 0.88.1; `expo-doctor` 1.21.5: 20/20 checks |
| Expo Router | 58.0.29 | 58.0.29 | |
| Drizzle ORM | 0.45.4 | 0.45.4 | in `packages/db`, no schema (PLAT-5) |
| drizzle-kit | 0.31.11 | 0.31.11 | in `packages/db`; PLAT-5 may move it next to `apps/api/drizzle/` |
| Vitest | 5.0.5 | 5.0.5 | packages and `apps/api`; decorator metadata works without SWC |
| Jest / jest-expo | 30.5.2 / 58.0.13 | 30.5.2 / 58.0.13 | `apps/driver` only |
| dependency-cruiser | 18.7.0 | 18.7.0 | `apps/api` and `apps/web` |
| Redocly CLI | 2.72.1 | 2.72.1 | `packages/contracts` |
| ESLint | 9.39.5 (`@eslint/js` 9.39.5) | 10.14.0 | plan 2.2 pins ESLint 9; latest 9.x taken |
| typescript-eslint | 8.72.1 | 8.72.1 | |
| `@next/eslint-plugin-next` | 16.4.3 | 16.4.3 | |
| `eslint-plugin-react-hooks` | 7.1.1 | 7.1.1 | |
| Prettier | 3.9.10 | 3.9.10 | |

Docs consulted for `apps/web` (owner rule, 2026-10-31): the Vercel plugin skills `vercel:knowledge-update` (dated 2026-09-18) and `vercel:nextjs` (plugin 0.50.0: file conventions, async `cookies()`, `transpilePackages`, `middleware.ts` renamed `proxy.ts` in Next.js 16). No proxy file is added in this order; web §1.1's `middleware.ts` becomes `proxy.ts` when the order that needs it lands. The Nest 12 ESM layout followed the `@nestjs/schematics` 12.0.12 application template.
