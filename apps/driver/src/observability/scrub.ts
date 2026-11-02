// What may leave the phone in a Sentry event (driver app §11, DRV-1 plan 2.10): ids stay; names,
// phones, PINs, codes, tokens, addresses and request bodies go. Pure, so Jest tests it without the SDK.

/** The parts of a Sentry event this scrubber touches (structurally compatible with `ErrorEvent`). */
export interface ScrubbableEvent {
  message?: string;
  user?: { id?: string | number; [key: string]: unknown };
  request?: {
    url?: string;
    data?: unknown;
    headers?: unknown;
    cookies?: unknown;
    query_string?: unknown;
  };
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[];
  exception?: { values?: { value?: string }[] };
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
}

// Bearer and JWT-like tokens, then runs of four or more digits (phones, codes and PINs are digits).
const patterns: [RegExp, string][] = [
  [/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]'],
  [/\+?\d[\d\s-]{2,}\d/g, '[number]'],
];

export function scrubText(value: string): string {
  return patterns.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.message !== undefined) event.message = scrubText(event.message);
  if (event.user !== undefined)
    event.user = event.user.id === undefined ? {} : { id: event.user.id };
  if (event.request !== undefined) {
    event.request = event.request.url === undefined ? {} : { url: scrubText(event.request.url) };
  }
  for (const value of event.exception?.values ?? []) {
    if (value.value !== undefined) value.value = scrubText(value.value);
  }
  if (event.breadcrumbs !== undefined) {
    event.breadcrumbs = event.breadcrumbs.map((crumb) => ({
      ...crumb,
      message: crumb.message === undefined ? undefined : scrubText(crumb.message),
      data: undefined,
    }));
  }
  delete event.extra;
  return event;
}
