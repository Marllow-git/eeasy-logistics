import { SpanKind } from '@opentelemetry/api';
import { ProviderFailure } from '../outbox/provider-failure.js';
import { getMetrics } from './metrics.js';
import { withSpan } from './spans.js';

// One span per port call (PLAT-14 plan 2.2; integrations §10): `integration.<port>.<method>` with
// provider, account id, outcome, HTTP status, attempt and outbox row id. Adapters of the later
// orders (PLAT-9 messaging, the INT orders) wrap every provider call in `withPortSpan()`; bodies,
// phone numbers and template parameters are never attributes.

/** Outcome of a port call: `ok`, or the `ProviderFailure` reason, or `error` for anything else. */
export type PortOutcome = 'ok' | ProviderFailure['reason'] | 'error';

export interface PortCall {
  /** The port, in snake case: `message_sender`, `geocoder`, `object_storage`. */
  readonly port: string;
  /** The port method: `send`, `geocode`, `delete_many`. */
  readonly method: string;
  /** The adapter's provider: `meta`, `bsp`, `hudhud`, `stub`. */
  readonly provider: string;
  readonly accountId?: string | null;
  readonly outboxRowId?: string;
  /** The outbox attempt this call belongs to (1 for the first). */
  readonly attempt?: number;
}

/** What the call reports while it runs: the provider's HTTP status, once known. */
export interface PortSpan {
  setHttpStatus(status: number): void;
}

/** The outcome of a thrown failure. */
export function portOutcomeOf(error: unknown): PortOutcome {
  return error instanceof ProviderFailure ? error.reason : 'error';
}

const identifier = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Runs one provider call inside its span. A thrown `ProviderFailure` sets the outcome to its
 * reason and the HTTP status to its status, then is rethrown unchanged.
 */
export async function withPortSpan<T>(
  call: PortCall,
  fn: (span: PortSpan) => Promise<T>,
): Promise<T> {
  // Port and method name the span; a value that is not an identifier would make it unbounded.
  if (!identifier.test(call.port) || !identifier.test(call.method)) {
    throw new Error('withPortSpan: port and method are snake_case identifiers');
  }
  return withSpan(
    `integration.${call.port}.${call.method}`,
    {
      'integration.port': call.port,
      'integration.method': call.method,
      'integration.provider': call.provider,
      'elx.account.id': call.accountId ?? undefined,
      'elx.outbox.row_id': call.outboxRowId,
      'integration.attempt': call.attempt,
    },
    async (span) => {
      const started = performance.now();
      // integrations §10 metrics, by port and provider (never the account or the row).
      const count = (outcome: PortOutcome) => {
        const metrics = getMetrics();
        const labels = { port: call.port, provider: call.provider };
        metrics.add('integration_calls_total', 1, { ...labels, outcome });
        metrics.record('integration_latency_ms', performance.now() - started, labels);
      };
      try {
        const result = await fn({
          setHttpStatus: (status) => span.setAttribute('http.response.status_code', status),
        });
        span.setAttribute('integration.outcome', 'ok');
        count('ok');
        return result;
      } catch (error) {
        const outcome = portOutcomeOf(error);
        span.setAttribute('integration.outcome', outcome);
        if (error instanceof ProviderFailure && typeof error.status === 'number') {
          span.setAttribute('http.response.status_code', error.status);
        }
        count(outcome);
        throw error;
      }
    },
    { kind: SpanKind.CLIENT },
  );
}
