import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { contractHeaderValue } from '../src/modules/kernel/contract/contract-pipe.js';
import {
  crossTenantTarget,
  decodedHeaderReason,
  isRefusal,
} from '../src/modules/kernel/tenancy/cross-tenant.js';

// The percent-encoded UTF-8 `X-Support-Reason` (lead ruling on WEB-4 8.2 #5): the console sends a
// reason outside Latin-1 encoded; the door audits the decoded text and bounds it, not the encoding.

const accountId = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const door = { from: 'path', name: 'account_id' } as const;

function request(reason: string): Request {
  return {
    params: { account_id: accountId },
    headers: { 'x-support-reason': reason },
  } as unknown as Request;
}

describe('X-Support-Reason decoding', () => {
  it('decodes a percent-encoded Arabic reason and audits the Arabic text', () => {
    const arabic = 'مراجعة طلب الدعم رقم 42';
    const target = crossTenantTarget(request(encodeURIComponent(arabic)), door);
    expect(target).toEqual({ accountId, reason: arabic });
  });

  it('bounds the decoded text: 200 Arabic letters pass though their encoding is 1,200 long', () => {
    const arabic = 'ع'.repeat(200);
    const target = crossTenantTarget(request(encodeURIComponent(arabic)), door);
    expect(target !== undefined && !isRefusal(target) && target.reason).toBe(arabic);
    const over = crossTenantTarget(request(encodeURIComponent(`${arabic}ع`)), door);
    expect(over !== undefined && isRefusal(over) && over.outcome).toBe('reason_invalid');
  });

  it('checks control characters on the decoded text', () => {
    const target = crossTenantTarget(request(encodeURIComponent('line one\nline two')), door);
    expect(target !== undefined && isRefusal(target) && target.outcome).toBe('reason_invalid');
  });

  it("lets the contract's header schema bound the decoded text, not the encoding", () => {
    const header = operationSchemas.platformListAccountMembers.header;
    const arabic = 'ع'.repeat(150);
    const encoded = encodeURIComponent(arabic);
    expect(encoded.length).toBeGreaterThan(500);
    expect(header?.safeParse({ 'X-Support-Reason': encoded }).success).toBe(false);
    const value = contractHeaderValue('X-Support-Reason', encoded);
    expect(value).toBe(arabic);
    expect(header?.safeParse({ 'X-Support-Reason': value }).success).toBe(true);
    expect(contractHeaderValue('Idempotency-Key', '100%25')).toBe('100%25');
  });

  it('refuses format characters in the header, sent raw or percent-encoded', () => {
    // WEB-4 adversary fix round 1 (L): bidirectional overrides and isolates, zero-width marks.
    for (const value of [
      encodeURIComponent('ticket \u202E24 refund\u202C'),
      encodeURIComponent('بلاغ \u2067٤٢\u2069'),
      'ticket\u200B42',
    ]) {
      const target = crossTenantTarget(request(value), door);
      expect(target !== undefined && isRefusal(target) && target.outcome).toBe('reason_invalid');
      expect(target !== undefined && isRefusal(target) && target.error.options.fields).toEqual([
        { pointer: '/header/x-support-reason', code: 'invalid' },
      ]);
    }
  });

  it('allows the Arabic letter mark, the directional marks and the zero-width joiners in the header', () => {
    // Lead ruling, WEB-4 round 2: Arabic and Persian keyboards insert these in ordinary text.
    const arabic = 'مراجعة‏ طلب‌ الدعم؜‍‎ 42';
    expect(crossTenantTarget(request(encodeURIComponent(arabic)), door)).toEqual({
      accountId,
      reason: arabic,
    });
    const target = crossTenantTarget(request(encodeURIComponent('مراجعة‏ ‮طلب')), door);
    expect(target !== undefined && isRefusal(target) && target.outcome).toBe('reason_invalid');
  });

  it('refuses format characters in a body reason at the door', () => {
    const body = { from: 'path', name: 'account_id', reason: 'body' } as const;
    const target = crossTenantTarget(
      {
        params: { account_id: accountId },
        headers: {},
        body: { reason: 'suspend: \u202Ednuf\u202C' },
      } as unknown as Request,
      body,
    );
    expect(target !== undefined && isRefusal(target) && target.outcome).toBe('reason_invalid');
  });

  it('uses a value that does not decode as it was sent', () => {
    expect(decodedHeaderReason('refund 100% check')).toBe('refund 100% check');
    expect(decodedHeaderReason('ticket 42')).toBe('ticket 42');
    const target = crossTenantTarget(request('refund 100% check'), door);
    expect(target).toEqual({ accountId, reason: 'refund 100% check' });
  });
});
