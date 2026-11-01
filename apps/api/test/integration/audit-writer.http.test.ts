import { getContext, uuidv7 } from '@eeasy-logistics/db';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get, Inject } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { AuditWriter } from '../../src/modules/kernel/audit/audit-writer.js';
import { KernelModule } from '../../src/modules/kernel/kernel.module.js';
import { PLATFORM_POOL } from '../../src/modules/kernel/platform/tokens.js';
import { platformCookie, staffCookie } from '../../src/modules/kernel/auth/principal.js';
import type { AuditEvent, AuditSink } from '../../src/modules/kernel/public/index.js';
import { ApiException, AUDIT_SINK, CrossTenant } from '../../src/modules/kernel/public/index.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import type { AuditRow } from './audit-rows.js';
import { auditRowsOf } from './audit-rows.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-7 item B on the real database: `AuditWriter` behind AUDIT_SINK. `record()` writes in the
// request's unit of work and shares its fate; `recordCommitted()` and the door's rows survive a
// rolled-back request; what is stored is redacted.

/**
 * The real writer, except that the door's `accessed` row can be made to fail (lead review round
 * 1: an audit-write failure on success must roll the handler's effect back).
 */
let failAccessRow = false;
class FlakyAuditWriter extends AuditWriter {
  override record(event: AuditEvent): Promise<void> {
    if (failAccessRow && event.action === 'platform.cross_tenant.accessed') {
      return Promise.reject(new Error('audit write failed'));
    }
    return super.record(event);
  }
}

/** A tenant event for the current request's account. */
function tenantEvent(after: unknown): AuditEvent {
  const context = getContext();
  return {
    actorType: 'user',
    actorId: context.userId,
    accountId: context.accountId,
    targetType: 'site',
    targetId: 'site-1',
    action: 'core.site.updated',
    before: { name: 'Old' },
    after,
    requestId: context.requestId ?? '',
  };
}

@Controller('v1/staff/audit-probe')
class StaffAuditProbe {
  constructor(@Inject(AUDIT_SINK) private readonly audit: AuditSink) {}

  @Get('commit')
  async commit(): Promise<{ ok: true }> {
    await this.audit.record(tenantEvent({ name: 'New', password: 'hunter2' }));
    return { ok: true };
  }

  @Get('throw')
  async throws(): Promise<never> {
    await this.audit.record(tenantEvent({ name: 'Never' }));
    throw new ApiException('not_found');
  }

  @Get('committed-then-throw')
  async committedThenThrow(): Promise<never> {
    await this.audit.recordCommitted(tenantEvent({ name: 'Refused' }));
    throw new ApiException('forbidden');
  }

  @Get('foreign')
  async foreign(): Promise<{ ok: true }> {
    await this.audit.record({ ...tenantEvent(null), accountId: uuidv7() });
    return { ok: true };
  }
}

@Controller('v1/platform')
class PlatformAuditProbe {
  constructor(@Inject(AUDIT_SINK) private readonly audit: AuditSink) {}

  @Get('audit-probe')
  async platformAction(): Promise<{ ok: true }> {
    await this.audit.record({
      actorType: 'platform_user',
      actorId: uuidv7(),
      accountId: null,
      targetType: 'flag',
      targetId: 'routing',
      action: 'platform.flag.changed',
      after: { mode: 'allowlist', api_key: 'elk_live_x' },
      requestId: uuidv7(),
    });
    return { ok: true };
  }

  @CrossTenant()
  @Get('accounts/:account_id/audit-effect')
  async effect(): Promise<{ ok: true }> {
    // The handler's own effect inside the door: a row in the target account's log.
    await this.audit.record(tenantEvent({ name: 'Effect' }));
    return { ok: true };
  }

  @CrossTenant()
  @Get('accounts/:account_id/audit-probe')
  async readThenFail(): Promise<never> {
    await this.audit.record(tenantEvent({ name: 'Inside the door' }));
    throw new ApiException('version_conflict');
  }
}

describe('AuditWriter on core_audit_log (PLAT-7 item B)', () => {
  const signing = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
  });
  const account = uuidv7();
  const user = uuidv7();
  let owner: postgres.Sql;
  let app: INestApplication<App>;

  const staff = () =>
    signAccessToken(signing, 'staff', { claims: { acc: account, sub: user } }).then(
      (token) => `${staffCookie}=${token}`,
    );
  const platform = () =>
    signAccessToken(signing, 'platform').then((token) => `${platformCookie}=${token}`);
  const http = () => request(app.getHttpServer());
  const rowsOf = (response: { headers: Record<string, string> }): Promise<AuditRow[]> =>
    auditRowsOf(owner, response.headers['x-request-id'] ?? '');

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await owner`INSERT INTO core_accounts (id, name) VALUES (${account}, 'Audit writer')`;
    const moduleRef = await Test.createTestingModule({
      // KernelModule exports AUDIT_SINK to the probe controllers.
      imports: [AppModule.forRoot(config), KernelModule],
      controllers: [StaffAuditProbe, PlatformAuditProbe],
    })
      .overrideProvider(AUDIT_SINK)
      .useFactory({
        factory: (pool: ConstructorParameters<typeof AuditWriter>[0]) => new FlakyAuditWriter(pool),
        inject: [PLATFORM_POOL],
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  it('record() commits with the action, for the token account, redacted', async () => {
    const response = await http()
      .get('/v1/staff/audit-probe/commit')
      .set('Cookie', await staff())
      .expect(200);
    const rows = await rowsOf(response);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: 'user',
      actorId: user,
      accountId: account,
      action: 'core.site.updated',
      before: { name: 'Old' },
      after: { name: 'New', password: '[redacted]' },
    });
  });

  it('record() then a thrown error: the row rolls back with the request', async () => {
    const response = await http()
      .get('/v1/staff/audit-probe/throw')
      .set('Cookie', await staff())
      .expect(404);
    expect(await rowsOf(response)).toEqual([]);
  });

  it('recordCommitted() survives the rollback of a refused request (ruling M-5)', async () => {
    const response = await http()
      .get('/v1/staff/audit-probe/committed-then-throw')
      .set('Cookie', await staff())
      .expect(403);
    const rows = await rowsOf(response);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ accountId: account, after: { name: 'Refused' } });
  });

  it('refuses an event for another account in a tenant unit of work, and writes nothing', async () => {
    const response = await http()
      .get('/v1/staff/audit-probe/foreign')
      .set('Cookie', await staff())
      .expect(500);
    expect(await rowsOf(response)).toEqual([]);
  });

  it('a platform action records a row with no account, redacted', async () => {
    const response = await http()
      .get('/v1/platform/audit-probe')
      .set('Cookie', await platform())
      .expect(200);
    const rows = await owner<AuditRow[]>`
      SELECT account_id AS "accountId", after FROM core_audit_log
      WHERE action = 'platform.flag.changed' AND target_id = 'routing'`;
    expect(response.body).toEqual({ ok: true });
    expect(rows.at(-1)).toEqual({
      accountId: null,
      after: { mode: 'allowlist', api_key: '[redacted]' },
    });
  });

  it('a door handler that fails after record(): its own row is gone, the failed outcome stays (ruling L-4)', async () => {
    const response = await http()
      .get(`/v1/platform/accounts/${account}/audit-probe`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', 'Ticket 7001')
      .expect(409);
    const rows = await rowsOf(response);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'platform.cross_tenant.accessed',
      accountId: account,
      reason: 'Ticket 7001',
      after: { operation: 'PlatformAuditProbe.readThenFail', outcome: 'failed', status: 409 },
    });
  });

  it('a successful door call commits its accessed row together with the handler effect (review round 1)', async () => {
    const response = await http()
      .get(`/v1/platform/accounts/${account}/audit-effect`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', 'Ticket 7002')
      .expect(200);
    const rows = await rowsOf(response);
    expect(rows.map((row) => [row.action, (row.after as { outcome?: string }).outcome])).toEqual([
      ['core.site.updated', undefined],
      ['platform.cross_tenant.accessed', 'ok'],
    ]);
    expect(rows.every((row) => row.accountId === account)).toBe(true);
  });

  it('an audit-write failure on success rolls the handler effect back: no half state (review round 1)', async () => {
    failAccessRow = true;
    try {
      const response = await http()
        .get(`/v1/platform/accounts/${account}/audit-effect`)
        .set('Cookie', await platform())
        .set('X-Support-Reason', 'Ticket 7003')
        .expect(500);
      const rows = await rowsOf(response);
      // The effect is gone with the request transaction; the attempt stays, as `failed`.
      expect(rows.map((row) => row.action)).toEqual(['platform.cross_tenant.accessed']);
      expect(rows[0]?.after).toMatchObject({ outcome: 'failed', status: 500 });
    } finally {
      failAccessRow = false;
    }
  });
});
