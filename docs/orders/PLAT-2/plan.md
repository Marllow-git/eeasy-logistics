# PLAT-2 · Compose profiles

- **Status:** planned (starts after PLAT-1 merges; rebase this branch onto main then)
- **Date:** 2026-10-31
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-1.
- **Lead:** architecture lead. **Executor:** Opus, own worktree. **Adversary:** no.

## 0. Goal

One `compose.yaml` runs the full local stack and the CI stack, and two executors can run isolated stacks side by side, so that every later order has a real PostgreSQL + PostGIS, Redis, VROOM, MinIO and the WhatsApp and mail stubs to test against (handbook 03: never a mock database).

## 1. Binding rules and ADRs

- ADR-0019 (PostgreSQL 16 + PostGIS), ADR-0022 (containers; Compose for development and CI), ADR-0010 (VROOM container beside the API), ADR-0015 (object storage before first use).
- Platform blueprint §1 (environments; no shared database between stacks), §2 (the service list and the four profiles `dev`, `ci`, `stack-a`, `stack-b`), §3 (configuration: every setting an environment variable; no secrets in the repository, `.env.example` only).
- Data architecture §11.7 (clone-per-stack: a seeded template database cloned per isolated stack), handbook 03 (isolated stacks, two port pairs).
- Integration architecture §9 (stubs are adapters: the WhatsApp stub records sends; Mailpit for mail; MinIO with versioning on).

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Images | `postgis/postgis:16-3.4` (or the current 16 tag), `redis:7-alpine`, `ghcr.io/vroom-project/vroom-docker` (current), `minio/minio` + `minio/mc` for bucket bootstrap, `axllent/mailpit`; the WhatsApp stub is a tiny Node HTTP server in `tools/whatsapp-stub/` that records every request to a JSON log and exposes `GET /sent` |
| 2.2 | Profiles | `dev` (ports 5432, 6379, 3000, 9000/9001, 8025, 8080-stub), `ci` (same services, random host ports, tmpfs data), `stack-a` and `stack-b` (second and third port pairs: +100 and +200), chosen with `--profile` and `COMPOSE_PROJECT_NAME` |
| 2.3 | Database bootstrap | an init script creates the `elx_owner`, `elx_app`, `elx_platform`, `elx_maintenance` roles with local-only passwords from `.env.example` and the extensions `postgis`, `citext`, `pgcrypto`; the `elx_seed` template database is PLAT-5's, this order only reserves the name in the script |
| 2.4 | Clone-per-stack | `tools/stack.sh up|down|clone <a|b>`: starts a profile, and `clone` creates `elx_<stack>` from the template with `CREATE DATABASE … TEMPLATE elx_seed` once PLAT-5 provides it (until then it creates an empty database) |
| 2.5 | VROOM | the container runs with a config pointing at an OSRM endpoint variable that is unset in wave 0 (OSRM is INT-5's, platform A-1); the health check only proves the container starts |
| 2.6 | Secrets | `.env.example` with every variable the stack needs and placeholder values; `.env` is gitignored; gitleaks is PLAT-3's |
| 2.7 | Apps in Compose | the api, worker and web images are NOT built in this order; the apps run on the host against the Compose services (platform §2 production parity is PLAT-3's image build) |
| 2.8 | Verification without local Docker (ruled 2026-10-31) | the exit criteria run in a GitHub Actions smoke workflow `.github/workflows/compose-smoke.yml` on ubuntu-latest, triggered on pull requests that touch `compose.yaml`, `tools/` or the workflow; PLAT-3 replaces it with the full lanes |
| 2.9 | Native local stack (owner ruling 2026-10-31) | `tools/native-stack.sh up\|down\|status\|reset` runs the dev services from Homebrew on this Mac on the `dev` ports with the same `.env`: PostgreSQL 17 + PostGIS through the same `tools/postgres/init/*.sql`, in a dedicated cluster under `.local/` when 5432 is free, else as the `elx` database and four roles inside the developer's running server (template1 and other databases untouched; `reset` drops only what `up` created); a running Redis on 6379 is reused, else one is started; MinIO with the versioned bucket via `mc`; Mailpit; the WhatsApp stub under `node`. No VROOM natively. All state under `.local/` (gitignored). Known, accepted difference until the owner installs a container runtime: PostgreSQL 17 and upstream MinIO locally versus PostgreSQL 16 and the pgsty fork in Compose and CI; ADR-0019 governs CI and production |

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | `compose.yaml` with the services and the four profiles, health checks on every service | `docker compose --profile dev up -d` all healthy |
| B | `tools/postgres/init/*.sql` roles and extensions | `psql` shows four roles and three extensions |
| C | `tools/whatsapp-stub/` | a `POST` is listed by `GET /sent` |
| D | MinIO bootstrap job: bucket `elx-local` with versioning | `mc ls` shows it |
| E | `tools/stack.sh` and the two isolated profiles | `stack-a` and `stack-b` up at the same time, different ports |
| F | `.env.example`, README "Running the stack" | fresh clone follows the README to a healthy stack |
| G | `.github/workflows/compose-smoke.yml` (decision 2.8) | the workflow run on the PR is green: every exit criterion asserted |
| H | `tools/native-stack.sh` (decision 2.9) | on this Mac: roles and extensions via `psql`, stub round trip, `mc` shows the versioned bucket, Mailpit answers, `down` leaves no process |

## 4. Commit plan

One commit per item, `PLAT-2: <item>`.

## 5. Exit criteria

- `docker compose --profile dev up -d` reaches healthy for all services on a clean machine with Docker installed.
- `stack-a` and `stack-b` run concurrently with distinct ports and separate volumes.
- The `ci` profile starts with tmpfs volumes and no fixed host ports.
- Four roles and `postgis`, `citext`, `pgcrypto` exist in the database.
- The WhatsApp stub records and lists sends; MinIO has a versioned bucket; Mailpit is reachable.

## 6. Not in this order

CI workflows (PLAT-3), except the smoke workflow of 2.8, the config module (PLAT-4), any schema, migration or seed (PLAT-5), app images, OSRM, production compose.

## 7. Owner questions

None.

## 8. Rulings during the build

- 2026-10-31, MinIO image: upstream `minio/minio` is archived and its images are gone from Docker Hub and Quay (checked by the lead). The maintained fork `pgsty/silo` (with `pgsty/mc`) is accepted for `local` and `ci` only, pinned by digest in `compose.yaml`; production uses the provider bucket (platform §2). Recorded as roadmap amendment A-15 for ADR-0015 and integrations §9 wording.
- 2026-10-31, service names: one Compose file cannot repeat a service name, so the `ci`, `stack-a` and `stack-b` profiles use suffixed names; the `ci` command is unchanged through `COMPOSE_PROJECT_NAME`.
- 2026-10-31, VROOM host port 3030 (3130, 3230) because the API uses 3000.
