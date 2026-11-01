import { isRecipientPath, scrubAnalyticsEvent } from '@eeasy-logistics/ui/observability';
import type { PostHog } from 'posthog-js/dist/module.slim.no-external';
import { observabilityConfig } from './settings';

// PostHog in the browser (PLAT-14 plan 2.8, web §10.4): product events through the first-party
// /ingest proxy (the CSP stays 'self'), ids and enums only (typed in src/analytics.ts), page views
// with URLs scrubbed (recipient tokens as `:token`), no autocapture, no session replay, no
// surveys, no feature-flag or remote-config calls, no external scripts, and person profiles only
// for identified users (none yet; recipients never). Recipient pages keep no identity at all
// (memory persistence). The slim build without external loading is used, and only after the
// page's `load` event, as its own chunk (web §10.2).

/** Events captured before the SDK is in, sent once it is (bounded). */
const queue: [string, Record<string, unknown>][] = [];
const maxQueued = 50;

let client: PostHog | undefined;
let loading: Promise<void> | undefined;

function load(): Promise<void> {
  loading ??= (async () => {
    const config = observabilityConfig();
    if (config?.posthogKey === undefined) return;
    const { default: posthog } = await import('posthog-js/dist/module.slim.no-external');
    posthog.init(config.posthogKey, {
      api_host: '/ingest',
      ui_host: null,
      persistence: isRecipientPath(window.location.pathname) ? 'memory' : 'localStorage',
      person_profiles: 'identified_only',
      capture_pageview: 'history_change',
      capture_pageleave: false,
      autocapture: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_exceptions: false,
      capture_performance: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_web_experiments: true,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
      save_referrer: false,
      mask_all_text: true,
      mask_all_element_attributes: true,
      // Each event is sent when captured. The batch queue starts on DOMContentLoaded, which has
      // passed when this chunk loads after `load`, so batched events would never leave; the
      // product events are few (page views, error pages).
      request_batching: false,
      before_send: (capture) => scrubAnalyticsEvent(capture),
    });
    client = posthog;
    for (const [event, properties] of queue.splice(0)) posthog.capture(event, properties);
  })().catch(() => undefined);
  return loading;
}

/** Loads and starts PostHog (instrumentation-client.ts, after `load`) when a key is configured. */
export function startAnalytics(): void {
  void load();
}

/** Sends one product event; src/analytics.ts types the name and the properties. */
export function captureEvent(event: string, properties: Record<string, unknown>): void {
  if (client !== undefined) {
    client.capture(event, properties);
    return;
  }
  if (queue.length < maxQueued) queue.push([event, properties]);
  void load();
}
