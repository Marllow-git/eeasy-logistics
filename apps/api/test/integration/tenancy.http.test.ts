import { getContext, getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import type { INestApplication } from '@nestjs/common';
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { staffCookie } from '../../src/modules/kernel/auth/principal.js';
import { ApiException } from '../../src/modules/kernel/public/index.js';
import type { TestSigningKey } from '../support/access-tokens.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import type { ProbeRow } from './probe-table.js';
import {
  ProbeRepository,
  createProbeTable,
  dropProbeTable,
  insertProbeRows,
  probeLabels,
} from './probe-table.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-6 item C on the real database: the guard resolves the principal from the token, the
// interceptor opens one unit of work per request for the token's account, and a probe repository
// (ScopedRepository) on a scratch tenant table sees only that account, whatever the request says.
// With ELX_RLS=on the run proves the template policies as well as the predicate.

@Controller('v1/staff/probe-rows')
class StaffProbeController {
  @Get()
  async list(): Promise<{ account: string; rows: ProbeRow[] }> {
    const rows = await new ProbeRepository(getUnitOfWork()).all();
    return { account: getContext().accountId, rows };
  }

  // The body tries to name another account; the repository takes the token's.
  @Post()
  @HttpCode(201)
  async create(@Body() body: { label: string; account_id?: string; accountId?: string }) {
    const input = { id: uuidv7(), label: body.label, accountId: body.accountId } as never;
    const [row] = await new ProbeRepository(getUnitOfWork()).add(input);
    return row;
  }

  @Post('then-fail')
  async createThenFail(@Body() body: { label: string }): Promise<never> {
    await new ProbeRepository(getUnitOfWork()).add({ id: uuidv7(), label: body.label });
    throw new ApiException('invalid_transition');
  }
}

@Controller('v1/driver/probe-rows')
class DriverProbeController {
  @Get()
  async list(): Promise<{ device: string | null; rows: ProbeRow[] }> {
    const rows = await new ProbeRepository(getUnitOfWork()).all();
    return { device: getContext().deviceId, rows };
  }
}

describe('request context and unit of work per request (PLAT-6 item C)', () => {
  const signing: TestSigningKey = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
  });
  const accountA = uuidv7();
  const accountB = uuidv7();
  let owner: postgres.Sql;
  let app: INestApplication<App>;

  const staff = (account: string) =>
    signAccessToken(signing, 'staff', { claims: { acc: account } }).then(
      (token) => `${staffCookie}=${token}`,
    );
  const labels = (account: string) => probeLabels(owner, account);

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await createProbeTable(owner, config);
    await insertProbeRows(owner, [
      { id: uuidv7(), accountId: accountA, label: 'a-1' },
      { id: uuidv7(), accountId: accountA, label: 'a-2' },
      { id: uuidv7(), accountId: accountB, label: 'b-1' },
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [StaffProbeController, DriverProbeController],
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

  it('answers 401 unauthenticated without a credential', async () => {
    const response = await http().get('/v1/staff/probe-rows').expect(401);
    expect((response.body as { code: string }).code).toBe('unauthenticated');
  });

  it("reads only the token's account: two tokens, two accounts", async () => {
    const seenByA = await http()
      .get('/v1/staff/probe-rows')
      .set('Cookie', await staff(accountA));
    expect(seenByA.status).toBe(200);
    const bodyA = seenByA.body as { account: string; rows: ProbeRow[] };
    expect(bodyA.account).toBe(accountA);
    expect(bodyA.rows.map((row) => row.label).sort()).toEqual(['a-1', 'a-2']);

    const seenByB = await http()
      .get('/v1/staff/probe-rows')
      .set('Cookie', await staff(accountB));
    const bodyB = seenByB.body as { account: string; rows: ProbeRow[] };
    expect(bodyB.account).toBe(accountB);
    expect(bodyB.rows.map((row) => row.label)).toEqual(['b-1']);
  });

  it('never takes the account from the query, a header or the body', async () => {
    const response = await http()
      .post(`/v1/staff/probe-rows?account_id=${accountB}`)
      .set('Cookie', await staff(accountA))
      .set('X-Account-Id', accountB)
      .send({ label: 'smuggled', account_id: accountB, accountId: accountB })
      .expect(201);
    expect((response.body as ProbeRow).accountId).toBe(accountA);
    expect(await labels(accountB)).toEqual(['b-1']);
    expect(await labels(accountA)).toContain('smuggled');
  });

  it('runs the driver surface for the token account and device', async () => {
    const token = await signAccessToken(signing, 'driver', { claims: { acc: accountB } });
    const response = await http()
      .get('/v1/driver/probe-rows')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = response.body as { device: string; rows: ProbeRow[] };
    expect(body.rows.map((row) => row.label)).toEqual(['b-1']);
    expect(body.device).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rolls the transaction back when the handler throws', async () => {
    const response = await http()
      .post('/v1/staff/probe-rows/then-fail')
      .set('Cookie', await staff(accountA))
      .send({ label: 'rolled-back' })
      .expect(409);
    expect((response.body as { code: string }).code).toBe('invalid_transition');
    expect(await labels(accountA)).not.toContain('rolled-back');
  });

  it('refuses a driver token on the staff surface', async () => {
    const token = await signAccessToken(signing, 'driver', { claims: { acc: accountA } });
    await http()
      .get('/v1/staff/probe-rows')
      .set('Cookie', `${staffCookie}=${token}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('keeps the health probes public', async () => {
    await http().get('/health').expect(200);
  });

  it('throws from getUnitOfWork() and getContext() outside a request', () => {
    expect(() => getUnitOfWork()).toThrow(/No tenant unit of work/);
    expect(() => getContext()).toThrow(/No request context/);
  });
});
