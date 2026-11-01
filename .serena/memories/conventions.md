# Conventions

## Code
- TypeScript strict everywhere; ESM; explicit `.ts` relative imports inside packages; exact dependency pins.
- Config: declare a setting once in `packages/config` Zod schemas; secrets wrapped in `Secret` (`reveal()`), never logged; new adapter selectors register in `refusals.ts` `adapterSelectors`. Web/driver read only `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` through `publicConfig()` with literal `process.env.X` reads (bundler inlining) — only `node.ts`, `web.ts`, `driver.ts` are lint-exempt.
- API contexts: `apps/api/src/modules/{kernel,delivery,wms}/`; cross-context imports only from `public/index.ts`. Architecture fixtures under `apps/api/test/architecture/fixture` show pass/fail cases; add one when adding a rule.
- API naming (handbook 04): plural kebab-case paths, `snake_case` JSON, ISO 8601 with offset, money as integer halalas + currency, error `{code,message,details?}` with stable codes, `Idempotency-Key` on retryable writes.
- i18n: keys in `packages/i18n/<locale>/<namespace>.json`; Arabic catalogue is the reference type, parity test fails on a key missing in either locale. Logical CSS properties only in web (RTL).
- API handlers (PLAT-6): import `Public`, `CrossTenant`, `Idempotent`, `ApiException` from `modules/kernel/public`; throw `ApiException('<errors.md code>')`, never an `HttpException` with text; build repositories from `getUnitOfWork()`; retryable writes carry `@Idempotent()` (secret-bearing ones `{ secretResponse: true }`); no `*.dto.ts` or class-validator (A-17).
- Database: tenant code reads and writes through a `ScopedRepository` subclass in a `*.repository.ts` file inside a unit of work (requests: `getUnitOfWork()`); a new table ships `account_id` (FK + leading index; NULL only for data §2.4 nullable-account tables listed in `nullableAccountTables`), the `tenant_isolation`/`platform_access` policies and, if append-only, `SELECT core_make_append_only('<t>')` in the same migration; hand SQL via `drizzle-kit generate --custom`; never edit an applied migration.
- Dependencies: pnpm refuses versions younger than 3 days (`minimumReleaseAge: 4320`) and fails on a trust downgrade (`trustPolicy: no-downgrade`); a version needed sooner goes in `minimumReleaseAgeExclude` with a reason. Dependabot (`.github/dependabot.yml`) opens grouped weekly PRs; Expo-pinned packages move only through `npx expo install` in an SDK upgrade, and ESLint 10 / TypeScript 7 majors are held (2026-11-01).
- Tests: unit next to code (`*.test.ts`); integration against real PostgreSQL; behaviour change = red-then-green shown in PR; never weaken a test.
- Test data from contracts (handbook 03): mock the API with the generated `@eeasy-logistics/contracts/<surface>/mocks` (test-only), overriding only asserted fields; API HTTP tests use generated request types and parse responses with the generated response schema; database fixtures stay Drizzle-typed; never hand-write an object literal for a contract shape.

## Repo process
- Branches `docs/…`, `feat/<ORDER-ID>-<slug>`, `fix/…`, `chore/…`; commits `<ID>: <item letter>, <what>`, one per build-list item; co-author trailer supplied by tooling.
- Plan file sections 0–9 (handbook 04): §1 cites file **and heading**; §3 legs ≤5 items; §8.0 progress row committed per item; §8.1 skills/docs with versions+dates; §8.2 interpretations; §8.3 not done; §9 review + adversary table.
- Executors never answer owner questions (roadmap §4 Q-*): build on the default, record interpretation in §8.2.
- Release note `docs/release-notes/YYYY-MM-DD-<slug>.md` in Arabic for any user-visible change.
- ADRs: supersede, never edit; plan files and PRs cite ADR numbers.
- Docs index updated in the same PR (`docs/README.md`, `adr/README.md`).
