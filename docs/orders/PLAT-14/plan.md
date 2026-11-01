# PLAT-14 · Observability

- **Status:** planned
- **Date:** 2026-11-01
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-1, PLAT-8 (merged). Runs beside PLAT-9 under the owner's go of 2026-11-01 ("run the next PLAT if it does not depend on the messaging decisions"): both touch `apps/api`, so this order never edits `modules/kernel/messaging/`, rebases onto main before its gate, and the lead resolves the `main.ts` and worker registration overlaps at merge.
- **Lead:** architecture lead. **Executor:** `executor-api` (Opus) for leg 1, `executor-web` (Opus) for leg 2, own worktrees. **Adversary:** yes (private data in logs, traces, error reports and analytics; secrets in config).
- **Issue:** #73. **Merge danger:** two-way door (no migration; external registrations at Sentry and PostHog are the owner's, outside this order). **Legs:** two (A–E API and worker; F–H web and admin).
- **Paths:** leg 1 `apps/api` (outside `modules/kernel/messaging/`), `packages/config` (variables exist; one addition), `observability/` (new, alert rules), `.env.example`; leg 2 `apps/web`, `apps/admin`, `packages/ui` (one helper), `packages/config` (public variables exist); `.serena/memories`.

## 0. Goal

Every request, job, outbound port call and error in the API and worker is traced, counted and logged in a shape the owner can alert on, the web and admin apps report errors and product events through first-party routes with ids only, and no log, span, event or report ever carries a phone number, a token, a code or a body, so that OPS-1 can wire exporters and alert routing to a frame that already emits the signals platform §7 names.

## 1. Binding rules and ADRs

- AGENTS.md hard rules: secrets never in logs; config through `packages/config`; side effects through the outbox (telemetry export is not a side effect in the outbox sense: it is best-effort and never awaited by a request).
- `docs/architecture/platform.md` §7 "Observability" (OpenTelemetry in api and worker: traces for HTTP, database, queue and outbound HTTP; the metric list; JSON logs with request id and account id; Sentry with release tags from the image tag; PostHog with ids only; the alert list), §3 (MESSAGING_DISABLED and startup refusals), §6 (data protection).
- `docs/architecture/integrations.md` §4.5 "Dead letters and alerts" (per-kind oldest-due thresholds; dead-letter paging per kind; rate alerts for webhook and channel), §10 "Observability per integration" (span names and attributes, the metric catalogue, the alert list), §11 "Security" (no bodies, no secrets in telemetry).
- `docs/architecture/web.md` §10.4 "Errors and observability" (error boundaries with `request_id`, Sentry through `/monitoring` with `beforeSend` stripping, PostHog through `/ingest` with ids only and replay off, the typed event catalogue in `src/analytics.ts` and the census helper).
- ADR-0036 (the per-kind thresholds), ADR-0028 (location pings are not events; their metrics are DEL-5's).
- PLAT-6 (request id middleware, the error filter, the redaction helper in `modules/kernel/audit`), PLAT-7 (audit writer; the `core.authorization.denied` and door rows are not telemetry), PLAT-8 (relay, workers, handler outcomes; the metric hooks it left as log lines), PLAT-4 (`OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN`, `POSTHOG_API_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`), PLAT-3 (image tag `sha-<commit>` available at build time), WEB-1 (shell, census helpers).
- Owner ruling A-24: no Valkey, VROOM or routing infrastructure; this order adds no collector container.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | SDK | `@opentelemetry/sdk-node` with auto-instrumentations for HTTP, Express, `pg`/postgres.js, ioredis and BullMQ (whichever exist at a version at least three days old; record the set in §8.1), started before Nest in `main.ts` for the api and worker roles only (the migrate role stays telemetry-free); OTLP/HTTP exporters for traces, metrics and logs when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, else a no-op exporter; resource attributes `service.name` (`elx-api`, `elx-worker`), `service.version` = the image tag (`ELX_RELEASE`, new config variable set by the Dockerfile from the build arg, default `dev`), `deployment.environment` = `APP_ENV`; sampling: parent-based, ratio from `OTEL_TRACES_SAMPLER_ARG` (default 1.0 outside production, 0.1 in production) |
| 2.2 | Spans and attributes | Request spans carry `elx.request_id`, `elx.account_id` (when a tenant context exists), `elx.surface`, `elx.operation_id`, never a path parameter value, query string, header or body; port calls get `integration.<port>.<method>` spans with the doc 9 §10 attributes (provider, account id, outcome, HTTP status, attempt, outbox row id) through one `withPortSpan()` helper that later orders call; the outbox relay, workers and consumers get spans per tick, job and consumer with the row id and kind, linked to the envelope `correlation_id` |
| 2.3 | Metrics | A `Metrics` service wrapping the OTel meter with the doc 9 §10 catalogue as typed instruments (`integration_calls_total`, `integration_latency_ms`, `integration_breaker_state`, `outbox_due_oldest_age_seconds`, `outbox_rows`, `outbox_dead_total`, `messages_*` left as declared instruments for PLAT-9 leg 2 to call, `http_request_duration_ms` with route template and status, `ready_checks` gauge, `otp_failures_total` declared for PLAT-11, `ledger_assertion_drift` declared for the ledger orders); the outbox gauges are observed by a 30 s worker job reading `core_outbox` on the platform pool (one query); labels never include a phone, email or free text; a Prometheus pull endpoint is not added (OTLP push only; OPS-1 may add a collector that exposes one) |
| 2.4 | Logs | `pino` (or Nest's logger replaced by a JSON logger: pick one, record in §8.1) emitting one JSON line per event with `ts`, `level`, `msg`, `request_id`, `account_id`, `trace_id`, `span_id`, `service`, `release`; the shared redactor from PLAT-7 (`redactForAudit`) generalised into `packages/db`? no: into `apps/api/src/modules/kernel/telemetry/redact.ts` and applied to every log argument, error message and span attribute string (tokens, bearer, JWT shapes, phone numbers in E.164 masked to the last two digits, emails masked, the secret key tokens); the existing kernel log lines (audit sink, worker jobs, outcomes) are moved onto it; log level from `LOG_LEVEL` (new, default `info`, `debug` in local) |
| 2.5 | Sentry (api and worker) | `@sentry/node` initialised when `SENTRY_DSN` is set, release = `ELX_RELEASE`, environment = `APP_ENV`, `beforeSend` through the redactor and dropping request bodies, cookies and `Authorization`; the PLAT-6 error filter reports `internal_error` (500) only, never 4xx; worker job failures reported with the row id and kind, never the payload; tracing left to OTel (Sentry performance off) |
| 2.6 | Alerts as a file | `observability/alerts.yaml`: the platform §7 list and the doc 9 §4.5 and §10 thresholds as rule entries (name, metric or log condition, threshold, window, severity, runbook pointer) in a provider-neutral shape, plus `observability/README.md` saying OPS-1 turns them into the host's alerting; no routing is configured here (the owner's channel is OPS-1's) |
| 2.7 | Web and admin Sentry | `@sentry/nextjs` in both apps with the tunnel route `/monitoring` (first-party, CSP stays `'self'`), release = `NEXT_PUBLIC_RELEASE` (new public variable set at build), `beforeSend` stripping cookies, `Authorization`, `X-Recipient-Token`, request bodies and rewriting recipient token path segments to `:token`; error boundaries per web §10.4 (`global-error.tsx`, `error.tsx` per group) showing the `request_id` with a retry action, in both languages |
| 2.8 | Web and admin PostHog | `posthog-js` through the first-party proxy route `/ingest/[...path]` to PostHog's host with the key from `publicConfig()`; session replay off; autocapture off; `src/analytics.ts` typed catalogue (`<area>.<object>.<action>`, past tense) with id-only properties enforced by the type (no string fields except enums and ids); recipient pages send one page view with the token rewritten and no person profile; a census helper `expectAnalyticsEvents(page, [...])` asserting a screen's declared events are in the catalogue (web §11) |
| 2.9 | Census and tests | Leg 1: unit tests for the redactor (phones, emails, tokens, JWTs, nested), the metrics catalogue (every doc 9 §10 metric declared), span attribute allowlist (a planted header attribute refused), Sentry `beforeSend` (a planted cookie removed), log line shape; integration: a request produces one span with the request id and no path values (in-memory exporter), the outbox gauge job observes a planted due row; leg 2: census for both apps that an error page shows the request id in `ar` and `en`, that `/monitoring` and `/ingest` answer, and that no analytics request carries a phone or name (request interception) |
| 2.10 | Not here | Driver app Sentry and PostHog (DRV-1); alert routing and the collector (OPS-1); dashboards; the ledger assertion job (ledger orders); OTP failure rate population (PLAT-11); location-ping metrics (DEL-5) |

## 3. Build list

### Leg 1 (API and worker, `executor-api`)

| Item | Delivers | Verify |
|---|---|---|
| A | OTel SDK bootstrap per 2.1 with `ELX_RELEASE`, `LOG_LEVEL` and sampler config in `packages/config` and `.env.example`; the Dockerfile build arg for the release | api and worker boot with and without the endpoint; in-memory exporter test shows service name, version and environment; migrate role loads no SDK (dependency-cruiser rule from PLAT-7 extended) |
| B | Spans and attributes per 2.2 with `withPortSpan()`; relay, worker and consumer spans | integration: request span attributes allowlist; a planted header attribute red; outbox job spans carry row id and kind |
| C | Metrics per 2.3 and the outbox gauge job | catalogue test; gauge job observes a planted due row and a dead row |
| D | JSON logs and the redactor per 2.4, applied across the kernel | redactor unit tests (counts); a planted phone in a log argument comes out masked; log line shape test |
| E | Sentry per 2.5; `observability/alerts.yaml` and README per 2.6; memories; plan §8 for the leg; draft PR | `beforeSend` tests; a 4xx is never reported, a 500 is; alerts file validated by a schema test |

### Leg 2 (web and admin, `executor-web`)

| Item | Delivers | Verify |
|---|---|---|
| F | Sentry per 2.7 in `apps/web` and `apps/admin`, error boundaries in both languages | census per 2.9; `beforeSend` unit test |
| G | PostHog per 2.8 with the typed catalogue and the census helper | census per 2.9; a planted string property fails typecheck |
| H | README "Observability" section; memories; plan §8 complete; Arabic release note (error pages are user-visible) | gate green |

## 4. Commit plan

One commit per item `PLAT-14: <letter> <title>` with its §8.0 row; leg 1 opens the draft PR; leg 2 is a fresh web executor on the same branch.

## 5. Exit criteria

- With an OTLP endpoint configured, the api and worker export traces, metrics and logs carrying the request id, account id, release and environment; without one they run unchanged.
- No span attribute, log line, Sentry event or analytics property can carry a phone, email, token, code or body; proven by the redactor and allowlist tests.
- Every metric and alert of platform §7 and doc 9 §10 exists as an instrument or a rule entry.
- Both web apps report errors through `/monitoring` and events through `/ingest` with ids only, and their error pages show the request id in both languages.
- The adversary pass finds no critical or high.

## 6. Not in this order

See 2.10. Alert routing to the owner's channel, dashboards and the collector are OPS-1's; the driver app is DRV-1's.

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | Sentry and PostHog accounts: existing eeasynew organisations or new ones for this product? | New projects under the existing organisations, DSN and key provided through OPS-1; the code only reads them. |
| 2 | Production trace sampling ratio | 0.1 (10 %) with parent-based sampling; errors always sampled by Sentry. |

## 8. Executor notes (filled by the executor)

### 8.0 Progress

| Item | Commit | Tests (counts) | Interpretation |
|---|---|---|---|
| A SDK bootstrap, config, Dockerfile, migrate rule | this commit | config 110/110 (+2: defaults by environment, malformed values refused); `telemetry/sdk.test.ts` 9/9 (in-memory exporter: `service.name` `elx-worker`, `service.version` = `ELX_RELEASE`, `deployment.environment(.name)`; no host/process detection; sampler: root ratio, a remote `sampled` parent cannot force sampling, a local parent is kept); architecture-violations 18/18, red with the old `.dependency-cruiser.cjs`: 2 failed / 16 passed (`migrate/loads-telemetry.ts`, `main/main.ts`); `test:architecture` clean; api unit 290/290; typecheck, lint clean. Boot (`/tmp` script, built `dist`): worker exits 0 with and without `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` (nothing listening); api serves `/health` 200 and `/v1/staff/audit-log` 401 both ways, SIGTERM exits 143 | 8.2.1–8.2.6 |
| B spans, allowlist, `withPortSpan()`, relay/job/consumer spans | this commit | `telemetry/spans.test.ts` 10/10 (planted `http.request.header.authorization`, cookie, `url.full`, `url.query`, `http.target`, user agent, client address, body dropped; phone, email, bearer in an allowed attribute redacted; exception events only, message redacted; root job span, nested consumer span; `DelayedError` not an error; `withPortSpan` §10 attributes, `ProviderFailure` outcome and status); `test/telemetry.http.test.ts` 3/3 (one server span per request: server request id = `X-Request-Id`, `elx.surface`, route template and span name `GET /v1/platform/outbox/:outbox_id`, no path value, query or phone; `elx.operation_id`; a client's id never on the span). Red (processor passing spans through unfiltered): 6 failed / 16 passed; green 22/22. Integration `telemetry.test.ts` 2/2 (staff request: `elx.account.id`, `staff`, `listAuditLog`, no token or query; `outbox.job` CONSUMER root span with row id, kind, account, correlation, event type, attempt, result, no payload); outbox-workers, -consumers, -relay, -outcomes, tenancy, cross-tenant + telemetry 67/67; api unit 303/303. End to end (built `dist`, stand-in OTLP collector on 4399, `/tmp` scripts): exported `GET /v1/platform/outbox/:outbox_id` and Express handler spans with `service.version` `sha-e2e`, `elx.request_id`, `elx.surface`; no path id, phone or bearer in the payload; flushed on SIGTERM | 8.2.7–8.2.11 |
| C metrics catalogue, outbox gauge job | this commit | `telemetry/metrics.test.ts` 4/4 (every integrations §10 and platform §7 metric declared as an instrument; no label named for personal data; counters, histograms, gauges and observed gauges recorded with declared labels only, an undeclared label dropped; a phone (with or without `+`, local `05…`), email or free-text label value becomes `invalid`, UUIDs and event types kept); `worker.test.ts` updated (job lists end with `outbox-gauges`; the gauge run at boot and again after 30 s); integration `outbox-gauges.test.ts` 2/2 (planted `internal_event` row due 10 min ago: oldest-due gauge ≥ 600 s; planted dead row: `outbox_rows{status=dead}` ≥ 1; all seven kinds reported; a failed read keeps the previous values and logs `Outbox gauges skipped: Error`); outbox suites + gauges + telemetry 71/71; api unit 307/307; `test:architecture` clean; typecheck, lint clean | 8.2.12–8.2.15 |
| D JSON logger, redactor across the kernel | this commit | `telemetry/redact.test.ts` 42/42 (six phone spellings masked to the last two digits; ids, counts, timestamps and UUIDs untouched; email masked; bearer, basic, digest, JWT, URL user-info, secret and personal query and JSON pairs; control characters; caps; 17 withheld keys, 7 kept keys; nested values, errors as class and message, depth, item count, cycles, `__proto__`, bigint); `telemetry/logger.test.ts` 7/7 (line shape: `ts`, `level`, `msg`, `context`, `service`, `release`, one line, newline-terminated; a phone planted in the message, an object argument, an error message and a stack comes out `[phone …78]`, a `token` value withheld; `account_id`, `trace_id`, `span_id` inside a unit of work and a span; server `request_id` and `client_request_id` apart inside the middleware scope; level filter; every `new Logger(context)` writes through it after `Logger.overrideLogger`; a cycle never throws). Red (phone masking removed from `redactText`): 10 failed / 39 passed; green 49/49. `last_error` now through the same redactor: outbox unit and `outbox-outcomes`, `outbox-workers`, `telemetry` integration 20/20. api unit 356/356; typecheck, lint, `test:architecture` clean. Boot: api and worker write JSON lines (`service`, `release`); `/ready`'s `Not ready` warning carries `request_id`, `trace_id`, `span_id`; with the stand-in collector: logs (32 records, `context`, `request_id` attributes), traces and metrics (`http_request_duration_ms` by route template, `ready_checks` by check; the instrumentation's `http.server.*` metrics dropped) exported, no path id or phone in any payload | 8.2.16–8.2.19 |

### 8.1 Skills, documents and versions consulted

### 8.2 Interpretations the lead should check

### 8.3 Not done here

## 9. Lead review and adversary

Adversary: required (private data in telemetry; secrets).
