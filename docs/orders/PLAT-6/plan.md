# PLAT-6 · Request context and tenancy guard

- **Status:** planned
- **Date:** 2026-11-01
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-5 (merged, PR #33).
- **Lead:** architecture lead. **Executor:** `executor-api` (Opus), own worktree, native stack database `elx_plat6` (scratch databases through the PLAT-5 harness). **Adversary:** yes (tokens, tenancy, cross-tenant access, idempotency replay, rate limits).
- **Issue:** #39. **Merge danger:** one-way door (adds the `core_idempotency_keys` migration and the first production refusal tied to the admin origin).
- **Legs:** two. Leg 1 items A–E; leg 2 items F–H. Both touch `apps/api`, `packages/db` and `packages/config`; no other order may touch those paths while PLAT-6 is in flight (PLAT-15 leg 2 touches `packages/contracts`, `.github` and one config entry `contractTestConfig()`; the config overlap is one new file, accepted).

## 0. Goal

Every API request on a tenant surface runs with a request context resolved once from its credential, inside one transaction whose first statement sets the account, so that no handler can read or write another account's rows; platform staff cross a tenant boundary only through an explicit, audited door; retried writes are deduplicated per principal with stored responses; every error is the contract's `Error` shape with a request id; and every surface has a per-route budget, so that every later order adds handlers inside a frame that already enforces the hard rules.

## 1. Binding rules and ADRs

- AGENTS.md hard rules: tenancy is structural, the account comes from the token never from a request parameter; configuration through `packages/config`; secrets never in code.
- ADR-0025 "Decision" (account resolved once from the token, set on the database session, predicate in the repository base). ADR-0031 "Decision" (roles; the platform pool for cross-tenant work). ADR-0032 "Decision" bullets 1 and 4 (same-origin API; `X-EL-Client: web` and `Origin` check on staff and platform writes). ADR-0038 "Decision" bullets 3 and 6 (the admin hostname; the `Origin` check accepts both hostnames).
- `docs/architecture/identity-and-tenancy.md` §4 "Tokens and sessions" (JWT claims `sub`, `acc`, `mem`, `roles`, `scopes`, `sites`, `ver`, `dev`; 15-minute access tokens verified locally by signature; revocation checked on refresh and sensitive actions only), §5 "Tenancy" (guard into `AsyncLocalStorage`; `@CrossTenant()` with an audit row and the banner; background jobs carry the account id), §8 "Abuse and rate limits", §9 "Adversary checklist for every auth PR" (the adversary's criteria).
- `docs/architecture/data.md` §4.2 "Repository base and unit of work" (one transaction per request opened by the unit of work), §2.1 table row `core_idempotency_keys` and §2.4 "nullable account" row, §5.1 "`core_idempotency_keys`" (reserve, complete, purge; K-8, K-9).
- `docs/contracts/README.md` §1 "Surfaces and base paths" (credential per surface; `x-cross-tenant` and `X-Support-Reason`), §3 "Conventions" rows Idempotency, Web client marker, Request ids, Language; §4 "Error model"; §7 "Rate limits by surface"; `docs/contracts/errors.md` §1 "Common".
- PLAT-5 code this order builds on: `packages/db` `RequestContext`, `runWithContext`, `withUnitOfWork`, `withPlatformUnitOfWork`, `createPlatformPool`, `verifyPoolRole`; PLAT-5 plan §9 rulings M-1 (the structural fix for the raw `tx` lands here) and M-6 (the platform pool calls `verifyPoolRole(…, 'elx_platform')` at boot).
- PLAT-4 `packages/config` `auth` group (`AUTH_SIGNING_KEY_ID`, `AUTH_SIGNING_KEY`), public URLs.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Request id | A NestJS middleware first in the chain: accept an incoming `X-Request-Id` only when it is a UUID, else generate a UUIDv7; set it on the response, on the request context and on every log line; the `Error` body repeats it as `request_id` |
| 2.2 | Error model | One global exception filter: `ApiException(code, status, details?)` for known codes (a TypeScript union generated from `errors.md` already exists in `packages/contracts/unions`; the API imports the union type only, through a small `packages/contracts/unions` import allowed by an architecture rule); NestJS `HttpException`s map to `validation_failed` (400 with `details.fields[]` JSON pointers from the validation pipe), `not_found`, `forbidden`, `unauthenticated`; anything else is 500 `internal_error` with no detail (this order adds `internal_error` to `errors.md` §1 as an additive change, README §2); `message` is localised from `packages/i18n` namespace `errors` by `Accept-Language` (`ar` default), one key per code in both locales; the filter never leaks a stack, a query or a value |
| 2.3 | Token format | Access tokens are JWTs signed HS256 with `auth.signingKey`, header `kid = auth.signingKeyId`, verified with `jose`; claims validated with Zod: `sub` (user id), `acc` (account id or `null` for platform), `mem` (membership id or null), `roles` (string array), `scopes` (string, a hash), `sites` (uuid array), `ver` (integer), `dev` (device id, driver only), plus `iss`, `aud` (`staff`, `platform` or `driver`), `iat`, `exp`; a token whose `aud` does not match the surface is `unauthenticated`; expiry is `token_expired`; `ver` is carried in the context for PLAT-11's revocation checks, not checked here (document 4 §4). Issuing tokens is PLAT-11's; this order ships a test-only signer in `apps/api/test/` |
| 2.4 | Credential per surface | `/v1/staff/*`: cookie `el_staff_at`; `/v1/platform/*`: cookie `el_platform_at`; `/v1/driver/*`: `Authorization: Bearer`; `/v1/recipient/*` (`X-Recipient-Token`) and `/v1/public/*` (API key) answer `401 unauthenticated` until DEL-? and the wave 4 orders implement their verifiers, through the same `Principal` resolver with a per-surface strategy; `/health`, `/ready` and any handler marked `@Public()` skip authentication |
| 2.5 | Guard and context | `TenancyGuard` (global) resolves the principal and builds the `RequestContext` of `packages/db`: `accountId` from `acc`, `membershipId` from `mem`, `userId` from `sub`, `deviceId` from `dev`, `actingCrossTenant: false`; the whole handler runs inside `runWithContext`; a platform principal (`acc = null`) gets a `PlatformContext` (no account) instead; the context is read-only for handlers (`getContext()`); nothing in a path, query or body is ever used to pick the account (K-3) |
| 2.6 | Unit of work per request | An interceptor opens `withUnitOfWork(appPool, context, …)` for every authenticated request on the staff and driver surfaces and `withPlatformUnitOfWork` on the platform surface; the handler and the repositories it calls receive the unit of work through `getUnitOfWork()` (AsyncLocalStorage, same store as the context); the transaction commits on a 2xx and rolls back on any thrown error; the PLAT-5 M-1 structural fix: the tenant `UnitOfWork` type no longer exposes `tx` to handlers, only repository bases (constructed with it) see the transaction; `GET` requests also run in the transaction (read-only consistency, one connection per request; revisit at PLAT-14 if pool pressure shows) |
| 2.7 | Cross-tenant door | `@CrossTenant()` on a platform handler: requires a route parameter `accountId` (declared by the decorator), requires the `X-Support-Reason` header (1 to 200 characters, else `400 validation_failed`), builds a `RequestContext` for the target account with `actingCrossTenant: true` and the platform user as `userId`, opens the unit of work on the **platform pool** with `set_config('elx.account_id', target, true)` so the repository predicate and the policies see the target; emits one `AuditEvent` (actor, target account, operation id, reason, request id) to an `AuditSink` port whose default implementation in this order writes a structured log line; PLAT-7 replaces it with the `core_audit_log` writer in the same transaction; a platform handler without `@CrossTenant()` that touches a tenant table fails the architecture test (repository constructed with a `PlatformUnitOfWork` outside `modules/kernel/platform/`) |
| 2.8 | Idempotency | Migration `0005_core_idempotency_keys` exactly as data §2.1 (`account_id` nullable for platform principals, unique `NULLS NOT DISTINCT (account_id, principal_id, key)`, worker-scan index on `expires_at`); an `IdempotencyInterceptor` applied by `@Idempotent()` on every retryable write handler (the contracts lint already requires the header on those operations; a later contract test checks parity): missing or non-UUID key → `400 idempotency_key_required`; reserve `in_progress` in the request's transaction before the handler runs; on unique violation: same hash and `completed` → the stored status and body are returned with header `Idempotency-Replayed: true`; same hash and `in_progress` → `409 idempotency_in_progress` with `Retry-After: 2` (new code added to `errors.md` §1, additive); different hash → `422 idempotency_key_reused`; on success the same transaction stores the response and sets `expires_at = created_at + 24 h`; the request hash is SHA-256 over method, route, the canonical JSON body with secret fields removed (field names listed by the decorator, default `cash_pin`, `password`, `otp`, `api_key`, `secret`) plus an HMAC-SHA256 of the removed values under a key derived from `auth.signingKey` with HKDF info `elx-idempotency`; `@Idempotent({ secretResponse: true })` stores the response with the secret fields removed and answers a replay with `409 secret_already_issued` and `details.resource_id` (README §3) |
| 2.9 | Purge job | `purgeIdempotencyKeys()` deletes `expires_at < now()` in batches of 10,000 using the worker-scan index (K-9); until PLAT-8 brings BullMQ schedulers, `--role worker` runs it on an hourly `setInterval` guarded by the Redis lock `elx:lock:idempotency-purge` (TTL 55 min) so two workers do not race; PLAT-8 moves it to a repeatable job |
| 2.10 | Rate limits | Budgets of README §7 as code constants per surface with a per-route override map; keys: staff and platform by user id, driver by device id, recipient by token hash, public by API key id (the last two wired when their verifiers land), IP as the secondary key for unauthenticated routes; a fixed window per minute in Redis (`INCR` + `PEXPIRE` in one Lua script, atomic); every response carries `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`; over budget → `429 rate_limited` with `Retry-After` and `details.retry_after_s`; Redis unavailable → fail open with a warning log and a metric counter (availability over strictness for wave 0; recorded as an owner question) |
| 2.11 | Web client marker | On every non-`GET` request to `/v1/staff/*` and `/v1/platform/*`: require `X-EL-Client: web` and an `Origin` equal to `config.app.publicWebUrl` (staff) or the new `config.app.publicAdminUrl` (platform; variable `PUBLIC_ADMIN_URL`, required in production, added to `packages/config` and `.env.example` per ADR-0038), else `403 forbidden`; applied before the idempotency interceptor so a rejected request reserves nothing |
| 2.12 | Boot | `AppModule.forRoot(config)` opens the app pool and the platform pool, calls `verifyPoolRole` for both at boot (PLAT-5 §9 M-6 ruling) and refuses to start on a mismatch (exit 78 with the role named, never the URL) |
| 2.13 | Tests | Integration tests on the PLAT-5 harness with the test-only signer: a staff token reads only its account's rows through a probe repository on `core_accounts`… (`core_accounts` is the only table: the probe uses a throwaway tenant table created in a test schema per the PLAT-5 convention); a forged signature, a wrong `aud`, an expired token; a platform token without `@CrossTenant()` cannot reach tenant rows; with it, the audit sink receives the event and the reason is required; idempotency: replay returns the stored body, in-progress returns 409, different body returns 422, secret-bearing replay returns 409 `secret_already_issued`, purge removes expired rows; rate limit: the 61st request in a minute is 429 with the three headers; marker: a write without the header or with a foreign origin is 403 and reserves no key |

## 3. Build list

### Leg 1

| Item | Delivers | Verify |
|---|---|---|
| A | Request id middleware and the global exception filter per 2.1 and 2.2; `internal_error` added to `errors.md`; `errors` i18n keys for every code in `ar` and `en` with the parity test | HTTP tests: a thrown `ApiException` renders the `Error` schema with `request_id`; an incoming UUID request id is echoed, a non-UUID is replaced; a 500 carries no stack; `Accept-Language: en` switches the message |
| B | Token verification and the per-surface `Principal` resolver per 2.3 and 2.4; test-only signer | unit tests: valid, forged, expired, wrong `aud`, missing claim; cookie versus bearer per surface; recipient and public answer 401 |
| C | `TenancyGuard`, `@Public()`, request context and the per-request unit of work per 2.5 and 2.6; the M-1 structural fix in `packages/db` | integration: tenant isolation through a probe repository (two tokens, two accounts); rollback on a thrown error; `getUnitOfWork()` outside a request throws; the raw `tx` is not reachable from a handler (typecheck red on a planted access) |
| D | `@CrossTenant()`, platform unit of work, `AuditSink` port with the log implementation, boot role checks per 2.7 and 2.12 | integration: reason required; target account set; audit event emitted; platform handler without the decorator cannot read tenant rows; boot refuses a wrong platform role (unit test of the check) |
| E | Idempotency per 2.8 with the migration; purge per 2.9 | integration per 2.13; the schema test still green (`core_idempotency_keys` is a nullable-account exemption per data §2.4) |

### Leg 2

| Item | Delivers | Verify |
|---|---|---|
| F | Rate limits per 2.10 | integration with Redis: budget, headers, 429 body, fail-open when Redis is down (logged) |
| G | Web client marker per 2.11; `PUBLIC_ADMIN_URL` in config and `.env.example` | HTTP tests per 2.13; config tests for the new variable and its production requirement |
| H | README "Request pipeline" section (order of middleware, guard, interceptors), ADR citations in code comments, Serena memories per `memory_upkeep`, plan §8 complete | `pnpm turbo run typecheck lint test` green; `test:integration` green with `ELX_RLS` off and on |

## 4. Commit plan

One commit per item `PLAT-6: <letter> <title>` with its §8.0 row. Leg 1 ends with the draft PR; leg 2 is a fresh executor on the same branch.

## 5. Exit criteria

- No handler can receive `account_id` as input or reach another account's rows; proven by the integration tests and the architecture test.
- Cross-tenant reads only through `@CrossTenant()` with a reason and an audit event.
- Idempotent writes behave per README §3 in all four replay cases; expired keys are purged.
- Every error is the `Error` schema with a localised message and a request id; every response carries `X-Request-Id` and the three `RateLimit-*` headers.
- The adversary pass finds no critical or high; the identity document §9 checklist is answered in §9.

## 6. Not in this order

Issuing tokens, refresh, sign-in doors, OTP and TOTP (PLAT-11); permission enforcement from `x-permission` and role bundles (PLAT-10); the `core_audit_log` table and its writer (PLAT-7, replaces the log sink); recipient token and API key verifiers (their orders); BullMQ schedulers (PLAT-8); per-account rate-limit overrides from the platform UI (wave 2); CAPTCHA.

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | Rate limiting when Redis is unreachable: fail open (serve, log, count) or fail closed (503)? | Fail open in wave 0 (2.10); revisit at PLAT-14 with the alert on Redis health. |
| 2 | Access-token signature: symmetric HS256 with the config key, or asymmetric EdDSA so other services could verify without the secret? | HS256 now (one API deployment verifies its own tokens; the key already exists in config); a switch to EdDSA is a PLAT-11 decision with a `kid` rollover, which 2.3 already supports. |

## 8. Executor notes (filled by the executor)

### 8.0 Progress

| Item | Commit | Tests (counts) | Interpretation |
|---|---|---|---|

### 8.1 Skills, documents and versions consulted

### 8.2 Interpretations the lead should check

### 8.3 Not done here

## 9. Lead review and adversary

Adversary: required (tokens, tenancy, cross-tenant, idempotency, rate limits). The identity document §9 checklist is answered here by the lead after the pass.
