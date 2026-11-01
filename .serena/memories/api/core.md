# apps/api

- NestJS 12, ESM. `src/main.ts` parses `--role api|worker|migrate` (`src/role.ts`; `migrate` runs `src/migrate/run.ts`) and boots through `@eeasy-logistics/config` `loadConfig()`; exit 78 on config error.
- Contexts: `src/modules/kernel|delivery|wms/`, each with `<ctx>.module.ts` and `public/index.ts` (the only cross-context import surface). Kernel imports no context.
- `src/health/` → `/health` (no dependencies) and `/ready` (`AppModule.forRoot(config)` only: elx_app role check, schema version at or beyond the build's, Redis PING, S3 HeadBucket; cached 2 s).
- Kernel schema `src/modules/kernel/schema/`: `core_accounts` (platform table, elx_app SELECT only), `core_schema_meta` (version for `/ready`). `drizzle.config.ts` globs `src/modules/*/schema/*.ts` into `drizzle/`.
- Migration runner trap: Drizzle's migrator compares only the journal `when` with the last applied row and silently skips a back-dated file; it never re-checks applied hashes. `packages/db/migrate` refuses both (edited/removed applied file, file older than the last applied) — regenerate a back-dated migration instead of forcing it.
- Tests: `*.test.ts` beside code (Vitest unit); `test/*.http.test.ts` HTTP tests with supertest; `test/integration/` and `test/schema/` run only via `vitest.integration.config.ts` (scratch database from `global-setup.ts`; helpers `integrationConfig()`, `connectAs(role)` in `support.ts`; scratch tables go in a throwaway schema, never `public`, and runtime roles cannot create temp tables); `test/architecture/` fixtures prove the dependency-cruiser rules.
- Database roles (ADR-0031): `elx_owner` (migrations), `elx_app` (RLS-scoped app pool), `elx_platform` (cross-tenant, `@CrossTenant()`), `elx_maintenance`. Never migrate the shared dev database from an executor.
- Upcoming shape (roadmap): PLAT-6 guard filling the `RequestContext` (`packages/db`) from the token, PLAT-8 outbox + BullMQ queues per kind, PLAT-10 `x-permission` enforcement.
