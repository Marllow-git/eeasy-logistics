// Scrubbing both web apps apply before an error report or an analytics event leaves the browser or
// the Next.js server (PLAT-14 plan 2.7, 2.8; web §10.4). Pure functions, no SDK dependency: the
// apps wire them into @sentry/nextjs (`beforeSend`), the /monitoring tunnel and posthog-js
// (`before_send`).
export { isRecipientPath, scrubAnalyticsEvent, type AnalyticsCapture } from './analytics';
export { maxInputLength, redactText, scrubPath, scrubUrl } from './redact';
export {
  filterSentryEnvelope,
  maxEnvelopeBytes,
  scrubSentryEvent,
  type EnvelopeDecision,
} from './sentry';
