# Backend library census, November 2026

- **Date of research:** 2026-11-01 (all facts read that day unless a source line gives another date)
- **Asked by:** lead, for the eeasy-logistics NestJS API
- **Branch:** `docs/research-stack-alternatives` (note only; nothing else written, nothing committed)
- **Method:** GitHub REST API (`repos/<owner>/<repo>`, `releases/latest`, `license`, contents), npm registry (`dist-tags`, `time`, `peerDependencies`), npm downloads API (last-week counts), vendor documentation via WebFetch and Context7, README text via `gh api .../readme`.
- **Tags:** [S#] = source in the register at the end. "(inferred)" marks my inference; everything else is stated by the source.

## Summary for the lead

1. Only pg-boss and Graphile Worker document enqueue inside the caller's PostgreSQL transaction, and neither needs Redis (pg-boss `db` option; Graphile `graphile_worker.add_job()` SQL) [S9][S10]. BullMQ is Redis/Valkey-based [S13]. DBOS and Hatchet: atomic enqueue not documented in the pages read [S11][S12].
2. Drizzle 1.0 is at **v1.0.0-rc.5** (2026-10-21), with many breaking changes and no GA date; 0.45.4 is the latest stable [S14]. ADR-0020 names Drizzle, not a version.
3. postgres.js **v4.0.0** (2026-10-29) changed parameter typing and pool behaviour; Drizzle support for v4 is not verified [S15].
4. Nest 12 peers: `nestjs-pino` 5.3.1, `@nestjs/throttler` 6.7.1 and `@nestjs/swagger` 12.0.5 declare Nest 12; `nestjs-zod` 5.5.0 and `@openfeature/nestjs-sdk` 0.2.7 declare only Nest 11 or older [S2].
5. Nest 12 has built-in `app.useSecurityHeaders()` and `app.enableCsrfProtection()` that work the same on Express and Fastify, with no extra package [S4][S5].
6. better-auth (MIT) is DB-backed opaque-cookie sessions with sliding expiry; its fetched docs show no refresh-token families or device-bound refresh tokens (ADR-0023 needs both). Its NestJS integration is community-maintained and Fastify support is beta [S18].
7. Standard Webhooks (spec v1.0.0, npm `standardwebhooks` 1.1.1) signs `msg_id.timestamp.payload` with whsec_ secrets and supports multi-signature rotation; ADR-0030 signs `timestamp.body` with different header names. The two differ; keeping one is a decision for the lead [S20][S27].
8. Licence flags (not MIT/Apache/BSD/ISC): Unleash AGPL-3.0; Hook0 SSPL-1.0; Convoy custom licence that bars hosted or managed services; Flipt FCL-1.0-MIT; GrowthBook, SigNoz and the self-hosted Sentry server carry commercial-licensed directories or FSL; Formance repo has no licence [S22][S26].
9. PGlite has PostGIS only as a separate package with an open issue, and RLS evidence is mixed [S16]. embedded-postgres ships real PostgreSQL 14 to 18 binaries; its npm `latest` tag is a beta [S17][S2].
10. Throughput: the only figures are Fastify's own (GET 1.33x, POST 1.58x vs Express), with no hardware or Node version stated [S7]. We have no in-house benchmark.

---

## Source register

| Id | Source | Read on |
|---|---|---|
| S1 | GitHub REST API: `repos/<owner>/<repo>` (stars, pushed_at, archived, open_issues, license SPDX), `repos/<owner>/<repo>/releases/latest` | 2026-11-01 |
| S2 | npm registry `registry.npmjs.org/<pkg>` (dist-tags, time, peerDependencies, dependencies) | 2026-11-01 |
| S3 | npm downloads `api.npmjs.org/downloads/point/last-week/<pkg>` (weekly downloads) | 2026-11-01 |
| S4 | https://docs.nestjs.com/techniques/security | 2026-11-01 |
| S5 | Context7 library `/nestjs/docs.nestjs.com`, queries on useSecurityHeaders, enableCsrfProtection, @Sse; source pages github.com/nestjs/docs.nestjs.com content/security/helmet.md, csrf.md, http/server-sent-events.md | 2026-11-01 |
| S6 | GitHub release notes nestjs/nest v12.3.0 (`gh api repos/nestjs/nest/releases/tags/v12.3.0`) and the 12.x release list | 2026-11-01 |
| S7 | https://fastify.dev/benchmarks/ (page says "updated October 19, 2026") | 2026-11-01 |
| S8 | https://docs.nestjs.com/security/rate-limiting | 2026-11-01 |
| S9 | github.com/timgit/pg-boss: README (`readme`), docs/api/adapters.md, docs/database-backends.md, docs/install.md, docs/introduction.md | 2026-11-01 |
| S10 | github.com/graphile/worker: website/docs/requirements.md, tasks.md, job-key.md, schema.md, project-status.md, pro/index.md | 2026-11-01 |
| S11 | github.com/dbos-inc/dbos-transact-ts README; https://docs.dbos.dev/typescript/tutorials/transaction-tutorial and /queue-tutorial (WebFetch summaries) | 2026-11-01 |
| S12 | github.com/hatchet-dev/hatchet README; https://docs.hatchet.run/self-hosting (WebFetch summary) | 2026-11-01 |
| S13 | github.com/taskforcesh/bullmq README | 2026-11-01 |
| S14 | Drizzle: `gh release list -R drizzle-team/drizzle-orm`; release body of v1.0.0-rc.5; https://orm.drizzle.team/docs/latest-releases (WebFetch) | 2026-11-01 |
| S15 | github.com/porsager/postgres release v4.0.0 body (`releases/latest`) | 2026-11-01 |
| S16 | https://pglite.dev/extensions/ (WebFetch); github.com/electric-sql/pglite README; issues electric-sql/pglite #274, #138, #916 (`gh issue view`) | 2026-11-01 |
| S17 | github.com/leinelissen/embedded-postgres README | 2026-11-01 |
| S18 | https://better-auth.com/docs/integrations/nestjs; https://www.better-auth.com/docs/concepts/session-management (WebFetch summaries) | 2026-11-01 |
| S19 | github.com/animir/node-rate-limiter-flexible README | 2026-11-01 |
| S20 | https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md (WebFetch summary) and the repo README | 2026-11-01 |
| S21 | github.com/svix/svix-webhooks README (server requirements, config example) | 2026-11-01 |
| S22 | Licence texts: `gh api repos/<owner>/<repo>/contents/LICENSE*` for hook0/hook0, frain-dev/convoy, flipt-io/flipt, growthbook/growthbook, getsentry/sentry, getsentry/sentry-javascript, SigNoz/signoz; GitHub licence API for Unleash and others | 2026-11-01 |
| S23 | github.com/pilcrowonpaper/oslo README (deprecation notice); repo metadata (archived) | 2026-11-01 |
| S24 | https://www.postgresql.org/docs/current/sql-set.html (PostgreSQL 18.6 documentation) | 2026-11-01 |
| S25 | https://docs.tigerbeetle.com/ (WebFetch) and github.com/tigerbeetle/tigerbeetle README | 2026-11-01 |
| S26 | github.com/formancehq/ledger README and repo metadata | 2026-11-01 |
| S27 | Local repo: `adr/0003, 0019, 0020, 0023, 0024, 0025, 0027, 0030, 0031, 0036` (read in full or to the consequences section), `apps/api/package.json`, `packages/db/package.json`, `packages/config/package.json` | 2026-11-01 |
| S28 | github.com/blnkfinance/blnk README (licence section) | 2026-11-01 |

Repository and package rows below cite S1 (GitHub) and S2/S3 (npm) unless a different source is named in the row.

---

## 1. HTTP adapter

| Candidate | Repo / stars / licence | Last release | Maintenance | npm weekly | Fit with our stack |
|---|---|---|---|---|---|
| `@nestjs/platform-express` 12.3.2 (ours) | nestjs/nest, 76,957, MIT | Nest v12.3.0 GitHub 2026-10-28; npm 12.3.2 published 2026-10-27 | pushed 2026-10-31, 25 open issues | 16.39M [S3] | Default Nest adapter. Pairs with `helmet` 8.3.0 (MIT, 2026-07-12) and Express 5.3.0 (MIT, 2026-10-09) [S2]. |
| `@nestjs/platform-fastify` 12.3.2 | same repo; depends on fastify 5.12.7 [S2] | fastify v5.12.7, 2026-10-13 (GitHub) | fastify pushed 2026-10-29, 178 open issues | 2.81M [S3] | Nest 12 security headers and CSRF work on both adapters [S4][S5]. Plugins: `@fastify/helmet` 13.2.0 (MIT, 2026-10-13), `@fastify/rate-limit` 11.2.1 (MIT, 2026-10-08) [S2]. |
| `@nestjs/platform-node` 12.3.2 (new) | nestjs/nest | added in v12.3.0 [S6] | new; npm 6,116 weekly [S3] | 6,116 [S3] | Native Node http adapter; too new to weigh (inferred). |

**Stated facts**
- Nest docs: `app.useSecurityHeaders()` and `app.enableCsrfProtection()` "work the same way on Express and Fastify, and need no extra package"; both must be called before `init`/`listen` [S4][S5].
- Nest docs: `@Sse()` returns an Observable of MessageEvent; no adapter-specific caveat in the fetched text [S5]. Nest v12.3.0 fixed an SSE socket edge case in core [S6].
- Fastify benchmark page (vendor-run, "updated October 19, 2026", hardware and Node version not stated): GET 91,539 req/s vs Express 68,966 (about 1.3x); POST JSON echo 72,691 vs 46,005 (about 1.6x) [S7].
- @nestjs/throttler docs: a numeric `trustProxy` hop count makes Fastify 5.12.1+ trust no proxy; pass an address or range instead [S8].

**Trade-offs the sources name**
- Fastify: faster in its own benchmark; plugin-based helmet/rate-limit; trustProxy has a sharp edge [S7][S8].
- Express: largest install base (196.6M npm weekly for express) [S3], and `helmet` is middleware that matches the Nest docs' default path [S4].
- Nest's own security helpers hide the adapter difference for headers and CSRF [S4].

---

## 2. Job queue, outbox relay, durable work

Key question: can the enqueue share the business write's PostgreSQL transaction, and is Redis or Valkey needed?

| Candidate | Repo / stars / licence | Last release | Maintenance | npm weekly | Atomic enqueue with our write | Redis or Valkey? |
|---|---|---|---|---|---|---|
| BullMQ 6.5.3 (ADR-0024 plan) | taskforcesh/bullmq, 9,564, MIT | v6.5.3, 2026-10-31 | pushed 2026-11-01, 401 open | 13.18M | No: Redis-based queue; a Postgres outbox relay (ADR-0024, ADR-0036) is needed (inferred from the Redis backend) | Yes. README: node-redis (redis >= 5) or Valkey Glide adapter; Dragonfly compatible [S13] |
| pg-boss 12.38.0 | timgit/pg-boss, 4,116, MIT | 12.38.0, 2026-10-13 | pushed 2026-11-01, 15 open | 4.21M | Yes: `send(..., { db: fromDrizzle(tx, sql) })` (also Knex, Kysely, Prisma adapters); rolled back with the transaction [S9] | No. Requires Node 22.12+ and PostgreSQL 13+ [S9] |
| Graphile Worker 0.18.0 | graphile/worker, 2,432, MIT | v0.18.0, 2026-09-08 | pushed 2026-10-20, 42 open | 1.13M | Yes: `graphile_worker.add_job()` in SQL, inside the app transaction [S10] | No. Requires PostgreSQL 12+ and Node 22.18+ [S10] |
| DBOS Transact TS 5.4 | dbos-inc/dbos-transact-ts, 1,426, MIT | v5.4, 2026-10-28 | pushed 2026-10-31, 8 open | @dbos-inc/dbos-sdk 0.82M | Not documented in the pages read. Transactions run in the datasource database, queues in the system database [S11] | No; "just Postgres" [S11] |
| Hatchet 0.114.2 | hatchet-dev/hatchet, 8,211, MIT | v0.114.2, 2026-10-26 | pushed 2026-10-31, 139 open | @hatchet-dev/typescript-sdk 0.49M | Not documented in the pages read [S12] | No. PostgreSQL is required; RabbitMQ optional; Hatchet Lite single container [S12] |

**Stated facts**
- pg-boss "Create jobs in an existing db transaction"; "the job exists if, and only if, the change commits" [S9]. The install step creates a dedicated schema and needs CREATE privilege [S9].
- Graphile Worker: `add_job` can run in SQL; `withPgClient` and `query` do not create a transaction [S10]. Worker Pro (proprietary, licensed separately) adds live migration and crashed-worker recovery [S10].
- DBOS: "enqueue a workflow from a Postgres trigger or stored procedure" is listed; atomicity with app writes is not stated [S11]. The queue lives in the system database [S11].
- BullMQ README: Redis-based; BullMQ-Pro is a separate commercial product [S13].
- Hatchet README: calls BullMQ and Celery "traditional task queues" that trade durability for throughput; this is the vendor's comparison [S12].

**Trade-offs the sources name**
- pg-boss: transactional enqueue and fewer systems, at the cost of a CREATE-privilege schema install [S9]; relevant to the four-role split in ADR-0031 (inferred).
- Graphile Worker: smallest surface, Node 22.18+ floor, durable recovery features only in the proprietary Pro preset [S10].
- BullMQ: mature and fast on Redis; Redis is a second durable store to run and back up (inferred from ADR-0024).
- DBOS and Hatchet: durable-execution platforms with their own state model; heavier than a relay (inferred).

---

## 3. Postgres driver and query layer

| Candidate | Repo / stars / licence | Last release | Maintenance | npm weekly | Notes |
|---|---|---|---|---|---|
| `pg` (node-postgres) 8.23.1 | brianc/node-postgres, 13,228, MIT | no GitHub release (monorepo); npm 8.23.1, 2026-09-30 | pushed 2026-10-23, 572 open | 90.54M [S3] | Drizzle `node-postgres` driver. |
| `postgres` (postgres.js) 4.0.0 (ours is not pinned yet) | porsager/postgres, 8,741, Unlicense (public domain) | v4.0.0, 2026-10-29 | pushed 2026-10-29, 7 open | 34.19M [S3] | Drizzle `postgres-js` driver. v4 rewrote the pool, connection and protocol [S15]. |
| Drizzle ORM 0.45.4 (ours, ADR-0020) | drizzle-team/drizzle-orm, 36,194, Apache-2.0 | 0.45.4, 2026-10-08 | pushed 2026-10-30, 2,060 open | 42.82M [S3] | drizzle-kit 0.31.11 (MIT, 2026-09-21) [S2]. |
| Drizzle ORM 1.0.0-rc.5 | same repo | pre-release v1.0.0-rc.5, 2026-10-21; rc.1 2026-04-30 | five rcs from 2026-04-30 to 2026-10-21 [S14] | n/a | No GA date stated [S14]. |
| Kysely 0.29.8 | kysely-org/kysely, 14,322, MIT | v0.29.8, 2026-11-01 | pushed 2026-11-01, 208 open | 27.51M [S3] | Query builder, not an ORM; ADR-0020 lists ORMs considered, not Kysely. |

**Stated facts**
- Drizzle 1.0 rc.5 breaking changes (release notes, S14): postgres-js transparent parsers fixed and JSON params no longer double-stringified; `undefined` in relational `where` now throws; relation filter `{}` no longer means "exists"; `withReplicas` sends every query to primary unless `db.$replica`; RQB v2 query strategy becomes default for postgres; `paramsInErrors` opt-in.
- postgres.js v4 breaking changes (S15): the server decides parameter types (`infer: false` by default); `sql.array()` removed; a server-side ROLLBACK at COMMIT now rejects; released reserved connections reject queries; nested `sql.begin` runs in a savepoint; `queue_timeout` added; Node 20+.
- PostgreSQL 18 docs (S24): "The effects of SET LOCAL last only till the end of the current transaction, whether committed or not." `set_config(name, value, is_local)` is the equivalent; ADR-0031 uses `set_config(…, true)`. The third argument's meaning is from general PostgreSQL knowledge, not from the fetched page (inferred).

**Trade-offs the sources name**
- Drizzle 1.0 rc: breaking changes across drivers and relational queries, no GA date [S14]. Staying on 0.45.4 means a later migration (inferred).
- postgres.js v4: changed typing of Date and bytea-like parameters can change query results; Drizzle compatibility not documented (inferred risk for RLS session settings).
- node-postgres: most downloaded driver on npm (90.54M weekly) [S3]; larger issue backlog than postgres.js (572 vs 7 open) [S1].

---

## 4. Fast real-Postgres tests without Docker

| Candidate | Repo / stars / licence | Last release | npm weekly | Real PostgreSQL? | PostGIS | Roles / RLS |
|---|---|---|---|---|---|---|
| PGlite 0.5.14 | electric-sql/pglite, 16,220, Apache-2.0 | npm 0.5.14, 2026-10-31 | 36.19M [S3] | WASM Postgres; single user and single connection (README) [S16] | separate package `@electric-sql/pglite-postgis`; issue #916 "PostGIS improvements" open with 43 comments [S16] | Mixed. Issue #274 closed as fixed in 0.2.9/0.2.10; issue #138 closed while a commenter reported it still present [S16]. GRANT, SET ROLE and multi-role behaviour not documented in the pages read. |
| embedded-postgres 18.6.0-beta.19 | leinelissen/embedded-postgres, 150, MIT code; binaries Apache-2.0 (zonky) | npm `latest` is a beta tag, 2026-10-30 [S2] | 1.56M [S3] | Yes: PostgreSQL 14.24, 15.19, 16.15, 17.11, 18.6 binaries (README) [S17] | not listed in the README (unverified) | Standard PostgreSQL server, so roles and RLS work (inferred) |
| pg-mem 3.0.14 | (repo not checked) MIT | npm 3.0.14, 2026-02-26 [S2] | 0.88M [S3] | No: an in-memory emulator (inferred from the name and npm description) | not checked | not checked |

**Stated facts**
- embedded-postgres: "Running in Docker containers might fail" when run as root; `createPostgresUser` option exists [S17].
- pg-boss can use PGlite as its `pglite` backend, "full PostgreSQL" per its matrix [S9].
- Our owner ruling: local verification uses native Homebrew services, Compose only in CI (memory note 2026-10-31; not re-verified here).

**Trade-offs the sources name**
- PGlite: fastest start and no process, but single connection and PostGIS is a separate, open-issue package [S16].
- embedded-postgres: real server with real roles, at the cost of binary downloads and a beta `latest` tag [S2][S17].

---

## 5. Auth primitives for own identity (ADR-0023)

| Candidate | Repo / stars / licence | Last release | Maintenance | npm weekly | Notes |
|---|---|---|---|---|---|
| jose 6.2.14 | panva/jose, 7,855, MIT | v6.2.14, 2026-10-29 | pushed 2026-10-29, 0 open | 216.45M [S3] | JWT/JWS/JWE/JWK; use only if we issue JWTs. |
| `@node-rs/argon2` 2.2.2 | napi-rs/node-rs, 1,483, MIT | npm 2.2.2, 2026-10-06 | pushed 2026-11-01, 35 open | 2.70M [S3] | Rust bindings via napi-rs. |
| `argon2` 0.45.1 | ranisalt/node-argon2, 2,193, MIT | v0.45.1, 2026-07-21 | pushed 2026-10-26, 6 open | 3.47M [S3] | Native binding (its README was not read). Prebuilt coverage on our host architecture not checked. |
| better-auth 1.7.14 | better-auth/better-auth, 30,541, MIT | v1.7.14, 2026-10-26 | pushed 2026-11-01, 948 open | 17.13M [S3] | See notes below. |
| @oslojs/crypto 1.0.1, @oslojs/encoding 1.1.0 | (oslo project), MIT | npm 2024-09-21 and 2024-09-24 [S2] | 2.62M and 13.24M [S3] | Replacement named by oslo's deprecation notice [S23]. Last publish 2024. |
| oslo | pilcrowonpaper/oslo, 1,146, MIT | v1.2.0, 2024-03-28 | archived; last push 2025-01-20 [S1][S23] | n/a | Deprecated; do not adopt. |
| otplib 13.6.0 | yeojz/otplib, 2,304, MIT | v13.6.0, 2026-10-31 | pushed 2026-10-31, 1 open | 5.13M [S3] | HOTP and TOTP. |

**better-auth, stated facts (S18, read 2026-11-01)**
- Default session: database-backed, opaque `session_token` cookie; optional signed `session_data` cache cookie; stateless mode when no database is used.
- Sliding expiry: 7 days default `expiresIn`; `updateAge` reached refreshes the session.
- Not in the fetched pages: refresh-token families, rotation, device-bound refresh tokens, bearer plugin, device-authorization plugin.
- NestJS: "The NestJS integration is **community maintained**" (ThallesP/nestjs-better-auth); "beta support for Fastify" [S18].

**Trade-offs the sources name**
- better-auth: broad feature set and fast-moving releases; Nest integration is third-party and Fastify beta [S18].
- Gaps against ADR-0023 (inferred): device-bound refresh tokens, PIN for cash actions and the driver OTP flow would be custom code on top of better-auth.

---

## 6. Webhook signing and delivery (ADR-0030)

| Candidate | Repo / stars / licence | Last release | Maintenance | npm weekly | Fit with ADR-0030 |
|---|---|---|---|---|---|
| Standard Webhooks spec and `standardwebhooks` 1.1.1 | standard-webhooks/standard-webhooks, 1,785, Apache-2.0 | spec v1.0.2, 2026-02-18; npm 1.1.1, 2026-08-28 | pushed 2026-10-30, 68 open | 51.46M (`standardwebhooks`) [S3] | Spec: `webhook-id`, `webhook-timestamp`, `webhook-signature`; signed content `msg_id.timestamp.payload`; HMAC-SHA256 with `v1` prefix; `whsec_` base64 secrets, 24 to 64 bytes; multi-signature rotation; timestamp tolerance not fixed [S20]. Differs from ADR-0030 in header names, signed content (no msg id), signature format and secret encoding. |
| Svix (server + libraries) | svix/svix-webhooks, 3,471, MIT | server-v1.104.0, 2026-10-28 | pushed 2026-10-30, 65 open | npm `svix` 2.9.1 (2026-10-26) [S2]; weekly not retrieved | Self-hostable Rust server; needs PostgreSQL; Redis optional for task queue and cache [S21]. Svix is listed among Standard Webhooks adopters [S20]. Its own header names were not checked here. |
| Hook0 | hook0/hook0, 1,504, **SSPL v1** (LICENSE.txt) [S22] | frontend/v1.2.1, 2026-09-21 | pushed 2026-10-29, 6 open | not checked | Not an OSI-approved licence (general knowledge, not from the source); restrictions on offering it as a service (inferred). |
| Convoy | frain-dev/convoy, 2,888, **custom licence** (LICENSE: "You may not provide the software to third parties as a hosted or managed service...") [S22] | v26.9.2, 2026-10-20 | pushed 2026-10-31, 46 open | not checked | Hosting restriction may bite if we run it for merchants (inferred). |

**Stated facts**
- ADR-0030 (S27): `X-Eeasy-Timestamp`; `X-Eeasy-Signature: v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`; 5-minute tolerance; 24-hour dual-signing on rotation.
- Standard Webhooks retry guidance: multi-day exponential backoff with jitter; 410 disables; respect Retry-After on 429/502/504 [S20].

**Trade-offs the sources name**
- Standard Webhooks: a cross-vendor header and signing convention with ready verifiers; signs the message id too [S20].
- Svix: ready service, but a Rust server with PostgreSQL to run [S21].
- Hook0 and Convoy: feature-rich self-host options whose licences restrict hosting for others [S22].

---

## 7. Validation and OpenAPI in Nest

| Candidate | Repo / stars / licence | Last release | npm weekly | Peer or Nest 12 fit |
|---|---|---|---|---|
| nestjs-zod 5.5.0 | BenLorantfy/nestjs-zod, 1,125, MIT | v5.5.0, 2026-07-25 | 2.06M [S3] | Peers: `@nestjs/common` ^10 or ^11; `@nestjs/swagger` ^7.4.2, ^8 or ^11; zod ^3.25 or ^4 [S2]. **No Nest 12 in peers.** |
| zod-openapi 6.0.2 | samchungy/zod-openapi, 656, MIT | 6.0.2, 2026-08-31 | not checked | Peer zod ^4 [S2]; framework-free. |
| @nestjs/swagger 12.0.5 (ours if used) | nestjs/swagger, MIT | npm 12.0.5, 2026-10-27 | 11.71M [S3] | Peers `@nestjs/common` ^12, `class-validator` *, `class-transformer` * [S2]. Decorator-first; pulls class-validator and class-transformer (inferred). |
| openapi-typescript 7.13.0 + openapi-fetch 0.17.0 | openapi-ts/openapi-typescript, 8,424, MIT | npm both 2026-02-11 | not checked | Types only, plus a tiny fetch client; repo last pushed 2026-09-25 [S1]. |
| @hey-api/openapi-ts 0.99.0 | hey-api/hey-api, 5,547, MIT | npm 0.99.0, 2026-06-22 | not checked | 659 open issues; plugin-based SDK generator [S1]. |
| orval 8.46.0 | orval-labs/orval, 6,579, MIT | v8.46.0, 2026-10-30 | not checked | Client plus React Query and Zod outputs [S1]. |

**Trade-offs the sources name**
- nestjs-zod: convenient pipes and DTO helpers, but Nest 12 is not in its declared peers (stated) [S2].
- @nestjs/swagger 12 supports Nest 12 but expects class-based DTOs (inferred from its peers) [S2].
- zod-openapi matches zod 4 without Nest coupling [S2].

---

## 8. Feature flags and allowlist rollout (ADR-0006, AGENTS.md)

| Candidate | Repo / stars / licence | Last release | Maintenance | Notes |
|---|---|---|---|---|
| OpenFeature SDKs | open-feature/js-sdk, 287, Apache-2.0 | `@openfeature/server-sdk` 1.23.0, 2026-07-28 (npm) [S2] | pushed 2026-10-31 [S1] | 7.30M weekly for server-sdk [S3]. `@openfeature/nestjs-sdk` 0.2.7 (Apache-2.0, 2026-06-12) peers Nest ^8 to ^11 only [S2]. |
| Unleash 8.3.1 | Unleash/unleash, 13,920, **AGPL-3.0** [S1] | v8.3.1, 2026-10-29 | pushed 2026-10-30, 42 open | Licence flag. |
| Flipt 2.14.1 | flipt-io/flipt, 4,933, **FCL-1.0-MIT** [S22] | v2.14.1, 2026-10-23 | pushed 2026-10-29, 38 open | Fair Core License: "Competing Use" barred (making it available to others in a product that substitutes for it) [S22]; conversion term not verified in this run. |
| GrowthBook 5.1.0 | growthbook/growthbook, 8,554, MIT core with GrowthBook Enterprise License on listed directories (e.g. packages/back-end/src/enterprise) [S22] | v5.1.0, 2026-09-22 | pushed 2026-10-31, 879 open | Partly commercial. |
| In-house table | ours | n/a | n/a | No licence or vendor exposure; ADR-0006 and AGENTS.md already require an allowlist with a provisioning door (not re-read here). |

**Trade-offs the sources name**
- OpenFeature: vendor-neutral API; the Nest adapter does not declare Nest 12 [S2].
- Unleash, Flipt, GrowthBook: self-hosted UIs with licence limits noted above [S22].

---

## 9. Logging and observability

| Candidate | Repo / stars / licence | Last release | npm weekly | Notes |
|---|---|---|---|---|
| nestjs-pino 5.3.1 | iamolegga/nestjs-pino, 1,549, MIT | 5.3.1, 2026-10-02 | 4.28M [S3] | Peers `@nestjs/common` ^11.0.8 or ^12.0.2; pino ^10; pino-http ^11 [S2]. Fits Nest 12. |
| OpenTelemetry JS | open-telemetry/opentelemetry-js, 3,515, Apache-2.0 | repo v3.0.0, 2026-10-20 [S1]; npm `@opentelemetry/sdk-node` 0.300.0 (2026-10-20) [S2] | not checked | Version lines differ between repo tag and npm package; confirm the package line before pinning (inferred). |
| Sentry JS SDK (`@sentry/nestjs` 11.10.0) | getsentry/sentry-javascript, 8,771, MIT (LICENSE text) [S22] | 11.10.0, 2026-10-28 | not checked | SDK is MIT. |
| Sentry server (self-host) | getsentry/sentry, **FSL-1.1-Apache-2.0** [S22] | not checked | n/a | Source-available server; converts to Apache-2.0 after two years per the licence name (term not verified here). |
| SigNoz | SigNoz/signoz, 32,492, MIT core with `ee/` commercial [S22] | v0.148.1, 2026-10-29 | n/a | 1,579 open issues. Partly commercial. |
| HyperDX | hyperdxio/hyperdx, 9,985, MIT [S1] | @hyperdx/app 2.43.0, 2026-10-30 | n/a | 269 open issues. |

**Trade-offs the sources name**
- Sentry: SDK MIT, but the self-hosted server is FSL [S22].
- SigNoz and GrowthBook: broad feature sets with commercial directories [S22].

---

## 10. Rate limiting

| Candidate | Repo / stars / licence | Last release | npm weekly | Notes |
|---|---|---|---|---|
| @nestjs/throttler 6.7.1 | nestjs/throttler, 712, MIT | 6.7.1, 2026-09-24 | 6.38M [S3] | Peers `@nestjs/common` and `@nestjs/core` ^7 to ^12 [S2]. Built-in storage is in memory; custom storage through the `ThrottlerStorage` interface; Redis storage only via a community provider [S8]. |
| rate-limiter-flexible 11.2.3 | animir/node-rate-limiter-flexible, 3,598, ISC | 11.2.3, 2026-10-17 | 4.79M [S3] | Stores: Valkey or Redis, Postgres (Sequelize, TypeORM, Knex), MySQL, MongoDB, memory [S19]. Framework-agnostic. |
| @fastify/rate-limit 11.2.1 | (Fastify plugin) MIT | 11.2.1, 2026-10-08 | not checked | Fastify-only [S2]. |

**Trade-offs the sources name**
- @nestjs/throttler: Nest-native decorators and both adapters; distributed storage is a community package [S8].
- rate-limiter-flexible: several stores including Postgres, so no Redis is needed for rate limiting [S19].

---

## 11. Ledger engines (facts only, per the lead's request)

| Engine | Repo / stars / licence | Last release | Facts stated by the source |
|---|---|---|---|
| TigerBeetle 0.17.9 | tigerbeetle/tigerbeetle, 17,283, Apache-2.0 | 0.17.9, 2026-07-06 | "The financial transactions database designed for mission critical safety and performance" [S25]; requests such as `create_accounts` and `create_transfers` with ledger and code fields (README) [S25]. Own protocol; no SQL. Joining a PostgreSQL transaction is not possible (inferred). |
| Formance ledger | formancehq/ledger, 1,458, **no licence** (GitHub licence API 404; no LICENSE file in the repo) [S26] | v2.4.17, 2026-10-28 [S1] | Default-branch README describes "Ledger v3 - Raft Cluster" with etcd/raft and Pebble storage, and Numscript [S26]. Our PostgreSQL ledger requirement (ADR-0031) does not match v3 (inferred). |
| Blnk 0.15.7 | blnkfinance/blnk, 574, Apache-2.0 [S28] | v0.15.7, 2026-10-24 | "a reliable ledger that can track every movement of value" [S28]. Datastore not named in the README (unverified). |

---

## Trade-offs the sources name (across categories)

- pg-boss and Graphile Worker share the business transaction; BullMQ and Hatchet do not (S9, S10, S13, S12).
- Drizzle 1.0 RC has breaking changes and no GA date (S14). postgres.js v4 has breaking changes (S15).
- Nest 12 coverage is uneven: nestjs-zod and OpenFeature's Nest SDK declare older peers (S2).
- Fastify's throughput advantage is a vendor benchmark (S7). Fastify's trustProxy has a footgun (S8).
- better-auth covers sessions, not device-bound refresh families; Nest integration is community-maintained (S18).
- Standard Webhooks, Svix and ADR-0030 differ in headers and signed content (S20, S21, S27).
- PGlite is single-connection, and PostGIS is a separate package with an open issue (S16).
- Licences: AGPL (Unleash), SSPL (Hook0), custom hosting bar (Convoy), FCL (Flipt), FSL (Sentry server), partly commercial (GrowthBook, SigNoz), none (Formance) (S22, S26).

## Unanswered

1. DBOS Transact and Hatchet: can an enqueue commit atomically with an application write in our PostgreSQL? Pages read do not say (S11, S12).
2. Does Drizzle 0.45 or 1.0 rc support postgres.js v4 as a driver, and does v4's parameter typing change Drizzle queries? Not verified (S14, S15).
3. PGlite: GRANT, SET ROLE and RLS with multiple roles; PostGIS package version and feature coverage (S16).
4. embedded-postgres: whether PostGIS is available in its binaries (S17).
5. Drizzle 1.0 GA date (S14).
6. better-auth: device-authorization or bearer plugins and any refresh-token rotation; the fetched pages do not cover them (S18).
7. Svix's own signature header names and whether they match Standard Webhooks byte for byte (S21).
8. Flipt's FCL conversion term; Sentry server's FSL conversion term; whether our use of Convoy or Hook0 would count as "hosted or managed service" under their licences: legal reading needed (S22).
9. Formance: the PostgreSQL-backed v2 line and the current licence position (S26).
10. Blnk's datastore and deployment requirements (S28).
11. Argon2 prebuilt binaries for our container architecture and Gulf host (not checked).
12. Real throughput of Fastify versus Express on our routes; no in-house benchmark exists (S7).
13. Downloads for several packages were not retrieved (marked "not checked" above).
14. OpenTelemetry: which npm line to pin, given the repo tag and npm package versions differ (S1, S2).
15. @nestjs/platform-node maturity and whether it is worth tracking (S6).
