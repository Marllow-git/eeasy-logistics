# 03 · Testing

The safety net. These rules bind once application code exists; the architecture phase ships no code.

## Pyramid

| Layer | Tool | Where | Runs |
|---|---|---|---|
| Unit | the workspace test runner (decided at scaffold) | next to the code | locally on every change, CI |
| API integration | same runner against PostgreSQL + Redis from the Compose stack | `apps/api/test/` | locally for the touched module, CI full |
| Contract | generated client from `packages/contracts` exercised against the API | `packages/contracts/test/` | CI |
| Census | Playwright, Arabic and English, isolated stack | `apps/web/tests/census-*.spec.ts`, `apps/driver` end-to-end where feasible | locally for the touched screens, CI full |
| Ledger assertions | SQL assertions over stock and cash ledgers versus projections | `apps/api/test/ledger/` | CI, nightly in production |

## Rules

- Behaviour changes ship with a test that fails without the fix.
- Integration tests use a real database. SQLite or in-memory stand-ins are not accepted: they hide constraint, trigger and type behaviour.
- Never delete or weaken a test to make something pass.
- Executors run the targeted suites of their own change and leave the full lanes to CI. Full lanes on a developer machine only on owner request.
- A census spec is added to the census config in the same PR that adds it; a spec that is not listed reports "no tests found" rather than failing.
- **Test data comes from the contracts (amended 2026-11-01, roadmap A-17).** No test hand-writes a type, interface or object literal for a request or response shape the YAML defines.
  - Web, admin and driver tests mock the API with the generated MSW handlers and mock factories of their own surface (`@eeasy-logistics/contracts/<surface>/mocks`, test-only, never imported by app code). A test overrides only the fields it asserts on.
  - API HTTP tests type request bodies with the generated request types and parse every response with the operation's generated response Zod schema. A renamed or removed field fails typecheck or the test, not only the contract lane.
  - Database-side test data (integration, ledger assertions) uses factories typed from the Drizzle schema, never contract types. Contract types stop at controllers and presenters (doc 3 §9).
  - The A-17 dependency-cruiser rules ship with violation fixtures (a `*.dto.ts` file, a forbidden package, a contracts import from a service) that each fail the architecture test, as the ADR-0026 rules do.
- Isolated stack means: a clone database (never the shared development database), the API and web on their own ports, the API base URL baked into the build and passed to Playwright.

## CI gates per PR

1. typecheck and lint for every workspace
2. unit and integration (API)
3. web build and census, Arabic and English
4. driver app typecheck and unit
5. secret scan (gitleaks)

A PR merges only when all are green.
