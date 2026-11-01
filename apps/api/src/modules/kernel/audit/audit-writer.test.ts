import { describe, expect, it } from 'vitest';
import type { AuditEvent } from './audit-sink.js';
import { auditRow } from './audit-writer.js';

// PLAT-7 plan 2.4: the row the writer stores for an event.

const event: AuditEvent = {
  actorType: 'platform_user',
  actorId: '01927f6e-7a2b-7c3d-8e4f-5a6b7c8d9e0f',
  accountId: null,
  targetType: 'account',
  targetId: 'malformed',
  action: 'platform.cross_tenant.refused',
  requestId: '01927f6e-7a2b-7c3d-8e4f-000000000001',
};

describe('auditRow', () => {
  it('redacts before and after and keeps the facts', () => {
    expect(
      auditRow({ ...event, before: { token: 't' }, after: { outcome: 'ok', secret: 's' } }),
    ).toMatchObject({
      actorType: 'platform_user',
      accountId: null,
      before: { token: '[redacted]' },
      after: { outcome: 'ok', secret: '[redacted]' },
      reason: null,
      ip: null,
      userAgent: null,
    });
  });

  it('folds the client request id into after, also when after is empty', () => {
    const client = '01927f6e-7a2b-7c3d-8e4f-5a6b7c8d0000';
    expect(auditRow({ ...event, after: { outcome: 'ok' }, clientRequestId: client }).after).toEqual(
      { outcome: 'ok', client_request_id: client },
    );
    expect(auditRow({ ...event, clientRequestId: client }).after).toEqual({
      client_request_id: client,
    });
    expect(auditRow(event).after).toBeNull();
  });

  it('truncates the user agent to 512 characters and caps the reason', () => {
    const row = auditRow({ ...event, userAgent: 'u'.repeat(600), reason: 'r'.repeat(2_100) });
    expect(row.userAgent).toHaveLength(512);
    expect(row.reason).toHaveLength(2_000);
  });
});
