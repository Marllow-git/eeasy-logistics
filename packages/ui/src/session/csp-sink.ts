import { readCappedBody } from '../observability/body';
import { cspViolations } from './headers';

// The CSP report sink of both web applications (web §3.6; WEB-2 plan 2.6, adversary M-2): browsers
// post violations to `/monitoring/csp` (`report-to csp`, `Reporting-Endpoints`) without a session,
// so everything here bounds what an anonymous sender can make the process log. One line per
// violation with the directive and the blocked origin only, never the page URL, the sample or the
// rest of the body; the log pipeline counts them.
//
// - Only the report media types are read; anything else (a cross-origin `text/plain` form post)
//   is 415 with no line.
// - Each address has a token bucket, and the whole process one more, so a sender rotating the
//   address it claims still meets a ceiling; past either, 429 with no line.
// - A body yields at most five violations (`cspViolations`), and each (directive, origin) pair is
//   logged once a window.
// The state is per process and bounded; a restart forgets it, which costs at most one window.

/** The media types browsers send reports with: the Reporting API's and CSP Level 2's. */
export const cspReportTypes = ['application/reports+json', 'application/csp-report'] as const;

const maxReportBytes = 64 * 1024;
const minuteMs = 60_000;
const maxKeys = 1000;

interface Clock {
  readonly now: () => number;
}

/** Token buckets by key: `capacity` takes, refilled evenly over `periodMs`; at most `maxKeys`. */
export function tokenBuckets(
  options: Clock & { capacity: number; periodMs: number; maxKeys: number },
) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  const rate = options.capacity / options.periodMs;
  return {
    take(key: string): boolean {
      const now = options.now();
      const held = buckets.get(key);
      const tokens =
        held === undefined
          ? options.capacity
          : Math.min(options.capacity, held.tokens + (now - held.at) * rate);
      if (held === undefined && buckets.size >= options.maxKeys) {
        // The oldest key goes; a sender cycling keys only meets the process-wide bucket sooner.
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
      buckets.delete(key);
      if (tokens < 1) {
        buckets.set(key, { tokens, at: now });
        return false;
      }
      buckets.set(key, { tokens: tokens - 1, at: now });
      return true;
    },
    size: () => buckets.size,
  };
}

/** Whether a key is new within `windowMs`; remembers at most `maxKeys` (the oldest go first). */
export function recentWindow(options: Clock & { windowMs: number; maxKeys: number }) {
  const seen = new Map<string, number>();
  return {
    first(key: string): boolean {
      const now = options.now();
      const at = seen.get(key);
      if (at !== undefined && now - at <= options.windowMs) return false;
      seen.delete(key);
      if (seen.size >= options.maxKeys) {
        const oldest = seen.keys().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      seen.set(key, now);
      return true;
    },
    size: () => seen.size,
  };
}

/**
 * The sender's address as the edge reports it: the last `X-Forwarded-For` entry, the one the
 * nearest proxy appended (the edge contract pins it, OPS-1; README "Web sessions and headers").
 */
function addressOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const last = forwarded?.split(',').at(-1)?.trim();
  return last === undefined || last === '' ? 'unknown' : last;
}

export interface CspReportSinkOptions {
  /** Reports a minute one address may send (30). */
  readonly perAddress?: number;
  /** Reports a minute the process takes from all addresses together (300). */
  readonly perProcess?: number;
  /** Test seams. */
  readonly now?: () => number;
  readonly log?: (line: string) => void;
}

/** The `POST` handler of `/monitoring/csp`; one per route module, so its budgets are per process. */
export function createCspReportSink(options: CspReportSinkOptions = {}) {
  const clock = { now: options.now ?? Date.now };
  const log = options.log ?? ((line: string) => console.warn(line));
  const perAddress = tokenBuckets({
    ...clock,
    capacity: options.perAddress ?? 30,
    periodMs: minuteMs,
    maxKeys,
  });
  const perProcess = tokenBuckets({
    ...clock,
    capacity: options.perProcess ?? 300,
    periodMs: minuteMs,
    maxKeys: 1,
  });
  const logged = recentWindow({ ...clock, windowMs: minuteMs, maxKeys });

  return async function POST(request: Request): Promise<Response> {
    const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (!cspReportTypes.some((accepted) => accepted === type)) {
      await request.body?.cancel().catch(() => undefined);
      return new Response(null, { status: 415 });
    }
    if (!perAddress.take(addressOf(request)) || !perProcess.take('all')) {
      await request.body?.cancel().catch(() => undefined);
      return new Response(null, { status: 429 });
    }
    const read = await readCappedBody(request, maxReportBytes);
    if (!read.ok) return new Response(null, { status: read.status });
    for (const violation of cspViolations(new TextDecoder().decode(read.body))) {
      if (!logged.first(`${violation.directive} ${violation.blockedOrigin}`)) continue;
      log(
        JSON.stringify({
          event: 'csp.violation',
          directive: violation.directive,
          blocked_origin: violation.blockedOrigin,
        }),
      );
    }
    // 204 for every report read, so a report never tells the sender anything.
    return new Response(null, { status: 204 });
  };
}
