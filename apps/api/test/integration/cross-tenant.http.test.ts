import type { RequestContext } from '@eeasy-logistics/db';
import { findPlatformContext, getContext, getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { platformCookie, staffCookie } from '../../src/modules/kernel/auth/principal.js';
import { BootChecks, BootRefusal } from '../../src/modules/kernel/platform/boot-checks.js';
import type { AuditEvent, AuditSink } from '../../src/modules/kernel/public/index.js';
import { AUDIT_SINK, CrossTenant } from '../../src/modules/kernel/public/index.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import type { ProbeRow } from './probe-table.js';
import {
  ProbeRepository,
  createProbeTable,
  dropProbeTable,
  insertProbeRows,
} from './probe-table.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-6 item D on the real database: the `@CrossTenant()` door (plan 2.7) and the boot role
// checks (plan 2.12). A platform token reaches tenant rows only through the door: reason required,
// the unit of work runs on elx_platform with the target account set, one audit event per call.

@Controller('v1/platform/accounts/:account_id/probe-rows')
class CrossTenantProbeController {
  @CrossTenant()
  @Get()
  async list(): Promise<{ context: RequestContext; rows: ProbeRow[] }> {
    const rows = await new ProbeRepository(getUnitOfWork()).all();
    return { context: getContext(), rows };
  }
}

@Controller('v1/platform/probe-rows')
class PlatformProbeController {
  // No @CrossTenant(): there is no tenant unit of work, so no tenant repository can be built.
  @Get()
  async list(): Promise<ProbeRow[]> {
    return new ProbeRepository(getUnitOfWork()).all();
  }

  @Get('whoami')
  whoami(): { userId: string | undefined } {
    return { userId: findPlatformContext()?.userId };
  }
}

class RecordingSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  record(event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

describe('the cross-tenant door (PLAT-6 item D)', () => {
  const signing = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
  });
  const accountA = uuidv7();
  const accountB = uuidv7();
  const platformUser = uuidv7();
  const sink = new RecordingSink();
  let owner: postgres.Sql;
  let app: INestApplication<App>;

  const platform = () =>
    signAccessToken(signing, 'platform', { claims: { sub: platformUser } }).then(
      (token) => `${platformCookie}=${token}`,
    );

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await owner`INSERT INTO core_accounts (id, name) VALUES
      (${accountA}, 'Cross-tenant A'), (${accountB}, 'Cross-tenant B')`;
    await createProbeTable(owner, config);
    await insertProbeRows(owner, [
      { id: uuidv7(), accountId: accountA, label: 'a-1' },
      { id: uuidv7(), accountId: accountB, label: 'b-1' },
      { id: uuidv7(), accountId: accountB, label: 'b-2' },
    ]);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [CrossTenantProbeController, PlatformProbeController],
    })
      .overrideProvider(AUDIT_SINK)
      .useValue(sink)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await dropProbeTable(owner);
    await owner`DELETE FROM core_accounts WHERE id IN (${accountA}, ${accountB})`;
    await owner.end();
  });

  beforeEach(() => {
    sink.events.length = 0;
  });

  const http = () => request(app.getHttpServer());
  const codeOf = (response: { body: unknown }) => (response.body as { code: string }).code;

  it('reads the target account only, as the platform user acting cross-tenant', async () => {
    const response = await http()
      .get(`/v1/platform/accounts/${accountB}/probe-rows`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', 'Ticket 4411: driver cannot see run')
      .expect(200);
    const body = response.body as { context: RequestContext; rows: ProbeRow[] };
    expect(body.rows.map((row) => row.label).sort()).toEqual(['b-1', 'b-2']);
    expect(body.context).toMatchObject({
      accountId: accountB,
      userId: platformUser,
      membershipId: null,
      actingCrossTenant: true,
    });
  });

  it('emits one audit event with actor, target, operation, reason and request id', async () => {
    const response = await http()
      .get(`/v1/platform/accounts/${accountA}/probe-rows`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', '  Ticket 4412  ')
      .expect(200);
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      kind: 'cross_tenant_access',
      actor: platformUser,
      accountId: accountA,
      operation: 'CrossTenantProbeController.list',
      reason: 'Ticket 4412',
      outcome: 'ok',
      requestId: response.headers['x-request-id'],
      clientRequestId: null,
    });
  });

  it('audits the server-minted request id and carries a client id beside it (adversary L-4)', async () => {
    const client = '01927f6e-7a2b-7c3d-8e4f-5a6b7c8d9e0f';
    const response = await http()
      .get(`/v1/platform/accounts/${accountA}/probe-rows`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', 'Ticket 4413')
      .set('X-Request-Id', client)
      .expect(200);
    expect(response.headers['x-request-id']).toBe(client);
    expect(sink.events).toHaveLength(1);
    const [event] = sink.events;
    expect(event?.clientRequestId).toBe(client);
    expect(event?.requestId).not.toBe(client);
    expect(event?.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it('requires the support reason: missing or blank is reason_required, audited as reason_missing', async () => {
    const missing = await http()
      .get(`/v1/platform/accounts/${accountA}/probe-rows`)
      .set('Cookie', await platform())
      .expect(400);
    expect(codeOf(missing)).toBe('reason_required');
    const blank = await http()
      .get(`/v1/platform/accounts/${accountA}/probe-rows`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', '   ')
      .expect(400);
    expect(codeOf(blank)).toBe('reason_required');
    expect(sink.events.map((event) => [event.outcome, event.accountId, event.reason])).toEqual([
      ['reason_missing', accountA, null],
      ['reason_missing', accountA, null],
    ]);
  });

  it('refuses a reason over 200 characters as validation_failed, audited as reason_invalid', async () => {
    const response = await http()
      .get(`/v1/platform/accounts/${accountA}/probe-rows`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', 'x'.repeat(201))
      .expect(400);
    expect(codeOf(response)).toBe('validation_failed');
    expect(sink.events).toMatchObject([{ outcome: 'reason_invalid', reason: null }]);
  });

  it('answers not_found for an unknown or malformed account, and still audits the attempt', async () => {
    const unknown = uuidv7();
    for (const target of [unknown, 'not-a-uuid']) {
      const response = await http()
        .get(`/v1/platform/accounts/${target}/probe-rows`)
        .set('Cookie', await platform())
        .set('X-Support-Reason', 'Ticket 4413')
        .expect(404);
      expect(codeOf(response)).toBe('not_found');
    }
    expect(sink.events.map((event) => [event.outcome, event.accountId, event.reason])).toEqual([
      ['not_found', unknown, 'Ticket 4413'],
      ['not_found', null, null],
    ]);
    expect(sink.events[0]).toMatchObject({ actor: platformUser, kind: 'cross_tenant_access' });
  });

  it('refuses a staff token on the door', async () => {
    const token = await signAccessToken(signing, 'staff', { claims: { acc: accountA } });
    await http()
      .get(`/v1/platform/accounts/${accountB}/probe-rows`)
      .set('Cookie', `${staffCookie}=${token}; ${platformCookie}=${token}`)
      .set('X-Support-Reason', 'Ticket 4414')
      .expect(401);
  });

  it('a platform handler without @CrossTenant() cannot read tenant rows', async () => {
    const response = await http()
      .get('/v1/platform/probe-rows')
      .set('Cookie', await platform())
      .expect(500);
    expect(codeOf(response)).toBe('internal_error');
    // No tenant row leaks: the body is the bare Error shape, and no quoted row label appears. A bare
    // 'b-1' would also match inside a random request_id UUID (…afcb-19e9…) about once in 100 runs.
    expect(Object.keys(response.body).sort()).toEqual(['code', 'message', 'request_id']);
    expect(response.text).not.toContain('"b-1"');
  });

  it('a platform handler runs with the platform context and no account', async () => {
    const response = await http()
      .get('/v1/platform/probe-rows/whoami')
      .set('Cookie', await platform())
      .expect(200);
    expect(response.body).toEqual({ userId: platformUser });
  });
});

describe('boot role checks (PLAT-6 plan 2.12, PLAT-5 ruling M-6)', () => {
  const boot = async (overrides: Record<string, string | undefined>) => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(integrationConfig(overrides))],
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    try {
      await app.get(BootChecks).run();
      return 'started';
    } catch (error) {
      return error instanceof BootRefusal ? error.message : 'unexpected';
    } finally {
      await app.close();
    }
  };

  it('starts when both pools are their plain roles', async () => {
    expect(await boot({})).toBe('started');
  });

  it('refuses when the platform URL logs in as elx_app, naming the role only', async () => {
    const appUrl = integrationConfig().db.urls.app?.reveal();
    const message = await boot({ DATABASE_URL_PLATFORM: appUrl });
    expect(message).toBe('Refusing to start: not a plain elx_platform connection');
  });

  it('refuses when the app URL logs in as elx_platform', async () => {
    const platformUrl = integrationConfig().db.urls.platform?.reveal();
    const message = await boot({ DATABASE_URL_APP: platformUrl });
    expect(message).toBe('Refusing to start: not a plain elx_app connection');
  });
});
