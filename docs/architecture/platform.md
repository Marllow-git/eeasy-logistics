# Platform blueprint

Foundation document 6. Date: 2026-10-31. Status: for owner review. Governed by ADR-0003 (monorepo), ADR-0015 (storage first), ADR-0019 (PostgreSQL + PostGIS), ADR-0022 (containers on a Gulf host), ADR-0024 (outbox and queue).

## 1. Environments

| Environment | Purpose | Data | Who deploys |
|---|---|---|---|
| local | one developer or executor; Compose | seeded fixtures; a clone per isolated stack | the engineer |
| ci | per-PR ephemeral stack for integration tests and census | fixtures only | GitHub Actions |
| staging | owner acceptance, UAT, integrator sandbox | anonymised copy of production, refreshed weekly | CI on merge to `main` |
| production | merchants | real | owner-authorised promotion of a staging-verified image |

No environment shares a database, a Redis or a bucket with another. The development database is never migrated by an executor; isolated stacks use clones (handbook 03).

## 2. The stack as containers

| Service | Image | Notes |
|---|---|---|
| web | `apps/web` standalone Next.js build | serves merchant, admin and recipient pages; reads the API over the internal network and the public URL |
| api | `apps/api` NestJS | HTTP + SSE; stateless; horizontal |
| worker | same image as api, `--role worker` | BullMQ consumers, outbox relay, schedulers; scaled separately |
| postgres | PostgreSQL 16 + PostGIS | managed service in production where available; self-run in Compose |
| redis | Redis 7 | queues, rate limits, short caches; not a source of truth |
| vroom | official VROOM image | route optimisation; private network only |
| osrm | official OSRM image on a Saudi OpenStreetMap extract | distance-matrix fallback behind Hudhud; private network only; from wave 2 (integrations §6.5) (amended 2026-10-31, roadmap A-1) |
| storage | S3-compatible (MinIO in Compose, provider bucket in production) | proofs, labels, exports; signed URLs only |
| whatsapp-stub | small HTTP stub | local and ci only: records OTP and message sends for tests |
| mail-stub | Mailpit | local and ci only |

One `compose.yaml` with profiles `dev`, `ci`, `stack-a` and `stack-b` (two isolated port pairs so two executors can run censuses at once). Production uses the same images with a provider-specific compose or orchestrator file; no image is built differently for production.

## 3. Configuration and secrets

- Twelve-factor: every setting is an environment variable read once at boot by `packages/config`, validated with a schema; a missing or malformed value fails startup with the variable name. No raw environment reads elsewhere (AGENTS.md hard rule).
- Secrets live in the host's secret store (or an `.env` outside the repository locally); never in images, never in the repository; gitleaks runs in CI and as a pre-commit hook.
- Startup refuses production without: database, Redis, object storage, a signing key for tokens, a WhatsApp provider or an explicit `MESSAGING_DISABLED=true` for maintenance windows.
- Per-account third-party credentials (channel tokens, future payment keys) are encrypted at rest with a key from the secret store and a key-id column, so rotation never bricks stored credentials (an eeasynew APP_KEY rotation once killed every carrier credential).

## 4. Build and CI

Pull request pipeline, five required checks (handbook 03):

1. `typecheck-lint`: every workspace, Turborepo cached.
2. `api-test`: unit plus integration against the `ci` profile (PostgreSQL + Redis + stubs); migrations applied from zero; the tenancy schema test and the ledger trigger tests included; an RLS-enabled integration lane runs the integration suite with row-level security switched on (data §4.5) (amended 2026-10-31, roadmap A-6).
3. `web-build-census`: standalone build, isolated stack on the `ci` profile, Playwright census in `ar` and `en`; screenshots uploaded as artifacts.
4. `driver-test`: Expo typecheck and unit; EAS builds are manual.
5. `gitleaks`.

Images are built once per merge to `main`, tagged with the commit, scanned, pushed to the registry, and deployed to staging automatically. Production promotion re-tags the staging-verified image; nothing is rebuilt.

## 5. Deployment and migrations

- Rolling restart behind the reverse proxy; the API answers `GET /health` (liveness) and `GET /ready` (database, Redis, storage reachable; migrations at expected version).
- Migrations run as a one-shot job before the new API starts, expand-and-contract: a PR may add columns, tables and backfills; a destructive step (drop, rename, type narrowing) ships in a later PR after the code that stopped using the old shape is in production. Merge danger for any migration PR is one-way door.
- Rollback: redeploy the previous image; because of expand-and-contract the previous code still runs on the new schema.
- Workers drain in-flight jobs on SIGTERM with a 30-second grace; the outbox relay is single-leader by Redis lock.

## 6. Data protection

- Daily full backups plus continuous WAL archiving to a bucket in a second region of the same provider; retention 35 days; a restore drill into staging every month, recorded in the ops log.
- Object storage versioning on; proofs retained per the account's policy (default two years) then deleted by a scheduled job that writes an audit row.
- PII inventory kept in the data architecture document; exports and deletion requests served per account by a platform admin tool.

## 7. Observability

- OpenTelemetry SDK in api and worker: traces (HTTP, database, queue, outbound HTTP), metrics (request latency, queue depth, outbox age, ledger assertion drift, OTP failure rate, SSE connections), structured JSON logs with request id and account id.
- Sentry for exceptions in api, worker, web and driver app, with release tags from the image tag.
- PostHog for product analytics in web and driver app, no PII beyond ids.
- Alerts, routed to the owner's channel: `/ready` failing; p95 API latency above 800 ms for 5 minutes; outbox oldest unsent row older than 5 minutes; any dead-lettered job; nightly ledger assertion not green; OTP failure rate spike; disk and backup job failures.

## 8. Edge and network

- Cloudflare in front of web and api: TLS, WAF, rate limiting as a coarse layer, bot rules off for the driver API routes. Origin accepts only Cloudflare ranges.
- Security headers on every response: HSTS preload, `X-Frame-Options: DENY` except the recipient pages (which may be embedded by merchants' storefronts under a per-account allowlist), `nosniff`, a CSP that lists the API origin and the storage domain only.
- Internal services (postgres, redis, vroom) on a private network with no public ports.

## 9. Runbooks (written as the pieces land)

Provision an account · rotate token signing key · rotate the credentials key · restore from backup · drain and redeploy workers · replay a dead-lettered outbox row · revoke a driver device · pause messaging · switch a rollout mode · monthly restore drill · replay an inbound webhook · rotate a channel token · re-sync channel stock · rebuild projections · reset the stock-summary cursor after a logical restore (integrations §10, data §3.3, §3.5) (amended 2026-10-31, roadmap A-8).

## 10. Open decisions

1. Provider: a Saudi or Bahraini region with managed PostgreSQL (preferred) versus self-run PostgreSQL on a VPS. Decide in wave 0 after a quote; the architecture is identical.
2. Web on the same host versus an edge platform later: deferred; the standalone build supports both.
3. Registry: GitHub Container Registry (proposed).
