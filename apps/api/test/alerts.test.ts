import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { metricCatalogue } from '../src/modules/kernel/telemetry/metrics.js';

// PLAT-14 item E (plan 2.6): observability/alerts.yaml validated by a schema, its metrics checked
// against the catalogue and its outbox thresholds against integrations §4.5 / ADR-0036.

const duration = /^\d+(s|m|h)$/;

const rule = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    source: z.enum(['metric', 'log', 'host']),
    metric: z.string().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    condition: z.string().regex(/^(value|max|min|p95|increase|rate) (>|>=|<|<=|==) threshold$/),
    threshold: z.number(),
    window: z.string().regex(duration),
    severity: z.enum(['page', 'warn']),
    runbook: z.string().min(1),
    origin: z.string().min(1),
    pending: z.string().min(1).optional(),
  })
  .strict()
  .refine((entry) => (entry.source === 'metric') === (entry.metric !== undefined), {
    message: 'a metric rule names its metric, and only a metric rule does',
  });

const file = z.object({ version: z.literal(1), rules: z.array(rule).min(1) }).strict();

const text = readFileSync(new URL('../../../observability/alerts.yaml', import.meta.url), 'utf8');
const alerts = file.parse(parse(text));
const byName = new Map(alerts.rules.map((entry) => [entry.name, entry]));

const seconds = (window: string): number => {
  const value = Number.parseInt(window, 10);
  return window.endsWith('h') ? value * 3600 : window.endsWith('m') ? value * 60 : value;
};

describe('observability/alerts.yaml', () => {
  it('matches the schema, with unique names', () => {
    expect(byName.size).toBe(alerts.rules.length);
  });

  it('refuses an entry outside the schema (the schema is not a pass-through)', () => {
    const bad = { ...alerts.rules[0], severity: 'urgent', extra: true };
    expect(file.safeParse({ version: 1, rules: [bad] }).success).toBe(false);
  });

  it('names only metrics of the catalogue, filtered by their declared labels', () => {
    for (const entry of alerts.rules) {
      if (entry.metric === undefined) continue;
      expect(Object.keys(metricCatalogue), entry.name).toContain(entry.metric);
      const declared: readonly string[] =
        metricCatalogue[entry.metric as keyof typeof metricCatalogue].labels;
      if (entry.pending !== undefined) continue;
      for (const label of Object.keys(entry.labels ?? {})) {
        expect(declared, `${entry.name}: ${label}`).toContain(label);
      }
    }
  });

  it('holds every alert of platform §7', () => {
    for (const name of [
      'ready_failing',
      'api_latency_p95',
      'outbox_due_internal_event',
      'outbox_dead_internal_event',
      'ledger_assertion_not_green',
      'otp_failure_spike',
      'disk_usage_high',
      'backup_job_failed',
    ]) {
      expect(byName.has(name), name).toBe(true);
    }
    expect(byName.get('api_latency_p95')).toMatchObject({ threshold: 800, window: '5m' });
  });

  it('holds the ADR-0036 oldest-due thresholds per kind (integrations §4.5)', () => {
    const thresholds: Record<string, number> = {
      outbox_due_otp_message: 30,
      outbox_due_message: 120,
      outbox_due_push: 60,
      outbox_due_carrier_call: 120,
      outbox_due_internal_event: 300,
      outbox_due_channel_publish: 1800,
      outbox_due_webhook: 1800,
      outbox_due_storage_lifecycle: 6 * 3600,
    };
    for (const [name, threshold] of Object.entries(thresholds)) {
      expect(byName.get(name), name).toMatchObject({
        metric: 'outbox_due_oldest_age_seconds',
        threshold,
      });
    }
  });

  it('pages on every dead row of the ADR-0036 kinds and rates the merchant-side ones', () => {
    for (const kind of ['internal_event', 'message', 'carrier_call', 'storage_lifecycle']) {
      expect(byName.get(`outbox_dead_${kind}`)).toMatchObject({
        metric: 'outbox_dead_total',
        labels: { kind },
        condition: 'increase > threshold',
        threshold: 0,
        severity: 'page',
      });
    }
    for (const kind of ['webhook', 'channel_publish']) {
      const entry = byName.get(`outbox_dead_${kind}_rate`);
      expect(entry).toMatchObject({ labels: { kind }, threshold: 20, severity: 'warn' });
      expect(seconds(entry?.window ?? '0s')).toBe(3600);
    }
  });

  it('holds the integrations §10 alerts', () => {
    for (const name of [
      'breaker_open',
      'inbound_rejected_rate',
      'inbound_unmappable',
      'channel_token_refresh_failed',
    ]) {
      expect(byName.has(name), name).toBe(true);
    }
    expect(seconds(byName.get('breaker_open')?.window ?? '0s')).toBe(300);
  });
});
