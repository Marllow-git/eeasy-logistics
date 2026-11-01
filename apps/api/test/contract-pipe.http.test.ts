import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import type { ContractInput } from '../src/modules/kernel/public/index.js';
import { Input, Operation, Public } from '../src/modules/kernel/public/index.js';

// PLAT-6 item I: the kernel ContractPipe parses path, query, declared headers and body with the
// operation's generated strict schemas (platform entry point of @eeasy-logistics/contracts) and
// answers 400 validation_failed with details.fields[] JSON pointers. The probe routes are public
// and outside the surfaces so the pipe is tested without credentials or a database; each one
// echoes what the pipe handed it.

const list = operationSchemas.platformListAccounts;
const suspend = operationSchemas.platformSuspendAccount;
const me = operationSchemas.platformGetMe;

@Controller('probe/contract')
@Public()
class ContractProbe {
  @Get('accounts')
  @Operation(list)
  list(@Input() input: ContractInput<typeof list>): ContractInput<typeof list> {
    return input;
  }

  @Post('accounts/:account_id/suspend')
  @HttpCode(200)
  @Operation(suspend)
  suspend(@Input() input: ContractInput<typeof suspend>): ContractInput<typeof suspend> {
    return input;
  }

  @Get('me')
  @Operation(me)
  me(@Input() input: ContractInput<typeof me>): ContractInput<typeof me> {
    return input;
  }
}

interface Problem {
  readonly pointer: string;
  readonly code: string;
  readonly message: string;
}

const accountId = '01927f6e-7a2b-7c3d-8e4f-5a6b7c8d9e0f';
const key = '01927f6e-7a2b-7c3d-8e4f-000000000001';

describe('ContractPipe (PLAT-6 item I, A-17)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ContractProbe],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const http = () => request(app.getHttpServer());
  const fieldsOf = (response: { body: unknown }) =>
    (response.body as { code: string; details: { fields: Problem[] } }).details.fields.map(
      ({ pointer, code }) => ({ pointer, code }),
    );

  it('coerces query numbers and applies the schema default', async () => {
    const given = await http().get('/probe/contract/accounts?limit=25&status=active').expect(200);
    expect((given.body as { query: unknown }).query).toEqual({ limit: 25, status: 'active' });
    const defaulted = await http().get('/probe/contract/accounts').expect(200);
    expect((defaulted.body as { query: unknown }).query).toEqual({ limit: 50 });
  });

  it('rejects an undeclared query field such as account_id (K-3)', async () => {
    const response = await http()
      .get(`/probe/contract/accounts?account_id=${accountId}`)
      .set('Accept-Language', 'en')
      .expect(400);
    const body = response.body as { code: string; details: { fields: Problem[] } };
    expect(body.code).toBe('validation_failed');
    expect(body.details.fields).toEqual([
      { pointer: '/query/account_id', code: 'invalid', message: 'This value is invalid.' },
    ]);
  });

  it('rejects a query value out of range or not a number', async () => {
    const zero = await http().get('/probe/contract/accounts?limit=0').expect(400);
    expect(fieldsOf(zero)).toEqual([{ pointer: '/query/limit', code: 'invalid' }]);
    const word = await http().get('/probe/contract/accounts?limit=many').expect(400);
    expect(fieldsOf(word)).toEqual([{ pointer: '/query/limit', code: 'invalid' }]);
  });

  it('refuses any query on an operation that declares none', async () => {
    const response = await http().get('/probe/contract/me?debug=1').expect(400);
    expect(fieldsOf(response)).toEqual([{ pointer: '/query/debug', code: 'invalid' }]);
    await http().get('/probe/contract/me').expect(200);
  });

  it('parses path, declared headers case-insensitively and body together', async () => {
    const response = await http()
      .post(`/probe/contract/accounts/${accountId}/suspend`)
      .set('idempotency-key', key)
      .set('X-EL-CLIENT', 'web')
      .set('X-Other', 'never passed on')
      .send({ reason: 'Unpaid invoices' })
      .expect(200);
    expect(response.body).toEqual({
      params: { account_id: accountId },
      headers: { 'Idempotency-Key': key, 'X-EL-Client': 'web' },
      body: { reason: 'Unpaid invoices' },
    });
  });

  it('reports every field at fault in one answer, with JSON pointers per part', async () => {
    const response = await http()
      .post('/probe/contract/accounts/not-a-uuid/suspend')
      .set('X-EL-Client', 'mobile')
      .send({ account_id: accountId })
      .expect(400);
    expect(fieldsOf(response)).toEqual([
      { pointer: '/path/account_id', code: 'invalid' },
      { pointer: '/header/idempotency-key', code: 'required' },
      { pointer: '/header/x-el-client', code: 'invalid' },
      { pointer: '/body/reason', code: 'required' },
      { pointer: '/body/account_id', code: 'invalid' },
    ]);
  });

  it('maps a string over its maximum to too_long and escapes pointer tokens (RFC 6901)', async () => {
    const tooLong = await http()
      .post(`/probe/contract/accounts/${accountId}/suspend`)
      .set('Idempotency-Key', key)
      .set('X-EL-Client', 'web')
      .send({ reason: 'x'.repeat(501), 'a/b~c': true })
      .expect(400);
    expect(fieldsOf(tooLong)).toEqual([
      { pointer: '/body/reason', code: 'too_long' },
      { pointer: '/body/a~1b~0c', code: 'invalid' },
    ]);
  });

  it('caps details.fields[] at 50 and marks the answer truncated (adversary L-6)', async () => {
    const body: Record<string, number> = { reason: 1 };
    for (let index = 0; index < 80; index += 1) body[`extra_${index}`] = index;
    const response = await http()
      .post(`/probe/contract/accounts/${accountId}/suspend`)
      .set('Idempotency-Key', key)
      .set('X-EL-Client', 'web')
      .send(body)
      .expect(400);
    const details = (response.body as { details: { truncated?: boolean; fields: unknown[] } })
      .details;
    expect(details.fields).toHaveLength(50);
    expect(details.truncated).toBe(true);
    const few = await http().get('/probe/contract/accounts?limit=0').expect(400);
    expect((few.body as { details: { truncated?: boolean } }).details.truncated).toBeUndefined();
  });

  it('refuses a body that is not an object', async () => {
    const response = await http()
      .post(`/probe/contract/accounts/${accountId}/suspend`)
      .set('Idempotency-Key', key)
      .set('X-EL-Client', 'web')
      .set('Content-Type', 'application/json')
      .send('[1,2]')
      .expect(400);
    expect(fieldsOf(response)).toEqual([{ pointer: '/body', code: 'invalid' }]);
  });
});
