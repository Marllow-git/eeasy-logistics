// Self-test of the contract harness (PLAT-15 plan 2.9). Wave 0 has no OpenAPI operation live, so an
// in-process server plays the API for one real operation, `platformListAccounts`, and the harness
// must pass a documented answer and fail an undocumented status, an undocumented field and an
// unknown error code. Runs in `pnpm --filter contracts test` and in `test:contract`.
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError, createFetcher } from '../../src/http.ts';
import { client } from '../../src/platform.ts';
import type { RecordedResponse } from './harness.ts';
import { ContractValidator, closeObjects, recordingFetch } from './harness.ts';

const account = {
  id: '0193a5c4-7e1f-7c3a-9b2d-4f6e8a1c2d3e',
  created_at: '2026-11-01T08:00:00Z',
  name: 'Acme Riyadh',
  country: 'SA',
  default_locale: 'ar',
  timezone: 'Asia/Riyadh',
  status: 'active',
  limits: { orders_per_month: 1000, drivers: 10 },
};
const page = { data: [account], next_cursor: null };
const error = (code: string) => ({ code, message: 'Not allowed', request_id: 'req-1' });

/** What the fake API answers, keyed by the `scenario` query parameter. */
const answers: Record<string, { status: number; body: unknown }> = {
  documented: { status: 200, body: page },
  documentedError: { status: 403, body: error('forbidden') },
  undocumentedStatus: { status: 503, body: error('internal_error') },
  undocumentedField: {
    status: 200,
    body: { ...page, data: [{ ...account, internal_note: 'leaked' }] },
  },
  unknownErrorCode: { status: 403, body: error('not_a_documented_code') },
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const answer = answers[url.searchParams.get('q') ?? ''];
  if (request.method !== 'GET' || url.pathname !== '/v1/platform/accounts' || !answer) {
    response.writeHead(500).end();
    return;
  }
  response
    .writeHead(answer.status, { 'content-type': 'application/json', 'x-request-id': 'req-1' })
    .end(JSON.stringify(answer.body));
});

let baseUrl = '';
const validator = ContractValidator.load('platform');

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

/** Calls the generated client the way a scenario does and returns what the wire carried. */
async function call(scenario: keyof typeof answers): Promise<RecordedResponse> {
  const recorder = recordingFetch();
  const fetcher = createFetcher({ baseUrl, fetch: recorder.fetch, locale: 'en' });
  try {
    // The `q` search parameter carries the scenario name; any string is valid for it.
    await client.platformListAccounts({ q: scenario }, { fetcher });
  } catch (thrown) {
    if (!(thrown instanceof ApiError)) throw thrown;
  }
  const [response, ...rest] = await recorder.responses();
  expect(rest).toEqual([]);
  if (response === undefined) throw new Error('the client made no request');
  expect(validator.match(response.method, response.url)).toBe('platformListAccounts');
  return response;
}

const kinds = async (scenario: keyof typeof answers) =>
  validator.check('platformListAccounts', await call(scenario)).map((violation) => violation.kind);

describe('contract harness self-test (platformListAccounts)', () => {
  it('passes a documented 200 page', async () => {
    expect(await kinds('documented')).toEqual([]);
  });

  it('passes a documented error with a known code (4XX range)', async () => {
    expect(await kinds('documentedError')).toEqual([]);
  });

  it('fails an undocumented status', async () => {
    expect(await kinds('undocumentedStatus')).toEqual(['undocumented_status']);
  });

  it('fails an undocumented field, though the schema leaves additionalProperties unset', async () => {
    const violations = validator.check('platformListAccounts', await call('undocumentedField'));
    expect(violations).toEqual([
      {
        kind: 'undocumented_field',
        at: '/data/0/internal_note',
        message: 'field "internal_note" is not documented',
      },
    ]);
  });

  it('fails an error code outside ErrorCode', async () => {
    expect(await kinds('unknownErrorCode')).toEqual(['unknown_error_code']);
  });
});

describe('closeObjects', () => {
  it('closes locations but not composition branches, and keeps documented open maps', () => {
    const schema = {
      allOf: [{ $ref: '#/a' }, { type: 'object', properties: { p: { $ref: '#/b' } } }],
      properties: { map: { type: 'object', additionalProperties: true }, text: { type: 'string' } },
    };
    expect(closeObjects(schema, true)).toEqual({
      allOf: [
        { $ref: '#/a' },
        { type: 'object', properties: { p: { $ref: '#/b', unevaluatedProperties: false } } },
      ],
      properties: { map: { type: 'object', additionalProperties: true }, text: { type: 'string' } },
      unevaluatedProperties: false,
    });
  });

  it('leaves example data alone', () => {
    const schema = { type: 'object', example: { properties: { x: { type: 'object' } } } };
    expect(closeObjects(schema, false)).toEqual(schema);
  });
});

describe('bundle coverage of the validator', () => {
  it('compiles every documented response schema of every surface', () => {
    for (const surface of ['staff', 'platform', 'driver', 'recipient', 'public'] as const) {
      const surfaceValidator = ContractValidator.load(surface);
      expect(surfaceValidator.operationIds().length).toBeGreaterThan(0);
      expect(() => surfaceValidator.compileAll()).not.toThrow();
    }
  });
});
