# Tech stack (pins as of 2026-11-01; exact versions, no ranges)

- Node 22 (`.nvmrc`; engines `>=22.13 <23`; Node 24 move is roadmap A-14). pnpm 10.34 via `packageManager`; Turborepo 2.11 (`turbo.json`: typecheck/lint/test depend on `^typecheck`).
- TypeScript 6.0, `tsconfig.base.json` in `packages/config-ts`: strict, `noUncheckedIndexedAccess`, `moduleResolution: Bundler`, `rewriteRelativeImportExtensions` (packages ship `.ts` source with `.ts` relative imports; API runs them via Node type stripping, `erasableSyntaxOnly`).
- ESLint 9 flat config from `packages/config-eslint` (`base`, `react`); Prettier 3 at root.
- API: NestJS 12, `type: module`, Vitest 5 (`vitest.config` unit, `vitest.integration.config.ts` integration), supertest, dependency-cruiser 18.
- Web: Next.js 16.4 App Router, React 19.3, next-intl (`ar` default), Playwright smoke (`tests/`).
- Driver: Expo SDK 58, Expo Router, Jest.
- Config: Zod 4, dotenv (only when `APP_ENV=local`).
- Contracts: @redocly/cli 2.72, Orval 8.46 (`mock: { generators: [{ type: 'msw' }] }` — the docs' `mocks` key is ignored; zod client `override.zod` strict/coerce/`generateEachHttpStatus`; its `coerce.boolean` is `Boolean(v)` so `build:operations` swaps in `zod.stringbool()`), TanStack Query 5.105, MSW 3.0, faker 10.6, Zod 4.6 (Orval zod client), ajv 8.20 (`ajv/dist/2020.js`, `strict: false` for OpenAPI keywords) + ajv-formats 3.0 for the contract harness. Generation scripts run as `.ts` via Node type stripping (Node ≥22.18).
- Data: PostgreSQL 16 + PostGIS in CI/Compose, PostgreSQL 17 Homebrew locally (accepted difference); drizzle-orm 0.45.4 + drizzle-kit 0.31.11, driver `postgres` 3.4.9 (4.x deliberately not taken: Drizzle 0.45 targets 3.x); ioredis 6.0.0 and @aws-sdk/client-s3 3.1161.0 (for `/ready`); Redis 7 + BullMQ; MinIO/Silo object storage; VROOM routing (Compose only, no native build).
- CI: GitHub Actions `pr.yml` lanes `typecheck-lint` (+ contracts generate-twice hash step), `api-test` (+RLS lane), `web-build-census` (+ `test:contract` against the API on 3000), `admin-build-census` (admin standalone on 3002), `driver-test`, `gitleaks` (seven required); `main.yml` builds/probes/scans/pushes images `api`, `web`, `admin`. gitleaks also pre-commit via simple-git-hooks.
