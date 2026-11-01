import { describe, expect, it } from 'vitest';
import { testMetrics } from '../../../../test/support/metrics.js';
import { invalidLabel, metricCatalogue, safeLabel } from './metrics.js';

// PLAT-14 item C (plan 2.3): the catalogue of platform §7 and integrations §10, and label safety.

/** integrations §10 "Metrics", verbatim. */
const integrationsSection10 = [
  'integration_calls_total',
  'integration_latency_ms',
  'integration_breaker_state',
  'outbox_due_oldest_age_seconds',
  'outbox_rows',
  'outbox_dead_total',
  'inbound_webhooks_total',
  'messages_sent_total',
  'messages_skipped_total',
  'message_budget_used_ratio',
  'channel_publication_drift',
  'geocode_low_confidence_total',
  'matrix_cache_hit_ratio',
];

/** platform §7: request latency, queue depth, outbox age, ledger drift, OTP failures, SSE. */
const platformSection7 = [
  'http_request_duration_ms',
  'outbox_rows',
  'outbox_due_oldest_age_seconds',
  'ledger_assertion_drift',
  'otp_failures_total',
  'sse_connections',
  'ready_checks',
];

describe('the metric catalogue', () => {
  it('declares every metric of integrations §10 and platform §7 as an instrument', () => {
    const { metrics } = testMetrics();
    for (const name of [...integrationsSection10, ...platformSection7]) {
      expect(Object.keys(metricCatalogue), name).toContain(name);
      expect(metrics.names, name).toContain(name);
    }
    expect(metrics.names).toHaveLength(Object.keys(metricCatalogue).length);
  });

  it('labels no metric with a phone, email, body or free-text name', () => {
    for (const [name, declaration] of Object.entries(metricCatalogue)) {
      for (const label of declaration.labels) {
        expect(`${name}{${label}}`).not.toMatch(/phone|email|name\b|body|text|message\b|address/);
      }
    }
  });

  it('records counters, histograms and gauges with their declared labels only', async () => {
    const { metrics, collect } = testMetrics();
    metrics.add('integration_calls_total', 1, {
      port: 'geocoder',
      provider: 'stub',
      outcome: 'ok',
    });
    metrics.record('http_request_duration_ms', 12, {
      route: '/v1/staff/orders/:order_id',
      method: 'GET',
      status: 200,
    });
    metrics.set('ready_checks', 0, { check: 'redis' });
    metrics.set('outbox_rows', 4, { kind: 'push', status: 'pending' });
    metrics.add('outbox_dead_total', 1, { kind: 'push', extra: 'dropped' } as never);
    const points = await collect();
    const byName = (name: string) => points.filter((point) => point.name === name);
    expect(byName('integration_calls_total')[0]).toMatchObject({
      attributes: { port: 'geocoder', provider: 'stub', outcome: 'ok' },
      value: 1,
    });
    expect(byName('http_request_duration_ms')[0]?.attributes).toEqual({
      route: '/v1/staff/orders/:order_id',
      method: 'GET',
      status: 200,
    });
    expect(byName('ready_checks')[0]).toMatchObject({ attributes: { check: 'redis' }, value: 0 });
    expect(byName('outbox_rows')[0]).toMatchObject({
      attributes: { kind: 'push', status: 'pending' },
      value: 4,
    });
    expect(byName('outbox_dead_total')[0]?.attributes).toEqual({ kind: 'push' });
  });

  it('replaces a phone number, email or free text label value by `invalid`', async () => {
    expect(safeLabel('+966512345678')).toBe(invalidLabel);
    expect(safeLabel('966512345678')).toBe(invalidLabel);
    expect(safeLabel('0512345678')).toBe(invalidLabel);
    expect(safeLabel('a@b.example')).toBe(invalidLabel);
    expect(safeLabel('order for Sara')).toBe(invalidLabel);
    expect(safeLabel('0192f0e0-1234-7000-8000-00000000abcd')).toBe(
      '0192f0e0-1234-7000-8000-00000000abcd',
    );
    expect(safeLabel('core.account.suspended')).toBe('core.account.suspended');
    const { metrics, collect } = testMetrics();
    metrics.add('messages_skipped_total', 1, { reason: '+966512345678' });
    const [point] = await collect();
    expect(point?.attributes).toEqual({ reason: invalidLabel });
  });
});
