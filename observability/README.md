# Observability

What the api, the worker and the two web apps emit (PLAT-14) and the alert rules that watch it. Platform §7 and integrations §4.5 and §10 are the source; ADR-0036 sets the per-kind outbox thresholds.

## Signals

- **Traces, metrics, logs:** OpenTelemetry in `apps/api` (`src/modules/kernel/telemetry/`), pushed over OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` (`/v1/traces`, `/v1/metrics` every 30 s, `/v1/logs`). Unset: nothing leaves the process. Resource: `service.name` `elx-api` or `elx-worker`, `service.version` = the image tag (`ELX_RELEASE`, `sha-<commit>`), `deployment.environment(.name)` = `APP_ENV`. The migrate role emits nothing.
- **Span attributes** are an allowlist enforced at export (`spans.ts`): request id, account id (`elx.account.id`), surface, operation id, route template, status, outbox row id and kind, correlation id, port, provider, outcome, attempt. Never a path value, query string, header or body; strings pass the redactor.
- **Metrics** are the catalogue in `metrics.ts`; label values that could be a phone number, email or free text become `invalid`.
- **Logs** are one JSON line per event on stdout (`ts`, `level`, `msg`, `context`, `request_id`, `account_id`, `trace_id`, `span_id`, `service`, `release`), every argument through the redactor (`redact.ts`: credentials and tokens in URL paths, phone numbers kept as their last four digits, emails, secret and personal keys).
- **Errors:** Sentry when `SENTRY_DSN` is set: `internal_error` (500) and failed worker jobs only, scrubbed by `beforeSend` (no request body, cookie, header, URL, query, user or local variables).

## Web and admin

`apps/web` and `apps/admin` (web §9, §10.4; plan 2.7 to 2.9). Public values come from `publicConfig()` and are inlined at build: `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (default `https://eu.i.posthog.com`), `NEXT_PUBLIC_RELEASE` (the image tag, `sha-<commit>`, from the Dockerfile build argument) and `NEXT_PUBLIC_APP_ENV`. An unset DSN or key turns that signal off; an invalid public configuration turns both off with one warning and never fails a page.

- **Errors (Sentry, `@sentry/nextjs`).** Server: `src/instrumentation.ts` loads the SDK in the Node.js runtime and reports what Next.js catches (`onRequestError`) with the error digest as the tag `request_id` and the route template, never the request. Browser: the SDK loads after the page's `load` event (`src/observability/sentry-client.ts`) and posts to `/monitoring` on the app's own origin without cookies. `/monitoring` forwards only envelopes for the configured DSN, only error events, each scrubbed again. No tracing, replay, breadcrumbs, user or default PII.
- **Scrubbing.** `@eeasy-logistics/ui/observability` is the one implementation: URLs keep origin and path, recipient and invitation tokens become `:token`, phone numbers keep their last four digits, emails, JWTs, credentials and token-shaped strings are redacted; Sentry events lose cookies, headers (`Authorization`, `X-Recipient-Token`), bodies, query strings, users, breadcrumbs and extra data.
- **Error pages.** `error.tsx` per route group renders `ErrorState` inside the group's shell; `global-error.tsx` renders it full-page in the preferred locale. Each shows a reference support can search Sentry for: the digest of a server error (tag `request_id`) or the event id of a browser error, with copy, retry and home.
- **Product analytics (PostHog, `posthog-js`).** The slim build loads after `load` and posts to `/ingest/*`, which forwards PostHog's capture endpoints only, without cookies, address or user agent. Events are the typed catalogue of `src/analytics.ts` (`<area>.<object>.<action>`, ids and enums only, enforced by the type) plus one page view per page load; `before_send` scrubs every URL and string. No autocapture, replay, surveys, flags or external scripts; recipients get no person profile and nothing is stored on their device.
- **Census.** The CI census lanes build with fake targets on `.invalid` hosts and intercept `/monitoring` and `/ingest` in the browser: `tests/census-errors.spec.ts` (error pages in `ar` and `en`, the tunnel) and `tests/census-analytics.spec.ts` (no token, phone, name or cookie in any event; `expectAnalyticsEvents`). The `census-fault` routes that throw on purpose exist only in local and ci builds.

## Alert rules

`alerts.yaml` lists every alert of platform §7 and integrations §4.5 and §10 in a provider-neutral shape (name, source, metric and labels, condition, threshold, window, severity, runbook, origin). Rules marked `pending` name the order whose code first emits their series; until then they never fire. `apps/api/test/alerts.test.ts` validates the file: the shape, unique names, every metric in the catalogue, every label declared on its metric (unless pending), and the ADR-0036 thresholds.

## Edge

`/monitoring` and `/ingest/*` take anonymous POSTs on every web and admin hostname. Each reads at most its cap (256 kB, 512 kB) while streaming and refuses a body without `Content-Length` (411); `/monitoring` passes Sentry's 429, `X-Sentry-Rate-Limits` and `Retry-After` back so the browser SDK backs off. A per-IP rate rule for both routes belongs at the edge and is OPS-1's (PLAT-14 adversary W-2).

## Not here

OPS-1 turns `alerts.yaml` into the host's alerting, routes it to the owner's channel and runs the collector (no collector container in this repository, owner ruling A-24); it also decides how the web images get their public values (today an image is built without DSN, key or environment and reports nothing) and uploads source maps. Dashboards are not part of PLAT-14; the driver app's Sentry and PostHog are DRV-1's.
