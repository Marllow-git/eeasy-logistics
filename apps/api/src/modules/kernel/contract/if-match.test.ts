import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ApiException } from '../errors/api-exception.js';
import { parseContractInput } from './contract-pipe.js';
import { assertVersion, entityTag, ifMatchVersion } from './if-match.js';

// DEL-2 item D: the kernel's `If-Match` reader (plan 2.8, 2a; D-22; errors.md `version_required`,
// `version_conflict`).

type Raw = Parameters<typeof parseContractInput>[0];

function refusal(run: () => unknown): ApiException {
  try {
    run();
  } catch (error) {
    if (error instanceof ApiException) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('ifMatchVersion', () => {
  it('reads a strong entity tag or a bare positive integer', () => {
    expect(ifMatchVersion('"7"')).toBe(7);
    expect(ifMatchVersion(' "12" ')).toBe(12);
    expect(ifMatchVersion('3')).toBe(3);
    expect(ifMatchVersion(entityTag(41))).toBe(41);
  });

  it.each(['W/"7"', '*', '"7", "8"', '"0"', '0', '"-1"', '"07"', '""', 'seven', '"1234567890"'])(
    'refuses %j at /header/if-match',
    (value) => {
      const error = refusal(() => ifMatchVersion(value));
      expect(error.code).toBe('validation_failed');
      expect(error.options.fields).toEqual([{ pointer: '/header/if-match', code: 'invalid' }]);
    },
  );
});

describe('assertVersion', () => {
  it('passes the version the aggregate holds and refuses another with its status and version', () => {
    expect(() => assertVersion({ status: 'pending', version: 2 }, 2)).not.toThrow();
    const error = refusal(() => assertVersion({ status: 'cancelled', version: 8 }, 7));
    expect(error.code).toBe('version_conflict');
    expect(error.options.details).toEqual({ current_status: 'cancelled', version: 8 });
  });
});

// The shapes the generated schemas give a dispatcher write and a read (`cancelOrder`, `getOrder`).
const orderParams = z.strictObject({ order_id: z.uuid() });
const writeOp = {
  params: orderParams,
  header: z.strictObject({ 'Idempotency-Key': z.uuid(), 'If-Match': z.string() }),
  body: z.strictObject({ reason_code: z.string() }),
};
const readOp = { params: orderParams };

describe('the contract pipe and If-Match', () => {
  const raw = (headers: Record<string, string>) =>
    ({
      schemas: writeOp,
      params: { order_id: '0192f100-1111-7222-8333-444455556666' },
      query: {},
      headers: {
        'idempotency-key': '0192f3b0-2a1c-7d00-9e00-0000000000a1',
        'x-el-client': 'web',
        ...headers,
      },
      body: { reason_code: 'customer_request' },
    }) as unknown as Raw;

  it('answers 428 version_required when a declaring operation is sent without the header', () => {
    expect(refusal(() => parseContractInput(raw({}))).code).toBe('version_required');
  });

  it('hands the header on when it is sent', () => {
    const input = parseContractInput(raw({ 'if-match': '"3"' })) as unknown as {
      headers: Record<string, string>;
    };
    expect(input.headers['If-Match']).toBe('"3"');
  });

  it('leaves operations without the header alone', () => {
    const input = parseContractInput({
      schemas: readOp,
      params: { order_id: '0192f100-1111-7222-8333-444455556666' },
      query: {},
      headers: {},
      body: undefined,
    } as unknown as Raw);
    expect(input.params).toEqual({ order_id: '0192f100-1111-7222-8333-444455556666' });
  });
});
