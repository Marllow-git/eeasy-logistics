import { randomBytes } from 'node:crypto';
import { operationSchemas as staffOps } from '@eeasy-logistics/contracts/staff/schemas';
import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository, getContext, getUnitOfWork, uuidv7 } from '@eeasy-logistics/db';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { staffCookie } from '../../src/modules/kernel/auth/principal.js';
import { Operation, SiteScoped, siteFilter } from '../../src/modules/kernel/public/index.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import { webClientHeaders } from '../support/web-client.js';
import { auditRowsOf } from './audit-rows.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-10 item D (plan 2.6, 2.10) on the real database: a principal holding an operation's
// permission only through site-scoped bundles (site staff, cashier, warehouse staff) reaches its
// own sites only: another site is 404 not_found (README §4, never 403, and no denial row), an empty
// `sites` claim sees nothing, and `siteFilter` limits a list to the token's sites. Roles that are
// not site-scoped ignore `sites`.

const schema = `scratch_${randomBytes(4).toString('hex')}`;
const siteRows = pgSchema(schema).table('site_rows', {
  id: uuid('id').primaryKey(),
  accountId: uuid('account_id').notNull(),
  siteId: uuid('site_id').notNull(),
  label: text('label').notNull(),
});

class SiteRowsRepository extends ScopedRepository<typeof siteRows> {
  constructor(uow: UnitOfWork) {
    super(uow, siteRows);
  }

  async labels(): Promise<string[]> {
    const rows = await this.findMany(siteFilter(getContext(), siteRows.siteId));
    return rows.map((row) => row.label).sort();
  }
}

@Controller('v1/staff/site-probe')
class SiteProbe {
  @Get('sites/:site_id')
  @SiteScoped()
  @Operation(staffOps.getSite) // core.sites.read
  get(): { ok: true } {
    return { ok: true };
  }

  @Post('returns')
  @HttpCode(200)
  @SiteScoped({ from: 'body', name: 'site_id' })
  @Operation(staffOps.checkInReturn) // delivery.orders.receive
  receive(): { ok: true } {
    return { ok: true };
  }

  @Get('rows')
  @SiteScoped({ from: 'query', name: 'site_id' })
  @Operation(staffOps.listSites) // core.sites.read
  async rows(): Promise<string[]> {
    return new SiteRowsRepository(getUnitOfWork()).labels();
  }
}

describe('site scoping (PLAT-10 item D)', () => {
  const signing = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
  });
  const accountId = uuidv7();
  const [siteA, siteB, siteC] = [uuidv7(), uuidv7(), uuidv7()];
  let owner: postgres.Sql;
  let app: INestApplication<App>;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await owner`INSERT INTO core_accounts (id, name) VALUES (${accountId}, 'site scope test')`;
    const table = `"${schema}".site_rows`;
    await owner.unsafe(`CREATE SCHEMA "${schema}"`);
    await owner.unsafe(
      `CREATE TABLE ${table} (id uuid PRIMARY KEY, account_id uuid NOT NULL, site_id uuid NOT NULL, label text NOT NULL)`,
    );
    await owner.unsafe(`GRANT USAGE ON SCHEMA "${schema}" TO elx_app`);
    await owner.unsafe(`GRANT SELECT ON ${table} TO elx_app`);
    await owner.unsafe(`
      CREATE POLICY tenant_isolation ON ${table} TO elx_app
        USING (account_id = NULLIF(current_setting('elx.account_id', true), '')::uuid)`);
    if (config.db.rls) await owner.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    for (const [site, label] of [
      [siteA, 'a-1'],
      [siteA, 'a-2'],
      [siteB, 'b-1'],
      [siteC, 'c-1'],
    ] as const) {
      await owner.unsafe(
        `INSERT INTO ${table} (id, account_id, site_id, label) VALUES ($1, $2, $3, $4)`,
        [uuidv7(), accountId, site, label],
      );
    }
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [SiteProbe],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner?.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await owner?.end();
  });

  const http = () => request(app.getHttpServer());
  const staff = async (roles: string[], sites: string[]) =>
    `${staffCookie}=${await signAccessToken(signing, 'staff', {
      claims: { acc: accountId, roles, sites },
    })}`;
  const receive = (cookie: string, body: Record<string, unknown>) =>
    http()
      .post('/v1/staff/site-probe/returns')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', cookie)
      .send(body);

  it('lets site staff reach their sites and answers 404 for another one, never 403', async () => {
    const cookie = await staff(['site_staff'], [siteA, siteB]);
    await http().get(`/v1/staff/site-probe/sites/${siteA}`).set('Cookie', cookie).expect(200);
    await http()
      .get(`/v1/staff/site-probe/sites/${siteB.toUpperCase()}`)
      .set('Cookie', cookie)
      .expect(200);
    const outside = await http()
      .get(`/v1/staff/site-probe/sites/${siteC}`)
      .set('Cookie', cookie)
      .expect(404);
    expect((outside.body as { code: string }).code).toBe('not_found');
    expect(await auditRowsOf(owner, outside.headers['x-request-id'] as string)).toHaveLength(0);
    // A malformed site is as unknown as another one.
    await http().get('/v1/staff/site-probe/sites/not-a-site').set('Cookie', cookie).expect(404);
  });

  it('checks a site named in the body, and refuses a body without it', async () => {
    const cookie = await staff(['site_staff'], [siteA]);
    await receive(cookie, { site_id: siteA }).expect(200);
    await receive(cookie, { site_id: siteC }).expect(404);
    await receive(cookie, { site_id: [siteA] }).expect(404);
    await receive(cookie, {}).expect(404);
  });

  it('fails closed on an empty site list: nothing at all', async () => {
    const cookie = await staff(['site_staff'], []);
    await http().get(`/v1/staff/site-probe/sites/${siteA}`).set('Cookie', cookie).expect(404);
    await http().get('/v1/staff/site-probe/rows').set('Cookie', cookie).expect(404);
    await receive(cookie, { site_id: siteA }).expect(404);
  });

  it('filters a list to the token sites with siteFilter', async () => {
    const cookie = await staff(['cashier'], [siteA, siteB]);
    const listed = await http().get('/v1/staff/site-probe/rows').set('Cookie', cookie).expect(200);
    expect(listed.body).toEqual(['a-1', 'a-2', 'b-1']);
    await http()
      .get(`/v1/staff/site-probe/rows?site_id=${siteC}`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it('ignores sites for roles that are not site-scoped, alone or beside a site-scoped one', async () => {
    for (const roles of [['viewer'], ['viewer', 'site_staff'], ['site_staff', 'viewer']]) {
      const cookie = await staff(roles, [siteA]);
      await http().get(`/v1/staff/site-probe/sites/${siteC}`).set('Cookie', cookie).expect(200);
      const listed = await http().get('/v1/staff/site-probe/rows').set('Cookie', cookie);
      expect(listed.body, roles.join()).toEqual(['a-1', 'a-2', 'b-1', 'c-1']);
    }
    // The owner with no sites at all sees everything too.
    const ownerCookie = await staff(['owner'], []);
    await http().get(`/v1/staff/site-probe/sites/${siteC}`).set('Cookie', ownerCookie).expect(200);
  });

  it('still refuses a site-scoped role the permissions it lacks with 403', async () => {
    // Warehouse staff hold no core.sites.read: forbidden, whatever the site.
    const cookie = await staff(['warehouse_staff'], [siteA]);
    await http().get(`/v1/staff/site-probe/sites/${siteA}`).set('Cookie', cookie).expect(403);
  });
});
