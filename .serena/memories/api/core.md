# apps/api

- NestJS 12, ESM. `src/main.ts` parses `--role api|worker|migrate` (`src/role.ts`; `migrate` accepted only once PLAT-5 lands) and boots through `@eeasy-logistics/config` `loadConfig()`; exit 78 on config error.
- Contexts: `src/modules/kernel|delivery|wms/`, each with `<ctx>.module.ts` and `public/index.ts` (the only cross-context import surface). Kernel imports no context.
- `src/health/` → `/health` (PLAT-5 adds `/ready`).
- Tests: `*.test.ts` beside code (Vitest unit); `test/health.http.test.ts` style HTTP tests with supertest; integration config `vitest.integration.config.ts` needs a database (`elx`, roles `elx_app` etc.); `test/architecture/` fixtures prove the dependency-cruiser rules.
- Database roles (ADR-0031): `elx_owner` (migrations), `elx_app` (RLS-scoped app pool), `elx_platform` (cross-tenant, `@CrossTenant()`), `elx_maintenance`. Never migrate the shared dev database from an executor.
- Upcoming shape (roadmap): PLAT-6 request context in `AsyncLocalStorage` + `elx.account_id` GUC, PLAT-8 outbox + BullMQ queues per kind, PLAT-10 `x-permission` enforcement.
