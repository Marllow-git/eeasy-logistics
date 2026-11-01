import { uuidv7 } from '@eeasy-logistics/db';
import { operationSchemas as driverOps } from '@eeasy-logistics/contracts/driver/schemas';
import { operationSchemas as platformOps } from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas as staffOps } from '@eeasy-logistics/contracts/staff/schemas';
import type { INestApplication } from '@nestjs/common';
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { platformCookie, staffCookie } from '../../src/modules/kernel/auth/principal.js';
import {
  DenialAuditThrottle,
  denialWindowMs,
} from '../../src/modules/kernel/authz/denial-throttle.js';
import { Operation } from '../../src/modules/kernel/public/index.js';
import type { TestSigningKey } from '../support/access-tokens.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import { webClientHeaders } from '../support/web-client.js';
import { auditRowsOf } from './audit-rows.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-10 items C (plan 2.4, 2.5, 2.8, 2.9, 2.10) on the real database: the permission guard reads
// the bundles of core_roles (migration 0008) and the operation's x-permission from the generated
// operationSchemas entry each probe binds; refusals are 403 forbidden with no detail and one
// committed core.authorization.denied row per principal and operation per minute.

@Controller('v1/staff/authz-probe')
class StaffAuthzProbe {
  @Get('orders')
  @Operation(staffOps.listOrders) // delivery.orders.read
  list(): { ok: true } {
    return { ok: true };
  }

  @Post('orders/assign')
  @HttpCode(200)
  @Operation(staffOps.assignOrder) // delivery.orders.dispatch
  assign(): { ok: true } {
    return { ok: true };
  }

  @Post('sites')
  @HttpCode(200)
  @Operation(staffOps.createSite) // core.sites.manage
  createSite(): { ok: true } {
    return { ok: true };
  }

  @Get('me')
  @Operation(staffOps.getMe) // core.auth.self
  me(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/platform/authz-probe')
class PlatformAuthzProbe {
  @Post('rollout')
  @HttpCode(200)
  @Operation(platformOps.platformSetRolloutMode) // platform.rollout.manage
  rollout(): { ok: true } {
    return { ok: true };
  }

  @Get('accounts')
  @Operation(platformOps.platformListAccounts) // platform.accounts.read
  accounts(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/driver/authz-probe')
class DriverAuthzProbe {
  @Get('me')
  @Operation(driverOps.driverGetMe) // delivery.driver.work
  me(): { ok: true } {
    return { ok: true };
  }
}

describe('permission guard (PLAT-10 item C)', () => {
  const signing: TestSigningKey = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
  });
  const accountId = uuidv7();
  let clock = Date.parse('2026-11-01T10:00:00Z');
  let owner: postgres.Sql;
  let app: INestApplication<App>;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    // Audit rows reference their account (K-7), so the denied staff principal's account exists.
    await owner`INSERT INTO core_accounts (id, name) VALUES (${accountId}, 'permissions test')`;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [StaffAuthzProbe, PlatformAuthzProbe, DriverAuthzProbe],
    })
      .overrideProvider(DenialAuditThrottle)
      .useValue(new DenialAuditThrottle(() => clock))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  const http = () => request(app.getHttpServer());
  const staff = async (roles: string[], sub = uuidv7()) =>
    `${staffCookie}=${await signAccessToken(signing, 'staff', {
      claims: { acc: accountId, roles, sub },
    })}`;
  const platform = async (roles: string[], sub = uuidv7()) =>
    `${platformCookie}=${await signAccessToken(signing, 'platform', { claims: { roles, sub } })}`;
  const driver = async (roles: string[]) =>
    `Bearer ${await signAccessToken(signing, 'driver', { claims: { roles } })}`;
  const staffWrite = (path: string, cookie: string) =>
    http().post(path).set(webClientHeaders(config, 'staff')).set('Cookie', cookie).send({});
  const platformWrite = (path: string, cookie: string) =>
    http().post(path).set(webClientHeaders(config, 'platform')).set('Cookie', cookie).send({});

  it('lets the owner read and write', async () => {
    const cookie = await staff(['owner']);
    await http().get('/v1/staff/authz-probe/orders').set('Cookie', cookie).expect(200);
    await staffWrite('/v1/staff/authz-probe/sites', cookie).expect(200);
  });

  it('refuses a viewer a write with 403 forbidden and no detail of the permission', async () => {
    const cookie = await staff(['viewer']);
    await http().get('/v1/staff/authz-probe/orders').set('Cookie', cookie).expect(200);
    const refused = await staffWrite('/v1/staff/authz-probe/sites', cookie)
      .set('Accept-Language', 'en')
      .expect(403);
    const body = refused.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['code', 'message', 'request_id']);
    expect(body.code).toBe('forbidden');
    expect(JSON.stringify(body)).not.toContain('core.sites');
  });

  it('lets a dispatcher dispatch and refuses a cashier', async () => {
    await staffWrite('/v1/staff/authz-probe/orders/assign', await staff(['dispatcher'])).expect(
      200,
    );
    const refused = await staffWrite(
      '/v1/staff/authz-probe/orders/assign',
      await staff(['cashier'], uuidv7()),
    ).expect(403);
    expect((refused.body as { code: string }).code).toBe('forbidden');
  });

  it('unions several roles and ignores an unknown one', async () => {
    const both = await staff(['viewer', 'dispatcher']);
    await staffWrite('/v1/staff/authz-probe/orders/assign', both).expect(200);
    await http()
      .get('/v1/staff/authz-probe/orders')
      .set('Cookie', await staff(['no_such_role']))
      .expect(403);
  });

  it('opens the self door to any principal of the surface, roles or none', async () => {
    await http()
      .get('/v1/staff/authz-probe/me')
      .set('Cookie', await staff([]))
      .expect(200);
  });

  it('refuses platform support a rollout change and lets the super admin make it', async () => {
    const refused = await platformWrite(
      '/v1/platform/authz-probe/rollout',
      await platform(['support']),
    ).expect(403);
    expect((refused.body as { code: string }).code).toBe('forbidden');
    await platformWrite('/v1/platform/authz-probe/rollout', await platform(['admin'])).expect(403);
    await platformWrite('/v1/platform/authz-probe/rollout', await platform(['super_admin'])).expect(
      200,
    );
    await http()
      .get('/v1/platform/authz-probe/accounts')
      .set('Cookie', await platform(['support']))
      .expect(200);
  });

  it('counts a bundle only on its own surface', async () => {
    // A merchant role on a platform token, a platform bundle key spelt out, a staff role on a
    // driver token: none of them grants anything there.
    await http()
      .get('/v1/platform/authz-probe/accounts')
      .set('Cookie', await platform(['owner']))
      .expect(403);
    await http()
      .get('/v1/platform/authz-probe/accounts')
      .set('Cookie', await platform(['platform_super_admin']))
      .expect(403);
    await http()
      .get('/v1/driver/authz-probe/me')
      .set('Authorization', await driver(['owner']))
      .expect(403);
    await http()
      .get('/v1/staff/authz-probe/orders')
      .set('Cookie', await staff(['driver']))
      .expect(403);
  });

  it('grants the driver surface from the driver bundle', async () => {
    await http()
      .get('/v1/driver/authz-probe/me')
      .set('Authorization', await driver(['driver']))
      .expect(200);
  });

  it('writes one denial audit row per principal and operation per minute', async () => {
    const sub = uuidv7();
    const cookie = await staff(['viewer'], sub);
    const first = await staffWrite('/v1/staff/authz-probe/sites', cookie).expect(403);
    const second = await staffWrite('/v1/staff/authz-probe/sites', cookie).expect(403);
    const firstRows = await auditRowsOf(owner, first.headers['x-request-id'] as string);
    expect(firstRows).toHaveLength(1);
    expect(firstRows[0]).toMatchObject({
      actorType: 'user',
      actorId: sub,
      accountId,
      targetType: 'operation',
      targetId: 'createSite',
      action: 'core.authorization.denied',
      after: {
        operation: 'createSite',
        permission: 'core.sites.manage',
        surface: 'staff',
        roles: ['viewer'],
      },
    });
    expect(await auditRowsOf(owner, second.headers['x-request-id'] as string)).toHaveLength(0);

    // Another operation of the same principal has its own budget.
    const other = await staffWrite('/v1/staff/authz-probe/orders/assign', cookie).expect(403);
    expect(await auditRowsOf(owner, other.headers['x-request-id'] as string)).toHaveLength(1);

    // The next minute writes again.
    clock += denialWindowMs;
    const later = await staffWrite('/v1/staff/authz-probe/sites', cookie).expect(403);
    expect(await auditRowsOf(owner, later.headers['x-request-id'] as string)).toHaveLength(1);
  });

  it('records a platform denial with no account', async () => {
    const sub = uuidv7();
    const refused = await platformWrite(
      '/v1/platform/authz-probe/rollout',
      await platform(['support'], sub),
    ).expect(403);
    const rows = await auditRowsOf(owner, refused.headers['x-request-id'] as string);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorType: 'platform_user',
      actorId: sub,
      accountId: null,
      targetId: 'platformSetRolloutMode',
      after: { permission: 'platform.rollout.manage', surface: 'platform' },
    });
  });
});
