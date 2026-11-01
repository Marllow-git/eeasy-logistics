# Observability

What the api and worker emit (PLAT-14) and the alert rules that watch it. Platform §7 and integrations §4.5 and §10 are the source; ADR-0036 sets the per-kind outbox thresholds.

## Signals

- **Traces, metrics, logs:** OpenTelemetry in `apps/api` (`src/modules/kernel/telemetry/`), pushed over OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` (`/v1/traces`, `/v1/metrics` every 30 s, `/v1/logs`). Unset: nothing leaves the process. Resource: `service.name` `elx-api` or `elx-worker`, `service.version` = the image tag (`ELX_RELEASE`, `sha-<commit>`), `deployment.environment(.name)` = `APP_ENV`. The migrate role emits nothing.
- **Span attributes** are an allowlist enforced at export (`spans.ts`): request id, account id (`elx.account.id`), surface, operation id, route template, status, outbox row id and kind, correlation id, port, provider, outcome, attempt. Never a path value, query string, header or body; strings pass the redactor.
- **Metrics** are the catalogue in `metrics.ts`; label values that could be a phone number, email or free text become `invalid`.
- **Logs** are one JSON line per event on stdout (`ts`, `level`, `msg`, `context`, `request_id`, `account_id`, `trace_id`, `span_id`, `service`, `release`), every argument through the redactor (`redact.ts`: credentials and tokens in URL paths, phone numbers kept as their last four digits, emails, secret and personal keys).
- **Errors:** Sentry when `SENTRY_DSN` is set: `internal_error` (500) and failed worker jobs only, scrubbed by `beforeSend` (no request body, cookie, header, URL, query, user or local variables).

## Alert rules

`alerts.yaml` lists every alert of platform §7 and integrations §4.5 and §10 in a provider-neutral shape (name, source, metric and labels, condition, threshold, window, severity, runbook, origin). Rules marked `pending` name the order whose code first emits their series; until then they never fire. `apps/api/test/alerts.test.ts` validates the file: the shape, unique names, every metric in the catalogue, every label declared on its metric (unless pending), and the ADR-0036 thresholds.

## Not here

OPS-1 turns `alerts.yaml` into the host's alerting, routes it to the owner's channel and runs the collector (no collector container in this repository, owner ruling A-24). Dashboards are not part of PLAT-14.
