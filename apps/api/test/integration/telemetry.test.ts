import { uuidv7 } from '@eeasy-logistics/db';
import type { INestApplication } from '@nestjs/common';
import { SpanKind } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace';
import type postgres from 'postgres';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTelemetry } from '../../src/modules/kernel/telemetry/sdk.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-14 item B on the real database (plan 2.2, 2.9): the request span of a signed-in request
// names the tenant of its unit of work and the operation, and an outbox job span carries the row
// id, kind and correlation id, never the payload. The SDK starts before Nest loads (dynamic
// imports), as in main.ts.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
});
const exporter = new InMemorySpanExporter();
const handle = startTelemetry(config, 'api', { spanExporter: exporter });
const phone = '+966512345678';

describe('telemetry spans on the real stack (PLAT-14 item B)', () => {
  const account = uuidv7();
  let owner: postgres.Sql;
  let close: () => Promise<void> = () => Promise.resolve();

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await owner`INSERT INTO core_accounts (id, name) VALUES (${account}, 'Telemetry')`;
  });

  afterAll(async () => {
    await close();
    await owner?.end();
    await handle?.shutdown();
  });

  beforeEach(() => exporter.reset());

  it('names the account, surface and operation of a staff request', async () => {
    const { Test } = await import('@nestjs/testing');
    const { default: request } = await import('supertest');
    const { AppModule } = await import('../../src/app.module.js');
    const { staffCookie } = await import('../../src/modules/kernel/auth/principal.js');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    }).compile();
    const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
    await app.init();
    close = () => app.close();
    const token = await signAccessToken(signing, 'staff', { claims: { acc: account } });
    const response = await request(app.getHttpServer())
      .get('/v1/staff/audit-log?limit=5')
      .set('Cookie', `${staffCookie}=${token}`)
      .set('X-Debug', phone);
    expect(response.status).toBe(200);
    const servers = exporter.getFinishedSpans().filter((span) => span.kind === SpanKind.SERVER);
    expect(servers).toHaveLength(1);
    expect(servers[0]?.attributes).toMatchObject({
      'elx.request_id': response.headers['x-request-id'],
      'elx.account.id': account,
      'elx.surface': 'staff',
      'elx.operation_id': 'listAuditLog',
      'http.route': '/v1/staff/audit-log',
    });
    const exported = JSON.stringify(exporter.getFinishedSpans().map((s) => [s.name, s.attributes]));
    expect(exported).not.toContain(token);
    expect(exported).not.toContain('966512345678');
    expect(exported).not.toContain('limit');
  });

  it('gives an outbox job its own trace with the row id, kind and correlation id', async () => {
    const { createPlatformPool } = await import('@eeasy-logistics/db/platform');
    const { KindHandlerRegistry } =
      await import('../../src/modules/kernel/outbox/kind-handlers.js');
    const { nextOutboxId } = await import('../../src/modules/kernel/outbox/outbox-id.js');
    const { tracedOutboxJob } = await import('../../src/worker/system/outbox-workers.js');
    const pool = createPlatformPool(config.db, 'elx-test-telemetry');
    try {
      const id = nextOutboxId();
      const correlation = uuidv7();
      // `webhook`: no other suite writes this kind.
      await owner`
        INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type,
                                 aggregate_id, sequence, payload, kind, status, enqueued_at,
                                 correlation_id)
        VALUES (${id}, 'core.account.suspended', 1, ${account}, 'account', ${uuidv7()}, 1,
                ${owner.json({ phone })}, 'webhook', 'enqueued', now(), ${correlation})`;
      const registry = new KindHandlerRegistry([
        {
          kind: 'webhook',
          orderingKey: () => null,
          execute: () => Promise.resolve({ outcome: 'done' }),
        },
      ]);
      const job = {
        data: { outboxId: id },
        moveToDelayed: () => Promise.resolve(),
        updateData: () => Promise.resolve(),
      };
      const quiet = { log: () => undefined, warn: () => undefined };
      expect(await tracedOutboxJob({ db: pool.db, registry, logger: quiet }, 'webhook', job)).toBe(
        'done',
      );
      const jobs = exporter.getFinishedSpans().filter((span) => span.name === 'outbox.job');
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.kind).toBe(SpanKind.CONSUMER);
      expect(jobs[0]?.parentSpanContext).toBeUndefined();
      expect(jobs[0]?.attributes).toEqual({
        'elx.outbox.kind': 'webhook',
        'elx.outbox.row_id': id,
        'elx.account.id': account,
        'elx.correlation_id': correlation,
        'elx.event_type': 'core.account.suspended',
        'elx.outbox.attempt': 1,
        'elx.outbox.result': 'done',
      });
      expect(JSON.stringify(exporter.getFinishedSpans())).not.toContain('966512345678');
    } finally {
      await pool.close();
    }
  });
});
