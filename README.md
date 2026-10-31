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
| `packages/config` | validated runtime configuration, the only code that reads environment variables (PLAT-4) |
| `packages/db`, `packages/ui` | placeholders for PLAT-5 and WEB-1 |
| `packages/config-ts`, `packages/config-eslint` | shared TypeScript and ESLint configuration |

Useful commands: `pnpm --filter api dev` (API on port 3000, `GET /health`), `pnpm --filter web dev`, `pnpm --filter driver start`, `pnpm --filter api test:architecture` (module boundary check), `pnpm --filter contracts lint`.

### Configuration

Every setting is an environment variable declared once in `packages/config` (schema, format, default) and read once at boot; nothing else reads the environment, and lint plus the architecture tests fail on a raw `process.env` (AGENTS.md). `.env.example` lists every variable with a comment. One file serves the service stack (below) and the API: as copied, it points the API at the Compose `dev` profile or the native stack, which share ports.

- Local: `cp .env.example .env` at the repository root. The API reads `.env` only when the process environment itself says `APP_ENV=local` (`pnpm --filter api dev` sets it; the file's own `APP_ENV` is ignored); variables already in the environment win. The web app (`NEXT_PUBLIC_*`) and the driver app (`EXPO_PUBLIC_*`) read their own files: put those lines in `apps/web/.env.local` and `apps/driver/.env`.
- A missing or malformed variable stops the API with exit code 78 and a list of every bad variable by name, never its value.
- `APP_ENV=production` refuses to start without the public web URL, the database URLs, Redis, storage, the signing key and the credentials keys, refuses any `stub` adapter, and needs a real messaging provider or `MESSAGING_DISABLED=true`. It also requires `rediss://` for Redis and `https://` for the storage and OTLP endpoints; plain `redis://` and `http://` are allowed only outside production, for the local stacks.
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

The smoke workflow `.github/workflows/compose-smoke.yml` runs these checks on every pull request that touches `compose.yaml` or `tools/`. The stub's own tests run with `node --test tools/whatsapp-stub/server.test.mjs`.

### Without Docker: the native stack

On a Mac without a container runtime, `tools/native-stack.sh` runs the same services from Homebrew, on the same dev ports and with the same `.env` (plan decision 2.9). It needs `postgresql@17`, `postgis`, `redis`, `minio`, `minio-mc` and `mailpit` from Homebrew, plus Node 22.

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
| `node` | `22.23.4-alpine` | runs the WhatsApp stub; same major as `.nvmrc` |

## Lineage

This product replaces the Delivery module and the WMS plan that lived inside `Marllow-git/eeasynew` until 2026-10-31. That code is reference material, not a dependency. The one eeasynew capability this product calls is the Eeasy shipping public API, for carrier shipments created at pack time.

## Working rules

Every change arrives as a pull request from a `docs/`, `feat/`, `fix/` or `chore/` branch. Nothing is committed to `main` directly. The owner merges. See `AGENTS.md`.
