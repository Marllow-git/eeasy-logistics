# eeasy-logistics

Standalone last-mile delivery and warehouse (WMS) product for merchants that run their own drivers and their own stock. Built as one monorepo: Next.js web app, NestJS API, Expo driver app.

**Current phase: wave 0, foundation.** The owner approved the foundation package on 2026-10-31 (`docs/README.md`); the roadmap (`docs/roadmap.md`) orders the build. Application code lands order by order under `docs/orders/`.

## Layout

| Path | Holds |
|---|---|
| `adr/` | Architecture decision records, one decision per file, numbered. `adr/README.md` is the index. |
| `docs/handbook/` | How we work: workflow, definition of done, testing, conventions. `AGENTS.md` at the root is the short form every agent and engineer reads first. |
| `docs/architecture/` | Domain model, data architecture, platform blueprint, web, driver app and integration architecture (arrive as later PRs). |
| `docs/contracts/` | OpenAPI documents and the webhook event catalogue (arrive as later PRs). |
| `docs/references/` | Reference-product censuses: Logestechs, OTO Flex, Bolesa (arrive as later PRs). |

## Development

Requirements: Node 24 LTS (`.nvmrc`) and pnpm 10 through Corepack.

```sh
corepack enable          # once per machine; pins pnpm from package.json "packageManager"
pnpm install
pnpm turbo run typecheck lint test build   # the local gate; CI runs more (section CI)
```

| Path | Holds |
|---|---|
| `apps/api` | NestJS API; contexts `kernel`, `delivery`, `wms` under `src/modules/` (ADR-0026) |
| `apps/web` | Next.js App Router web app (merchant, recipient, auth route groups) |
| `apps/admin` | Next.js App Router platform console on its own hostname (platform, auth route groups; ADR-0038) |
| `apps/driver` | Expo driver app with Expo Router (ADR-0021) |
| `packages/contracts` | OpenAPI lint now; generated clients later (PLAT-15) |
| `packages/i18n` | Arabic and English catalogues and the typed `t()` helper |
| `packages/config` | validated runtime configuration, the only code that reads environment variables (PLAT-4) |
| `packages/db`, `packages/ui` | placeholders for PLAT-5 and WEB-1 |
| `packages/config-ts`, `packages/config-eslint` | shared TypeScript and ESLint configuration |

Useful commands: `pnpm --filter api dev` (API on port 3000, `GET /health`), `pnpm --filter web dev`, `pnpm --filter admin dev` (port 3002), `pnpm --filter driver start`, `pnpm --filter api test:architecture` (module boundary check), `pnpm --filter contracts lint`.

### Configuration

Every setting is an environment variable declared once in `packages/config` (schema, format, default) and read once at boot; nothing else reads the environment, and lint plus the architecture tests fail on a raw `process.env` (AGENTS.md). `.env.example` lists every variable with a comment. One file serves the service stack (below) and the API: as copied, it points the API at the Compose `dev` profile or the native stack, which share ports.

- Local: `cp .env.example .env` at the repository root. The API reads `.env` only when the process environment itself says `APP_ENV=local` (`pnpm --filter api dev` sets it; the file's own `APP_ENV` is ignored); variables already in the environment win. The web app (`NEXT_PUBLIC_*`) and the driver app (`EXPO_PUBLIC_*`) read their own files: put those lines in `apps/web/.env.local`, `apps/admin/.env.local` and `apps/driver/.env`.
- A missing or malformed variable stops the API with exit code 78 and a list of every bad variable by name, never its value.
- `APP_ENV=production` refuses to start without the public web and admin URLs, the database URLs, Redis, storage, the signing key and the credentials keys, refuses any `stub` adapter, and needs a real messaging provider or `MESSAGING_DISABLED=true`. It also requires `rediss://` for Redis and `https://` for the storage and OTLP endpoints; plain `redis://` and `http://` are allowed only outside production, for the local stacks.
- `ci`, `staging` and `production` never read `.env`; their values come from the environment or the host's secret store.

## Running the stack

The services the apps need run in containers from one `compose.yaml` (PLAT-2; ADR-0019, ADR-0022, ADR-0010, ADR-0015). The apps run on the host and connect to them. Requirements: Docker with Compose v2.

```sh
cp .env.example .env                               # once; local placeholders only, .env is gitignored
docker compose --profile dev up -d --wait          # start the dev stack and wait until every service is healthy
docker compose --profile dev down                  # stop it (add -v to delete its data)
```

| Profile | Started with | Host ports | Data |
|---|---|---|---|
| `dev` | `docker compose --profile dev up -d --wait` (project `elx`) | the table below | named volumes |
| `ci` | `COMPOSE_PROJECT_NAME=elx-ci docker compose --profile ci up -d --wait` | random; `docker compose port <service>-ci <port>` | tmpfs, gone on stop |
| `stack-a` | `tools/stack.sh up a` (project `elx-stack-a`) | dev +100 | own volumes |
| `stack-b` | `tools/stack.sh up b` (project `elx-stack-b`) | dev +200 | own volumes |

Run each profile under its own project name, as above: a profile shares the file with the others, and `down -v` acts on the whole project. In the `ci` and stack profiles the service names have a suffix: `postgres-ci`, `postgres-a`, `postgres-b`.

| Service | dev port (127.0.0.1) | What it is |
|---|---|---|
| `postgres` | 5432 | PostgreSQL 16 + PostGIS. Database `elx`, roles `elx_owner`, `elx_app`, `elx_platform`, `elx_maintenance` (data §4.4), extensions `postgis`, `citext`, `pgcrypto` (`tools/postgres/init/`) |
| `redis` | 6379 | Redis 7 |
| `vroom` | 3030 | VROOM route optimiser. Its routing server is set by `OSRM_HOST`/`OSRM_PORT`, which stay unset until OSRM arrives (INT-5) |
| `minio` | 9000 (S3), 9001 (console) | S3-compatible storage; `minio-init` creates the versioned bucket `MINIO_BUCKET` (`elx-local`) |
| `mailpit` | 8025 (UI and API), 1025 (SMTP) | catches all outgoing mail |
| `whatsapp-stub` | 8080 | records every `POST`; `GET /sent` lists them, `DELETE /sent` clears them; header `x-stub-fault` simulates outages (`tools/whatsapp-stub/server.mjs`) |

Isolated stacks (handbook 03): `tools/stack.sh up a`, then `tools/stack.sh clone a` creates the database `elx_stack_a` from the template `elx_seed` once PLAT-5 builds it (until then an empty database), `tools/stack.sh ports a` lists the ports, and `tools/stack.sh down a` deletes the stack with its data. Stacks `a` and `b` can run at the same time.

Checks, with the dev stack up:

```sh
docker compose exec postgres psql -U postgres -d elx -c '\du elx_*' -c '\dx'
curl -s -X POST localhost:8080/v1/messages -H 'content-type: application/json' -d '{"to":"+966500000000"}'
curl -s localhost:8080/sent
docker compose exec minio-init mc version info local/elx-local
```

The `api-test` and `web-build-census` CI jobs start the `ci` profile on every pull request (section CI). The stub's own tests run with `node --test tools/whatsapp-stub/server.test.mjs`.

### Without Docker: the native stack

On a Mac without a container runtime, `tools/native-stack.sh` runs the same services from Homebrew, on the same dev ports and with the same `.env` (plan decision 2.9). It needs `postgresql@17`, `postgis`, `redis`, `minio`, `minio-mc` and `mailpit` from Homebrew, plus Node 24.

```sh
cp .env.example .env              # if not done already
tools/native-stack.sh up          # start, create roles, extensions and the versioned bucket
tools/native-stack.sh status
tools/native-stack.sh down        # stop what up started; data is kept in .local/native-stack
tools/native-stack.sh reset       # down, then delete the data and the elx database and roles up created
```

- PostgreSQL: if 5432 is free, `up` starts its own cluster in `.local/native-stack/postgres` (superuser `postgres` with `POSTGRES_PASSWORD`). If your own PostgreSQL already answers on 5432, `up` creates the database `elx` and the four roles in it instead. It needs a superuser login over 127.0.0.1 (your OS user by default; set `ELX_NATIVE_PG_ADMIN` to use another). `template1` and every other database stay untouched, and `up` refuses to run if an `elx` database it did not create already exists.
- Redis: a server already on 6379 is reused and never stopped. If there is none, `up` starts one.
- MinIO, Mailpit and the WhatsApp stub run as background processes, with their data and logs under `.local/native-stack/`. For `mc`, set `MC_CONFIG_DIR=.local/native-stack/mc` to use the alias `local`.
- There is no VROOM here. Use the Compose stack or CI for it.
- Known differences from Compose and CI, accepted until a container runtime is installed: PostgreSQL 17 instead of 16 (ADR-0019 governs CI and production), Homebrew's MinIO (the last upstream build) instead of the `pgsty/silo` fork, and whatever Redis version is running (8 on this machine) instead of 7.

Images, checked on 2026-10-31 against Docker Hub and GHCR:

| Image | Tag | Note |
|---|---|---|
| `postgis/postgis` | `16-3.6` | PostgreSQL 16, PostGIS 3.6. Built for amd64 only, so it runs emulated on Apple silicon |
| `redis` | `7.4.12-alpine` | latest Redis 7 (platform §2 pins major 7) |
| `ghcr.io/vroom-project/vroom-docker` | `v1.15.0` | latest release |
| `pgsty/silo` | `RELEASE.2026-10-26T00-00-00Z` | MinIO server. Upstream MinIO now ships source only: `minio/minio` is gone from Docker Hub and the GitHub repository is archived. Silo is the maintained community fork, compatible with MinIO (`MINIO_*` settings, S3 API, `mc`) |
| `pgsty/mc` | `RELEASE.2026-10-26T00-00-00Z` | the `mc` client for the bucket bootstrap, from the same fork |
| `axllent/mailpit` | `v1.33.0` | latest release |
| `node` | `24.22.2-alpine` | runs the WhatsApp stub; same major as `.nvmrc` |

## Database

PostgreSQL with PostGIS, one database, schema `public`, tables prefixed by context (`core_`, `del_`, `wms_`; data architecture §1). Order PLAT-5; ADR-0019, ADR-0020, ADR-0025, proposed ADR-0031.

- **Roles.** Four roles, each for one duty (ADR-0031, data §4.4): `elx_owner` owns every object and is used only by the migration job and the worker's audit partition job; `elx_app` is the API and worker pool for tenant work; `elx_platform` is the cross-tenant pool (platform module and worker system jobs only); `elx_maintenance` is for the per-account deletion tool (no pool yet). The runtime roles own nothing, hold `SELECT, INSERT, UPDATE, DELETE` on operational tables and only `SELECT, INSERT` on append-only tables, so they can neither change a ledger row nor disable a trigger. Each role has its own URL in `.env` (`DATABASE_URL_OWNER`, `_APP`, `_PLATFORM`, `_MAINTENANCE`), read through `packages/config` only.
- **Migrations.** Reviewed SQL in `apps/api/drizzle/`, each file with a `-- reviewed` header. Schema files live in `apps/api/src/modules/<context>/schema/`; `pnpm --filter api exec drizzle-kit generate --name=<slug>` writes the SQL, which is reviewed and may be hand-edited; triggers, policies and grants are custom migrations (`--custom`). `pnpm --filter api migrate` (the image's `--role migrate`) applies them as `elx_owner` under an advisory lock, refuses an edited or reordered history, records the version in `core_schema_meta`, and exits 0 when nothing is pending. Expand and contract: a destructive step ships in a later PR (data §11). Every migration PR is a one-way door.
- **Tenancy.** Every operational table carries `account_id` with a foreign key and a leading index, and the `tenant_isolation` and `platform_access` policies from its first migration; `apps/api/test/schema/tenancy.test.ts` fails CI otherwise, and `exemptions.ts` lists the exceptions. Tenant work runs in `withUnitOfWork` (`packages/db`), which sets `elx.account_id` transaction-locally; `ScopedRepository` adds the account predicate to every statement.
- **Row-level security.** Policies exist from wave 0 but RLS stays disabled (data §4.5) unless the migration job runs with `ELX_RLS=on`, as the `api-test-rls` lane does.
- **Append-only tables.** A migration calls `SELECT core_make_append_only('<table>')` (both triggers, no mutating grants) and lists the table in `exemptions.ts`; any update, delete or truncate raises SQLSTATE `EL001`.
- **Readiness.** `GET /ready` checks the `elx_app` pool, the schema version, Redis and the storage bucket, and answers 503 with the failing check names only.

Local commands (`APP_ENV=local`, `.env` from `.env.example`):

```sh
tools/native-stack.sh migrate               # or: APP_ENV=local pnpm --filter api migrate
APP_ENV=local pnpm --filter api seed        # two fixture accounts, idempotent
APP_ENV=local pnpm --filter api seed --template   # rebuild elx_seed for tools/stack.sh clone
APP_ENV=local pnpm --filter api test:integration  # scratch database per run, dropped afterwards
```

`seed --template` and the integration suite need `DATABASE_URL_ADMIN`, a superuser for local and ci tooling only (staging and production refuse it). With the native stack in database mode that is your own login, for example `DATABASE_URL_ADMIN=postgres://$(id -un)@127.0.0.1:5432/postgres`. The suite never migrates the development database `elx`.

## Request pipeline

Every API request runs through one frame in `apps/api/src/modules/kernel/` (order PLAT-6; ADR-0025, ADR-0031, ADR-0032, ADR-0038; contracts README §3, §4, §7, §9). In order:

1. **Request id** (`request/request-id.ts`, middleware, first): keeps an incoming `X-Request-Id` only when it is a UUID, else mints a UUIDv7; sets it on the response and on every log line.
2. **Tenancy guard** (`tenancy/tenancy.guard.ts`, global): every route is authenticated unless `@Public()`. The surface comes from the path (`/v1/<surface>`), the principal from that surface's credential only (`el_staff_at` and `el_platform_at` cookies, the driver's bearer token; recipient and public answer 401 until their verifiers land); the account comes from the token, never from a path, query, header or body. The same guard charges the **rate limit** (`rate-limit/`, contracts README §7): a fixed one-minute window in Redis per user, device or, for public routes and refused credentials, client address (`request.ip`, believed through `X-Forwarded-For` only to `TRUST_PROXY_HOPS` proxies: one, Cloudflare, in production); `RateLimit-Limit`, `-Remaining` and `-Reset` on every limited response, `429 rate_limited` with `Retry-After` over budget; a Redis outage fails open with a warning.
3. **Web client marker and JSON only** (`request/web-client.guard.ts`, `request/content-type.guard.ts`, global): staff and platform writes need `X-EL-Client: web` and the `Origin` of their own application (`PUBLIC_WEB_URL` for staff, `PUBLIC_ADMIN_URL` for the console), else `403 forbidden`; a body that is not JSON is `400 validation_failed` (the API parses JSON only, routes case-sensitively and strictly, and takes every surface from the matched route, never the raw path).
4. **Unit of work** (`tenancy/unit-of-work.interceptor.ts`, the first interceptor): one transaction per authenticated request, on `elx_app` for staff and driver with `elx.account_id` from the token, on `elx_platform` for platform. `@CrossTenant()` platform handlers need `X-Support-Reason`, open the target account on the platform pool and leave one committed `core_audit_log` row for every attempt (see "Audit log"). Commit on 2xx, rollback otherwise; handlers and repositories read `getUnitOfWork()` and `getContext()`; once the transaction settles the unit of work is closed and a late statement throws `UnitOfWorkClosedError`.
5. **Idempotency** (`idempotency/`, `@Idempotent()` on retryable writes): reserves `Idempotency-Key` per principal in the same transaction; a replay returns the stored answer with `Idempotency-Replayed: true`, a different body `422 idempotency_key_reused`, a running one `409 idempotency_in_progress`.
6. **Contract input** (`contract/contract-pipe.ts`, global pipe): a handler binds its operation with `@Operation(operationSchemas.<operationId>)` from the server-safe `@eeasy-logistics/contracts/<surface>/schemas` entry and takes `@Input()`; path, query, declared headers and body are parsed with the generated strict schemas, failures are `400 validation_failed` with `details.fields[]` JSON pointers. The handler returns the operation's generated response type (a presenter maps domain rows to it).
7. **Errors** (`errors/exception.filter.ts`, global): every non-2xx answer is the contract `Error` schema with `request_id` and a message in the caller's `Accept-Language` (`ar` default); no stack, query or input value ever leaves.

Guards run before every interceptor, so a refused request opens no transaction and reserves no key. `apps/api/.dependency-cruiser.cjs` keeps contract types in `*.controller.ts` and `*.presenter.ts` files and forbids DTO files and validation libraries (A-17).

Operational notes:

- Routing is case-sensitive and strict: `/health/` and `/ready/` answer 404, so probes and the edge use the exact paths.
- The idempotency request hash is an HMAC under a key derived from `AUTH_SIGNING_KEY`: rotating the key changes every hash, so a client retrying across a rotation with the same `Idempotency-Key` gets `422 idempotency_key_reused` (keys live 24 h).
- Access tokens must carry the header `typ: at+jwt` and an `iat` no more than 60 s in the future; PLAT-11's issuer sets both.

## Design system

Both web apps render through `packages/ui` (order WEB-1; ADR-0016, ADR-0033, ADR-0038 bullet 5; web §5, §6, §10.2, §11):

- **Tokens** in `packages/ui/src/tokens.css`, a Tailwind CSS 4 `@theme` block (semantic colours, type scale with separate Arabic and Latin line heights, spacing, radius, elevation, motion) plus one `--status-<machine>-<state>` colour per order, offer, attempt and custody state. `pnpm --filter ui test` checks WCAG 2.2 AA contrast over the file. Light theme only.
- **Components** in `packages/ui/src/components/<name>/<name>.tsx` on Radix (`radix-ui`), imported one path each: `@eeasy-logistics/ui/components/<name>`. Every component has a test in `rtl` and `ltr`. State lists for `StatusChip` come from `@eeasy-logistics/contracts/unions`.
- **Logical CSS only.** `@eeasy-logistics/config-eslint`'s `logicalCss` config rejects physical-direction utilities (`ml-4`, `text-left`, `rounded-r-md`…) in `className`, `cn(`, `cva(` and `tv(` and names the logical replacement (`ms-4`, `text-start`, `rounded-e-md`).
- **Shell** in `packages/ui/src/shell/`: `RootHtml` (`<html lang dir>` from the `el_locale` cookie, Arabic by default; the IBM Plex Sans Arabic woff2 files of `packages/ui/fonts/`, self-hosted with `next/font/local`; the next-intl client provider with only the namespaces the group renders; Radix direction), `LocaleSwitch`, and `shellRequestConfig`, the next-intl request config each app's `src/i18n/request.ts` exports. `AppShell` is the frame: grouped navigation on the start side (right in Arabic) with an account block, a top bar with the locale switch, a sheet below `md`. Each route group keeps its own root layout (web §1.2).
- **Strings** in `packages/i18n/<locale>/<namespace>.json` (`common`, `nav`, `auth`, `errors`, `recipient`), typed from the Arabic catalogue so a missing key fails typecheck; the `platform` namespace lives only in `apps/admin/messages/<locale>/` (ADR-0038). The parity test (`pnpm --filter i18n test`) covers both roots. Dates, numbers, money and phone numbers go through `packages/i18n/src/format.ts` (Gregorian, Western digits, `Asia/Riyadh`).
- **Checks**: each app's census (`tests/census-shell.spec.ts`: `ar` at 1440 and 390 px, `en` at 1440 px; locale, digits, raw keys, overflow, axe, headers, screenshot baselines) and the first-load JavaScript budget (`apps/web/scripts/check-budget.ts`, run by both apps as `check:budget` after `next build`). Both run in the `web-build-census` and `admin-build-census` lanes below.

## Audit log

`core_audit_log` (order PLAT-7; data §2.1, §3.1, §10; identity and tenancy §7; ADR-0029, ADR-0031) holds who did what to which target, the redacted state before and after, why, and in which request. It is append-only and partitioned by month on `occurred_at`.

- **Immutable.** The runtime roles hold `SELECT, INSERT` on the parent and nothing on any partition; the append-only row trigger is cloned onto every partition and stops even the owner (`EL001`). The schema test fails on a partition grant. The only removal is dropping a partition past the retention.
- **Partitions.** Migration 0006 and every migrate run keep the current month and the next three (`core_ensure_audit_partitions`); the worker's daily partition job (lock `elx:lock:audit-partitions`) does the same and drops partitions older than `AUDIT_RETENTION_MONTHS` (24 to 120, default 24) with `core_drop_audit_partitions_before`, which refuses any cutoff inside 24 months. Each drop is audited (`platform.audit_partition.dropped`). A DEFAULT partition, `core_audit_log_default`, catches a row whose month has no partition; it should stay empty, the job warns when it is not, and retention does not drop its rows. The job runs as `elx_owner`, the only worker use of `DATABASE_URL_OWNER` (allowed while `AUDIT_PARTITION_JOB=on`; lint and dependency rules keep the URL in the two owner jobs).
- **Writing.** Inject `AUDIT_SINK` (`AuditWriter`). `record(event)` writes in the current unit of work, so the row commits or rolls back with the action; `recordCommitted(event)` writes on a transaction of its own (`@eeasy-logistics/db/committed`, allowed only in `modules/kernel/audit/`), for refusals that must survive the request's rollback. Actions are `<module>.<object>.<verb>` in the past tense. `before`, `after` and `reason` are redacted first: keys whose tokens (split on `_`, `-`, `.` and camelCase) name a secret (password, secret, token, pin, otp, key, credential, cookie, authorization, ciphertext) become `"[redacted]"`, strings stop at 2,000 characters, a document over 32 KB is replaced by its size.
- **Cross-tenant calls.** Every `@CrossTenant()` attempt leaves one row: `platform.cross_tenant.refused` (no account, outcome `reason_missing`, `reason_invalid` or `not_found`, committed on its own) or `platform.cross_tenant.accessed` (the account and the status; `outcome: ok` written inside the request transaction, so it commits with the handler's effect; `outcome: failed` committed on its own after a rollback).
- **Reading.** `GET /v1/staff/audit-log` (`listAuditLog`, the token's account), `GET /v1/platform/accounts/{account_id}/audit-log` (through the door) and `GET /v1/platform/audit-log` (the platform's own rows; with `account_id`, through the door on that query parameter). Newest first (`sort=-occurred_at`, or `occurred_at`), keyset cursors signed under a key derived from `AUTH_SIGNING_KEY`, valid 24 h and only with the same filters and sort. Permission checks (`x-permission`) arrive with PLAT-10.

## CI

GitHub Actions, two workflows (PLAT-3; platform §4, handbook 03):

| Workflow | Runs on | Jobs |
|---|---|---|
| `.github/workflows/pr.yml` | every pull request | the seven required checks below |
| `.github/workflows/main.yml` | push to `main`; pull requests as a dry run | per image: build, run probe, Trivy scan, push to GHCR (push to `main` only). The PR checks are not re-run on `main` (owner ruling 2026-11-01): the merge gate requires them green on the exact head merged |

| Check | What it runs | Locally |
|---|---|---|
| `typecheck-lint` | `pnpm turbo run typecheck lint` (every workspace, contracts Redocly lint included) and `pnpm format:check` | the same commands |
| `api-test` | the Compose `ci` profile, `pnpm --filter api migrate` then `seed` (the ci services' URLs exported from their random ports), `test:unit`, `test:integration`, `test:architecture`, with `APP_ENV=ci` | `APP_ENV=local pnpm --filter api test` (unit and architecture) and `APP_ENV=local DATABASE_URL_ADMIN=… pnpm --filter api test:integration` against the native stack (README "Database") |
| `api-test-rls` | the same with `ELX_RLS=on` (A-6; data §4.5) | as above with `ELX_RLS=on` |
| `web-build-census` | builds the API and the standalone web app, checks the first-load JavaScript budget per route (`check:budget`, web §10.2: route JavaScript above the shared framework chunk, recipient 90 KB gzip, merchant, platform and sign-in 180 KB; the framework chunk capped at 135 KB), starts both against the `ci` profile, runs the census (`tests/census.config.ts`: projects `ar` at 1440 and 390 px, `en` at 1440 px; locale, axe and security assertions; screenshot baselines per platform in `tests/census/__screenshots__`); screenshots and logs are the job's artifact `web-build-census` | `pnpm --filter web build && pnpm --filter web start -p 3001`, then `pnpm --filter web check:budget` and `pnpm --filter web test:census` (first time: `pnpm --filter web exec playwright install chromium`; after a deliberate visual change: `--update-snapshots`, then review the Arabic images) |
| `admin-build-census` | the same for the platform console (ADR-0038): builds the API and the standalone admin app, checks its budget with the same script, starts both (admin on 3002), runs the same census harness (`apps/admin/tests/census.config.ts`, a copy of the web one; baselines in `apps/admin/tests/census/__screenshots__`); artifact `admin-build-census`. The contract tests run in `web-build-census` only | `pnpm --filter admin build && pnpm --filter admin start` (port 3002), then `pnpm --filter admin check:budget` and `pnpm --filter admin test:census` (`--update-snapshots` after a deliberate visual change, then review the Arabic images) |
| `driver-test` | typecheck, lint and Jest of `apps/driver`, then `expo-doctor` | `pnpm --filter driver test`, `pnpm --filter driver run doctor` |
| `gitleaks` | gitleaks over the full history with `.gitleaks.toml` | the pre-commit hook below |

Integration tests that need the stack go in `apps/api/test/integration/` (run by `test:integration`); `test:unit` runs the rest. Turborepo's cache is kept in the GitHub Actions cache per job; test runs against the stack never come from that cache. Jobs time out after 20 minutes, `web-build-census` and `admin-build-census` after 30; a newer push to a pull request cancels the older run.

Images (`main.yml`): `apps/api/Dockerfile` (one image, `--role api|worker|migrate`, default `api`), `apps/web/Dockerfile` and `apps/admin/Dockerfile` (Next.js standalone, `PORT` 3000), all built from the repository root, for example `docker build -f apps/api/Dockerfile .`. On `main` they are pushed to `ghcr.io/marllow-git/eeasy-logistics/api`, `.../web` and `.../admin`, tagged `sha-<commit>` and `main`, after a non-root check, a run probe and a Trivy scan that fails on a fixable critical vulnerability. Deployment to staging is OPS-1's.

Secret scanning: `pnpm install` installs a pre-commit hook (simple-git-hooks, root `package.json`) that runs `gitleaks` on the staged changes and blocks the commit on a finding. It needs the gitleaks binary (`brew install gitleaks`). `.gitleaks.toml` excuses only `.env.example`, whose values are local placeholders.

Required checks on `main`: branch protection needs GitHub Pro or Team for a private repository (the API answers 403 on the Free plan, checked 2026-10-31). Once the plan allows it, an admin runs:

```sh
gh api -X PUT repos/Marllow-git/eeasy-logistics/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": false,
    "checks": [
      { "context": "typecheck-lint", "app_id": 15368 },
      { "context": "api-test", "app_id": 15368 },
      { "context": "api-test-rls", "app_id": 15368 },
      { "context": "web-build-census", "app_id": 15368 },
      { "context": "admin-build-census", "app_id": 15368 },
      { "context": "driver-test", "app_id": 15368 },
      { "context": "gitleaks", "app_id": 15368 }
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
gh api repos/Marllow-git/eeasy-logistics/branches/main/protection/required_status_checks   # shows the seven
```

`app_id` 15368 is GitHub Actions, so only an Actions job can satisfy a check of that name. `enforce_admins: false` keeps the owner's merge habit unchanged (decision 2.9).

## Lineage

This product replaces the Delivery module and the WMS plan that lived inside `Marllow-git/eeasynew` until 2026-10-31. That code is reference material, not a dependency. The one eeasynew capability this product calls is the Eeasy shipping public API, for carrier shipments created at pack time.

## Working rules

Every change arrives as a pull request from a `docs/`, `feat/`, `fix/` or `chore/` branch. Nothing is committed to `main` directly. The owner merges. See `AGENTS.md`.
