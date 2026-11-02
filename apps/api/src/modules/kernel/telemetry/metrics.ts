import type {
  Attributes,
  Counter,
  Gauge,
  Histogram,
  Meter,
  ObservableGauge,
  ObservableResult,
} from '@opentelemetry/api';
import { metrics as metricsApi } from '@opentelemetry/api';

// The metric catalogue (PLAT-14 plan 2.3; platform §7; integrations §10) as typed instruments on
// the OpenTelemetry meter, pushed over OTLP (no Prometheus endpoint here). Labels are ids, enum
// values and route templates only: a value that could be a phone number, an email or free text is
// replaced by `invalid` before it reaches the meter.

/** How each instrument is declared: its kind, unit and label names. */
interface Declaration {
  readonly kind: 'counter' | 'histogram' | 'gauge' | 'observed';
  readonly description: string;
  readonly unit?: string;
  readonly labels: readonly string[];
}

/**
 * Every metric of platform §7 and integrations §10, by name (the names the alert rules in
 * `observability/alerts.yaml` use). `observed` gauges report the last values a job stored.
 */
export const metricCatalogue = {
  // integrations §10: port calls (recorded by `withPortSpan`)
  integration_calls_total: {
    kind: 'counter',
    description: 'Provider calls through a port, by outcome',
    labels: ['port', 'provider', 'outcome'],
  },
  integration_latency_ms: {
    kind: 'histogram',
    description: 'Provider call latency',
    unit: 'ms',
    labels: ['port', 'provider'],
  },
  integration_breaker_state: {
    kind: 'gauge',
    description: 'Circuit breaker state per port and provider: 0 closed, 1 half-open, 2 open',
    labels: ['port', 'provider'],
  },
  // integrations §10, ADR-0036: the outbox (observed by the 30 s worker job)
  outbox_due_oldest_age_seconds: {
    kind: 'observed',
    description:
      'Age of the oldest due, unsent outbox row per kind and template class (otp, other, n/a)',
    unit: 's',
    labels: ['kind', 'template_class'],
  },
  outbox_rows: {
    kind: 'observed',
    description: 'Open and dead outbox rows per kind and status (queue depth)',
    labels: ['kind', 'status'],
  },
  outbox_dead_total: {
    kind: 'counter',
    description: 'Outbox rows that ended dead, per kind',
    labels: ['kind'],
  },
  outbox_rows_without_handler: {
    kind: 'observed',
    description: 'Due outbox rows of kinds with no handler in this build (PLAT-8 sweeper)',
    labels: [],
  },
  // integrations §10: inbound webhooks, messaging, channels, geo (later orders record them)
  inbound_webhooks_total: {
    kind: 'counter',
    description: 'Inbound provider webhooks by verification status',
    labels: ['provider', 'status'],
  },
  messages_sent_total: {
    kind: 'counter',
    description: 'Messages sent by template and locale (PLAT-9)',
    labels: ['template', 'locale'],
  },
  messages_skipped_total: {
    kind: 'counter',
    description: 'Messages not sent, by reason (PLAT-9)',
    labels: ['reason'],
  },
  messaging_sender_alerts_total: {
    kind: 'counter',
    description:
      'Senders that need a person: needs_relink or banned (ADR-0041), or credentials refused (unauthorised, adversary M-3) (PLAT-9)',
    labels: ['event', 'sender'],
  },
  message_budget_used_ratio: {
    kind: 'gauge',
    description: 'Share of the monthly message budget an account used (PLAT-9)',
    labels: ['account'],
  },
  // INT-4 plan 2.9: push messages by outcome (per message), and receipts by status.
  push_messages_total: {
    kind: 'counter',
    description:
      'Push messages by outcome: sent, device_not_registered, rate_limited, transient, permanent, unauthorised, stale, no_device (INT-4)',
    labels: ['outcome'],
  },
  push_receipts_total: {
    kind: 'counter',
    description: 'Push receipts checked, by status: ok, error, no_receipt (INT-4)',
    labels: ['status'],
  },
  // INT-2 plan 2.8: one count per source asked by the chain (miss, not_found, a failure reason,
  // breaker_open) and per service call answered from the cache (hit) or degraded (unavailable).
  geocoder_calls_total: {
    kind: 'counter',
    description:
      'Geocoder calls by method, source and outcome: hit, miss, not_found, rate_limited, unauthorised, permanent, transient, breaker_open, unavailable (INT-2)',
    labels: ['method', 'source', 'outcome'],
  },
  // DEL-5 plan 2.6 (domain model §7 telemetry signals): driver location points by outcome
  // (accepted, or the reason one was dropped: stale, future, too_old), the lag server_ts −
  // client_ts of each accepted point, and the live shifts (set by the shift sweeper, leg 2).
  driver_pings_total: {
    kind: 'counter',
    description: 'Driver location points by outcome: accepted, stale, future, too_old (DEL-5)',
    labels: ['outcome'],
  },
  driver_ping_lag_ms: {
    kind: 'histogram',
    description: 'Lag between a point’s device time and its arrival (server_ts − client_ts, DEL-5)',
    unit: 'ms',
    labels: [],
  },
  active_shifts: {
    kind: 'observed',
    description: 'Driver shifts active or paused, per status (DEL-5)',
    labels: ['status'],
  },
  channel_publication_drift: {
    kind: 'gauge',
    description: 'Stock publications behind per channel connection (INT orders)',
    labels: ['connection'],
  },
  geocode_low_confidence_total: {
    kind: 'counter',
    description: 'Geocoding answers below the confidence threshold',
    labels: [],
  },
  matrix_cache_hit_ratio: {
    kind: 'gauge',
    description: 'Distance-matrix cache hit ratio',
    labels: [],
  },
  // platform §7
  http_request_duration_ms: {
    kind: 'histogram',
    description: 'API request latency by route template, method and status',
    unit: 'ms',
    labels: ['route', 'method', 'status'],
  },
  ready_checks: {
    kind: 'gauge',
    description: 'Readiness checks: 1 passing, 0 failing',
    labels: ['check'],
  },
  otp_requests_refused_total: {
    kind: 'counter',
    description:
      'OTP requests refused: cooldown, unavailable, or the budget that refused them (PLAT-9, adversary M-1)',
    labels: ['reason'],
  },
  otp_failures_total: {
    kind: 'counter',
    description: 'Failed OTP sends and verifications, by stage (PLAT-11)',
    labels: ['stage'],
  },
  // PLAT-11 plan 2.15: the sign-in doors (staff and platform).
  auth_logins_total: {
    kind: 'counter',
    description:
      'Password steps of login and platformLogin by outcome: ok, second_factor, invalid_credentials, rate_limited (PLAT-11)',
    labels: ['surface', 'outcome'],
  },
  auth_refresh_total: {
    kind: 'counter',
    description: 'Session refreshes by outcome: ok, grace, reuse_revoked, invalid (PLAT-11)',
    labels: ['surface', 'outcome'],
  },
  auth_family_revocations_total: {
    kind: 'counter',
    description:
      'Refresh families revoked, by reason: reuse, logout, switch_account, password_reset, revoked (PLAT-11)',
    labels: ['reason'],
  },
  ledger_assertion_drift: {
    kind: 'gauge',
    description: 'Difference found by the nightly ledger assertion, per ledger (ledger orders)',
    labels: ['ledger'],
  },
  sse_connections: {
    kind: 'gauge',
    description: 'Open server-sent-event connections per surface',
    labels: ['surface'],
  },
} as const satisfies Record<string, Declaration>;

export type MetricName = keyof typeof metricCatalogue;
type LabelsOf<N extends MetricName> = (typeof metricCatalogue)[N]['labels'][number];
export type Labels<N extends MetricName> = Readonly<Record<LabelsOf<N>, string | number>>;

/** A label value as it reaches the meter: an id, enum value, number or route template. */
const labelPattern = /^[A-Za-z0-9_.:/{}-]{1,128}$/;
/** Eight digits or more in a row: possibly a phone number, never an id we use. */
const longDigits = /\d{8,}/;
export const invalidLabel = 'invalid';

/** `value` if it is a safe label, else `invalid` (plan 2.3: no phone, email or free text). */
export function safeLabel(value: string | number): string | number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : invalidLabel;
  if (!labelPattern.test(value)) return invalidLabel;
  // UUIDs keep their digits apart (hyphens); a phone number written without `+` does not.
  if (longDigits.test(value.replaceAll('-', '')) && !isUuidLike(value)) return invalidLabel;
  return value;
}

const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuidLike(value: string): boolean {
  return uuidLike.test(value);
}

/** The declared labels of `name`, every value through `safeLabel`; undeclared labels dropped. */
export function labelsFor<N extends MetricName>(name: N, labels: Labels<N>): Attributes {
  const out: Attributes = {};
  const declared: readonly string[] = metricCatalogue[name].labels;
  for (const key of declared) {
    const value = (labels as Record<string, string | number | undefined>)[key];
    if (value !== undefined) out[key] = safeLabel(value);
  }
  return out;
}

type Instrument = Counter | Histogram | Gauge | ObservableGauge;

/**
 * The instruments of the catalogue on one meter. `add`, `record` and `set` never throw: a metric
 * is never a reason for the code it observes to fail.
 */
export class Metrics {
  readonly #instruments = new Map<MetricName, Instrument>();
  /** Last values of each observed gauge, by label set. */
  readonly #observed = new Map<MetricName, Map<string, { labels: Attributes; value: number }>>();

  constructor(meter: Meter) {
    for (const [name, declaration] of Object.entries(metricCatalogue) as [
      MetricName,
      Declaration,
    ][]) {
      const options = {
        description: declaration.description,
        ...(declaration.unit === undefined ? {} : { unit: declaration.unit }),
      };
      switch (declaration.kind) {
        case 'counter':
          this.#instruments.set(name, meter.createCounter(name, options));
          break;
        case 'histogram':
          this.#instruments.set(name, meter.createHistogram(name, options));
          break;
        case 'gauge':
          this.#instruments.set(name, meter.createGauge(name, options));
          break;
        case 'observed': {
          const gauge = meter.createObservableGauge(name, options);
          const values = new Map<string, { labels: Attributes; value: number }>();
          this.#observed.set(name, values);
          gauge.addCallback((result: ObservableResult) => {
            for (const entry of values.values()) result.observe(entry.value, entry.labels);
          });
          this.#instruments.set(name, gauge);
          break;
        }
      }
    }
  }

  /** The declared instrument names (the catalogue test reads them). */
  get names(): readonly MetricName[] {
    return [...this.#instruments.keys()];
  }

  /** Adds to a counter. */
  add<N extends MetricName>(name: N, value: number, labels: Labels<N>): void {
    try {
      (this.#instruments.get(name) as Counter | undefined)?.add(value, labelsFor(name, labels));
    } catch {
      // never fails the caller
    }
  }

  /** Records a histogram value. */
  record<N extends MetricName>(name: N, value: number, labels: Labels<N>): void {
    try {
      (this.#instruments.get(name) as Histogram | undefined)?.record(
        value,
        labelsFor(name, labels),
      );
    } catch {
      // never fails the caller
    }
  }

  /** Sets a synchronous gauge, or the stored value of an observed gauge for these labels. */
  set<N extends MetricName>(name: N, value: number, labels: Labels<N>): void {
    try {
      const attributes = labelsFor(name, labels);
      const observed = this.#observed.get(name);
      if (observed !== undefined) {
        observed.set(JSON.stringify(attributes), { labels: attributes, value });
        return;
      }
      (this.#instruments.get(name) as Gauge | undefined)?.record(value, attributes);
    } catch {
      // never fails the caller
    }
  }
}

let shared: Metrics | undefined;

/**
 * The process's metrics on the global meter. Created on first use, which comes after main.ts
 * started the SDK; without telemetry the global meter is a no-op and so is every call.
 */
export function getMetrics(): Metrics {
  shared ??= new Metrics(metricsApi.getMeter('elx'));
  return shared;
}
