import { UnitOfWorkClosedError, getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { platformCookie, staffCookie } from '../../src/modules/kernel/auth/principal.js';
import { PlatformIdempotencyStore } from '../../src/modules/kernel/platform/idempotency.repository.js';
import { getPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import { Operation } from '../../src/modules/kernel/public/index.js';
import { probeOperations } from '../support/probe-operations.js';
import { webClientHeaders } from '../support/web-client.js';
import { ProbeRepository, createProbeTable, dropProbeTable, probeLabels } from './probe-table.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-6 adversary M-1: a continuation left running after the response (here a timer) must not
// reach the pooled connection, which by then may carry another request's transaction. The unit
// of work is retired when its transaction settles, and every repository statement resolves the
// transaction anew, so the late statement throws `UnitOfWorkClosedError` and writes nothing.

let late: Promise<unknown> | undefined;
const after = (ms: number, fn: () => Promise<unknown>) =>
  new Promise((resolve) => setTimeout(resolve, ms)).then(fn);

@Controller('v1/staff/late-probe')
class StaffLateProbe {
  @Post()
  @Operation(probeOperations.staffWrite)
  @HttpCode(201)
  create(): { ok: true } {
    const repository = new ProbeRepository(getUnitOfWork());
    late = after(50, () => repository.add({ id: uuidv7(), label: 'late' })).catch(
      (error: unknown) => error,
    );
    return { ok: true };
  }

  @Post('frame')
  @Operation(probeOperations.staffWrite)
  @HttpCode(201)
  frame(): { ok: true } {
    // The same continuation asking the frame for the unit of work again.
    late = after(50, () => Promise.resolve(getUnitOfWork())).catch((error: unknown) => error);
    return { ok: true };
  }

  @Get()
  @Operation(probeOperations.staffRead)
  async list(): Promise<{ count: number }> {
    // A request that is open while the late statement fires.
    const rows = await new ProbeRepository(getUnitOfWork()).all();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { count: rows.length };
  }
}

@Controller('v1/platform/late-probe')
class PlatformLateProbe {
  @Post()
  @Operation(probeOperations.platformWrite)
  @HttpCode(201)
  create(): { ok: true } {
    const store = new PlatformIdempotencyStore(getPlatformUnitOfWork());
    late = after(50, () => store.find(uuidv7(), uuidv7())).catch((error: unknown) => error);
    return { ok: true };
  }
}

describe('a unit of work is closed once its transaction settles (adversary M-1)', () => {
  const signing = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
  });
  const account = uuidv7();
  let owner: postgres.Sql;
  let app: INestApplication<App>;

  const staff = () =>
    signAccessToken(signing, 'staff', { claims: { acc: account } }).then(
      (token) => `${staffCookie}=${token}`,
    );

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await createProbeTable(owner, config);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [StaffLateProbe, PlatformLateProbe],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await dropProbeTable(owner);
    await owner.end();
  });

  const http = () => request(app.getHttpServer());

  it('a repository kept past the response throws and never writes into the next transaction', async () => {
    await http()
      .post('/v1/staff/late-probe')
      .set('Cookie', await staff())
      .set(webClientHeaders(config, 'staff'))
      .expect(201);
    // Another request of the same account holds a transaction while the late statement fires.
    await http()
      .get('/v1/staff/late-probe')
      .set('Cookie', await staff())
      .expect(200);
    const outcome = await late;
    expect(outcome).toBeInstanceOf(UnitOfWorkClosedError);
    expect(await probeLabels(owner, account)).not.toContain('late');
  });

  it('getUnitOfWork() in a late continuation throws UnitOfWorkClosedError', async () => {
    await http()
      .post('/v1/staff/late-probe/frame')
      .set('Cookie', await staff())
      .set(webClientHeaders(config, 'staff'))
      .expect(201);
    expect(await late).toBeInstanceOf(UnitOfWorkClosedError);
  });

  it('a platform repository kept past the response throws too', async () => {
    const cookie = `${platformCookie}=${await signAccessToken(signing, 'platform')}`;
    await http()
      .post('/v1/platform/late-probe')
      .set('Cookie', cookie)
      .set(webClientHeaders(config, 'platform'))
      .expect(201);
    expect(await late).toBeInstanceOf(UnitOfWorkClosedError);
  });
});
