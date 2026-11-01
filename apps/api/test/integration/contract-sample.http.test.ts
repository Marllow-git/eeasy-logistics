import type { Account } from '@eeasy-logistics/contracts/platform';
import { operationSchemas } from '@eeasy-logistics/contracts/platform';
import { uuidv7 } from '@eeasy-logistics/db';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { platformCookie } from '../../src/modules/kernel/auth/principal.js';
import { SampleAccountsController } from '../contract-sample/accounts.controller.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-6 item I on the real database: the A-17 sample controller serves `platformListAccounts`
// through the whole request frame (platform token, platform unit of work, rate limit, ContractPipe)
// and every response is parsed with the operation's generated response schema (handbook 03 "Test
// data comes from the contracts").

const operation = operationSchemas.platformListAccounts;

describe('sample controller on a real operation (PLAT-6 item I)', () => {
  const signing = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
  });
  const active = uuidv7();
  const suspended = uuidv7();
  let owner: postgres.Sql;
  let app: INestApplication<App>;

  const platform = () =>
    signAccessToken(signing, 'platform').then((token) => `${platformCookie}=${token}`);

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await owner`INSERT INTO core_accounts (id, name, status) VALUES
      (${active}, 'Sample active', 'active'), (${suspended}, 'Sample suspended', 'suspended')`;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [SampleAccountsController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner`DELETE FROM core_accounts WHERE id IN (${active}, ${suspended})`;
    await owner?.end();
  });

  const http = () => request(app.getHttpServer());

  it('answers a page that parses with the generated 200 schema', async () => {
    const response = await http()
      .get('/v1/platform/accounts?status=suspended&limit=200')
      .set('Cookie', await platform())
      .expect(200);
    const page = operation.responses['200'].parse(response.body);
    // `Page & { data: Account[] }` intersects the item types; name them once.
    const accounts: Account[] = page.data;
    const ids = accounts.map((account) => account.id);
    expect(ids).toContain(suspended);
    expect(ids).not.toContain(active);
    expect(page.next_cursor).toBeNull();
  });

  it('coerces the query: limit=1 gives one account', async () => {
    const response = await http()
      .get('/v1/platform/accounts?limit=1')
      .set('Cookie', await platform())
      .expect(200);
    expect(operation.responses['200'].parse(response.body).data).toHaveLength(1);
  });

  it('refuses an undeclared field with validation_failed, parsed with the generated 4XX schema', async () => {
    const response = await http()
      .get(`/v1/platform/accounts?account_id=${active}`)
      .set('Cookie', await platform())
      .expect(400);
    const error = operation.responses['4XX'].parse(response.body);
    expect(error.code).toBe('validation_failed');
    expect(error.details).toMatchObject({
      fields: [{ pointer: '/query/account_id', code: 'invalid' }],
    });
  });

  it('still requires the platform credential before any parsing', async () => {
    const response = await http().get('/v1/platform/accounts?account_id=x').expect(401);
    expect(operation.responses['4XX'].parse(response.body).code).toBe('unauthenticated');
  });
});
