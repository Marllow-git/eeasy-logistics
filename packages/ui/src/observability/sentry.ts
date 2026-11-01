import { isSecretKey, redactText, scrubUrl } from './redact';

// Sentry scrubbing for the web apps (PLAT-14 plan 2.7, web §10.4): `scrubSentryEvent` is the
// `beforeSend` of the browser and the Next.js server SDKs, and the /monitoring tunnel applies it
// again to every event it forwards (`filterSentryEnvelope`), so an outdated or altered browser
// bundle cannot send what the current one would not. Structural types only: this package does not
// depend on the Sentry SDK.

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Event fields kept as they are; everything else (user, breadcrumbs, extra, …) is dropped. */
const keptFields = [
  'event_id',
  'timestamp',
  'level',
  'platform',
  'logger',
  'release',
  'dist',
  'environment',
  'server_name',
  'sdk',
  'fingerprint',
  'debug_meta',
  'type',
] as const;

/** Contexts kept: runtime and device facts, the trace ids, React's component stack. */
const keptContexts = new Set(['runtime', 'os', 'browser', 'device', 'trace', 'react', 'app']);

const tagKey = /^[A-Za-z0-9_.:-]{1,32}$/;

function scrubFrame(frame: unknown): unknown {
  if (!isObject(frame)) return undefined;
  const kept: Json = {};
  for (const key of ['function', 'module', 'lineno', 'colno', 'in_app', 'platform']) {
    if (frame[key] !== undefined) kept[key] = frame[key];
  }
  for (const key of ['filename', 'abs_path']) {
    if (typeof frame[key] === 'string') kept[key] = scrubUrl(frame[key]);
  }
  return kept;
}

function scrubException(exception: unknown): unknown {
  if (!isObject(exception) || !Array.isArray(exception.values)) return undefined;
  return {
    values: exception.values.filter(isObject).map((value) => {
      const kept: Json = {};
      if (typeof value.type === 'string') kept.type = redactText(value.type);
      if (typeof value.value === 'string') kept.value = redactText(value.value);
      if (isObject(value.mechanism)) {
        kept.mechanism = { type: value.mechanism.type, handled: value.mechanism.handled };
      }
      if (isObject(value.stacktrace) && Array.isArray(value.stacktrace.frames)) {
        kept.stacktrace = { frames: value.stacktrace.frames.map(scrubFrame).filter(Boolean) };
      }
      return kept;
    }),
  };
}

function scrubMessage(message: unknown): unknown {
  if (typeof message === 'string') return redactText(message);
  if (!isObject(message)) return undefined;
  const text = typeof message.formatted === 'string' ? message.formatted : message.message;
  return typeof text === 'string' ? { formatted: redactText(text) } : undefined;
}

/**
 * A Sentry event reduced to what support needs: release, environment, level, the exception with
 * redacted messages and frames, tags with redacted values, the request method and the URL's
 * origin and path (token segments as `:token`), and the runtime contexts. No user, cookie,
 * header, query string, request body, breadcrumb, extra data or transaction name survives.
 */
export function scrubSentryEvent<Event extends object>(event: Event): Event {
  const source = event as Json;
  const result: Json = {};
  for (const field of keptFields) if (source[field] !== undefined) result[field] = source[field];

  const exception = scrubException(source.exception);
  if (exception !== undefined) result.exception = exception;
  const message = scrubMessage(source.message);
  if (message !== undefined) result.message = message;
  const logentry = scrubMessage(source.logentry);
  if (logentry !== undefined) result.logentry = logentry;

  if (isObject(source.tags)) {
    const tags: Json = {};
    for (const [key, value] of Object.entries(source.tags)) {
      if (!tagKey.test(key) || isSecretKey(key)) continue;
      if (typeof value === 'string') tags[key] = redactText(value);
      else if (typeof value === 'number' || typeof value === 'boolean') tags[key] = value;
    }
    result.tags = tags;
  }
  if (isObject(source.contexts)) {
    result.contexts = Object.fromEntries(
      Object.entries(source.contexts).filter(([key]) => keptContexts.has(key)),
    );
  }
  if (isObject(source.request)) {
    const request: Json = {};
    if (typeof source.request.method === 'string') request.method = source.request.method;
    if (typeof source.request.url === 'string') request.url = scrubUrl(source.request.url);
    result.request = request;
  }
  return result as Event;
}

/** Largest envelope the tunnel accepts: no replay or attachment is ever sent (plan 2.7). */
export const maxEnvelopeBytes = 256 * 1024;

/** Item types the tunnel forwards: error events and the SDK's dropped-event counters. */
const forwardedItems = new Set(['event', 'client_report']);

export type EnvelopeDecision =
  /** Forward `body` to `url` (the DSN's own project). */
  | { kind: 'forward'; url: string; body: Uint8Array<ArrayBuffer> }
  /** Nothing left to forward (every item was a type the tunnel drops). */
  | { kind: 'drop' }
  /** Not ours or not an envelope: answer with `status`. */
  | { kind: 'reject'; status: 400 | 413 };

interface Dsn {
  origin: string;
  pathPrefix: string;
  publicKey: string;
  projectId: string;
}

function parseDsn(value: unknown): Dsn | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    const projectId = parts.pop();
    if (!projectId || !/^\d+$/.test(projectId) || url.username === '') return undefined;
    return {
      origin: url.origin,
      pathPrefix: parts.length > 0 ? `/${parts.join('/')}` : '',
      publicKey: url.username,
      projectId,
    };
  } catch {
    return undefined;
  }
}

const newline = 0x0a;

/** Reads the line starting at `start`; returns its text and the index after its newline. */
function readLine(bytes: Uint8Array, start: number): [string, number] {
  let end = bytes.indexOf(newline, start);
  if (end === -1) end = bytes.length;
  return [new TextDecoder().decode(bytes.subarray(start, end)), end + 1];
}

/**
 * The tunnel's decision for one envelope (Sentry's envelope format: a JSON header line, then per
 * item a JSON item header line and its payload). It forwards only envelopes addressed to the
 * configured DSN (the tunnel is not an open proxy), only `event` and `client_report` items, and
 * re-scrubs every event; the envelope header keeps its event id, timestamp, DSN and SDK (no trace
 * context).
 */
export function filterSentryEnvelope(body: Uint8Array, configuredDsn: string): EnvelopeDecision {
  if (body.byteLength > maxEnvelopeBytes) return { kind: 'reject', status: 413 };
  const dsn = parseDsn(configuredDsn);
  if (dsn === undefined) return { kind: 'reject', status: 400 };
  try {
    const [headerLine, afterHeader] = readLine(body, 0);
    const header: unknown = JSON.parse(headerLine);
    if (!isObject(header)) return { kind: 'reject', status: 400 };
    const addressed = parseDsn(header.dsn);
    if (
      addressed === undefined ||
      addressed.origin !== dsn.origin ||
      addressed.pathPrefix !== dsn.pathPrefix ||
      addressed.projectId !== dsn.projectId ||
      addressed.publicKey !== dsn.publicKey
    ) {
      return { kind: 'reject', status: 400 };
    }

    const items: string[] = [];
    let position = afterHeader;
    while (position < body.length) {
      const [itemHeaderLine, afterItemHeader] = readLine(body, position);
      if (itemHeaderLine.trim() === '') {
        position = afterItemHeader;
        continue;
      }
      const itemHeader: unknown = JSON.parse(itemHeaderLine);
      if (!isObject(itemHeader) || typeof itemHeader.type !== 'string') {
        return { kind: 'reject', status: 400 };
      }
      let payload: string;
      if (typeof itemHeader.length === 'number') {
        const end = afterItemHeader + itemHeader.length;
        if (!Number.isInteger(itemHeader.length) || end > body.length) {
          return { kind: 'reject', status: 400 };
        }
        payload = new TextDecoder().decode(body.subarray(afterItemHeader, end));
        position = body[end] === newline ? end + 1 : end;
      } else {
        [payload, position] = readLine(body, afterItemHeader);
      }
      if (!forwardedItems.has(itemHeader.type)) continue;
      const parsed: unknown = JSON.parse(payload);
      if (!isObject(parsed)) return { kind: 'reject', status: 400 };
      const kept = itemHeader.type === 'event' ? scrubSentryEvent(parsed) : parsed;
      items.push(JSON.stringify({ type: itemHeader.type }), JSON.stringify(kept));
    }
    if (items.length === 0) return { kind: 'drop' };

    const envelopeHeader: Json = { dsn: configuredDsn };
    for (const key of ['event_id', 'sent_at', 'sdk']) {
      if (header[key] !== undefined) envelopeHeader[key] = header[key];
    }
    return {
      kind: 'forward',
      url: `${dsn.origin}${dsn.pathPrefix}/api/${dsn.projectId}/envelope/`,
      body: new TextEncoder().encode([JSON.stringify(envelopeHeader), ...items].join('\n')),
    };
  } catch {
    return { kind: 'reject', status: 400 };
  }
}
