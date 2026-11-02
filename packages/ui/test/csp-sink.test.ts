// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createCspReportSink,
  cspReportTypes,
  recentWindow,
  tokenBuckets,
} from '../src/session/csp-sink';
import { cspViolations } from '../src/session/headers';

// Adversary M-2 (WEB-2 fix round): the unauthenticated CSP sink takes only report media types,
// at most five violations a body, each (directive, origin) once a window, within a per-address
// and a whole-process budget; refused or excess reports leave no log line.

const violation = (directive: string, blockedURL: string) => ({
  type: 'csp-violation',
  body: { effectiveDirective: directive, blockedURL },
});

function report(body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  return new Request('http://localhost:3001/monitoring/csp', {
    method: 'POST',
    headers: {
      'content-type': 'application/reports+json',
      'content-length': String(new TextEncoder().encode(text).byteLength),
      'x-forwarded-for': '203.0.113.7',
      ...headers,
    },
    body: text,
  });
}

function sink(options: Parameters<typeof createCspReportSink>[0] = {}) {
  const lines: string[] = [];
  let now = 0;
  const post = createCspReportSink({ log: (line) => lines.push(line), now: () => now, ...options });
  return { post, lines, advance: (ms: number) => (now += ms) };
}

describe('cspViolations', () => {
  it('reads at most five violations of one body', () => {
    const body = JSON.stringify(
      Array.from({ length: 20 }, (_, index) => violation('img-src', `https://h${index}.example/`)),
    );
    expect(cspViolations(body)).toHaveLength(5);
  });
});

describe('tokenBuckets and recentWindow', () => {
  it('spends a bucket per key, refills it over the period and keeps at most maxKeys', () => {
    let now = 0;
    const buckets = tokenBuckets({ capacity: 2, periodMs: 60_000, maxKeys: 2, now: () => now });
    expect([buckets.take('a'), buckets.take('a'), buckets.take('a')]).toEqual([true, true, false]);
    expect(buckets.take('b')).toBe(true);
    now += 30_000;
    expect(buckets.take('a')).toBe(true);
    expect(buckets.take('a')).toBe(false);
    buckets.take('c');
    expect(buckets.size()).toBe(2);
  });

  it('lets a key through once a window and forgets it after', () => {
    let now = 0;
    const seen = recentWindow({ windowMs: 60_000, maxKeys: 2, now: () => now });
    expect(seen.first('x')).toBe(true);
    expect(seen.first('x')).toBe(false);
    now += 60_001;
    expect(seen.first('x')).toBe(true);
    seen.first('y');
    seen.first('z');
    expect(seen.size()).toBeLessThanOrEqual(2);
  });
});

describe('createCspReportSink', () => {
  it('logs directive and origin of a report, once per pair a window', async () => {
    const { post, lines, advance } = sink();
    const body = [violation('script-src-elem', 'https://evil.example/x.js?t=1')];
    expect((await post(report(body))).status).toBe(204);
    expect((await post(report(body))).status).toBe(204);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      {
        event: 'csp.violation',
        directive: 'script-src-elem',
        blocked_origin: 'https://evil.example',
      },
    ]);
    advance(60_001);
    await post(report(body));
    expect(lines).toHaveLength(2);
  });

  it('takes the legacy report type too', async () => {
    const { post, lines } = sink();
    const body = { 'csp-report': { 'violated-directive': 'img-src', 'blocked-uri': 'data:x' } };
    const response = await post(report(body, { 'content-type': 'application/csp-report' }));
    expect(response.status).toBe(204);
    expect(lines).toHaveLength(1);
  });

  it('refuses any other content type with 415 and no log line', async () => {
    const { post, lines } = sink();
    const body = [violation('img-src', 'https://attacker.example/')];
    for (const type of ['text/plain', 'application/json', 'application/x-www-form-urlencoded']) {
      expect((await post(report(body, { 'content-type': type }))).status).toBe(415);
    }
    const untyped = new Request('http://localhost:3001/monitoring/csp', {
      method: 'POST',
      headers: { 'content-length': '2', 'x-forwarded-for': '203.0.113.7' },
      body: new Uint8Array([91, 93]),
    });
    expect((await post(untyped)).status).toBe(415);
    expect(lines).toEqual([]);
    expect(cspReportTypes).toEqual(['application/reports+json', 'application/csp-report']);
  });

  it('answers 429 without a log line past the per-address budget', async () => {
    const { post, lines } = sink({ perAddress: 3 });
    const statuses: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const body = [violation('img-src', `https://h${index}.example/`)];
      statuses.push((await post(report(body))).status);
    }
    expect(statuses).toEqual([204, 204, 204, 429, 429]);
    expect(lines).toHaveLength(3);
    // Another address has its own budget.
    const other = report([violation('img-src', 'https://h9.example/')], {
      'x-forwarded-for': '198.51.100.1',
    });
    expect((await post(other)).status).toBe(204);
  });

  it('holds a whole-process ceiling whatever address a sender claims', async () => {
    const { post, lines } = sink({ perAddress: 100, perProcess: 4 });
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const body = [violation('img-src', `https://h${index}.example/`)];
      statuses.push((await post(report(body, { 'x-forwarded-for': `10.0.0.${index}` }))).status);
    }
    expect(statuses).toEqual([204, 204, 204, 204, 429, 429]);
    expect(lines).toHaveLength(4);
  });
});
