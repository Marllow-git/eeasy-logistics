# Tech stack (pins as of 2026-11-01; exact versions, no ranges)

- Node 22 (`.nvmrc`; engines `>=22.13 <23`; Node 24 move is roadmap A-14). pnpm 10.34 via `packageManager`; Turborepo 2.11 (`turbo.json`: typecheck/lint/test depend on `^typecheck`).
- TypeScript 6.0, `tsconfig.base.json` in `packages/config-ts`: strict, `noUncheckedIndexedAccess`, `moduleResolution: Bundler`, `rewriteRelativeImportExtensions` (packages ship `.ts` source with `.ts` relative imports; API runs them via Node type stripping, `erasableSyntaxOnly`).
- ESLint 9 flat config from `packages/config-eslint` (`base`, `react`); Prettier 3 at root.
- API: NestJS 12, `type: module`, Vitest 5 (`vitest.config` unit, `vitest.integration.config.ts` integration), supertest, dependency-cruiser 18.
- Web: Next.js 16.4 App Router, React 19.3, next-intl (`ar` default), Playwright smoke (`tests/`).
- Driver: Expo SDK 58, Expo Router, Jest.
- Config: Zod 4, dotenv (only when `APP_ENV=local`).
- Data: PostgreSQL 16 + PostGIS in CI/Compose, PostgreSQL 17 Homebrew locally (accepted difference); Drizzle; Redis 7 + BullMQ; MinIO/Silo object storage; VROOM routing (Compose only, no native build).
- CI: GitHub Actions `pr.yml` lanes `typecheck-lint`, `api-test` (+RLS lane), `web-build-census`, `driver-test`, `gitleaks`; `main.yml` builds/scans/pushes images. gitleaks also pre-commit via simple-git-hooks.
