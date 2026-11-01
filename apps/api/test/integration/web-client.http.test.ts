import { randomUUID } from 'node:crypto';
import { uuidv7 } from '@eeasy-logistics/db';
import type { INestApplication } from '@nestjs/common';
import { Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { platformCookie, staffCookie } from '../../src/modules/kernel/auth/principal.js';
import { Idempotent, Operation, Public } from '../../src/modules/kernel/public/index.js';
import { probeOperations } from '../support/probe-operations.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-6 item G (plan 2.11, 2.13; ADR-0032, ADR-0038): staff and platform writes need
// `X-EL-Client: web` and the Origin of their own application, else 403 forbidden, decided before
// any interceptor runs, so a refused write reserves no idempotency key. Reads, the driver surface
// and public doors of other surfaces are untouched.

const webOrigin = 'https://app.example.test';
const adminOrigin = 'https://admin.example.test';

let handled = 0;

@Controller('v1/staff/marker-probe')
class StaffMarkerProbe {
  @Get()
  @Operation(probeOperations.staffRead)
  read(): { ok: true } {
    return { ok: true };
  }

  @Post()
  @Operation(probeOperations.staffWrite)
  @HttpCode(201)
  @Idempotent()
  create(): { ok: true } {
    handled += 1;
    return { ok: true };
  }

  @Patch()
  @Operation(probeOperations.staffWrite)
  change(): { ok: true } {
    handled += 1;
    return { ok: true };
  }

  @Delete()
  @Operation(probeOperations.staffWrite)
  @HttpCode(204)
  remove(): void {
    handled += 1;
  }

  // A sign-in door is public and still a staff write: CSRF applies to it too.
  @Post('door')
  @Public()
  @HttpCode(200)
  @Operation(probeOperations.staffDoor)
  door(): { ok: true } {
    handled += 1;
    return { ok: true };
  }
}

@Controller('v1/platform/marker-probe')
class PlatformMarkerProbe {
  @Post()
  @Operation(probeOperations.platformWrite)
  @HttpCode(201)
  @Idempotent()
  create(): { ok: true } {
    handled += 1;
    return { ok: true };
  }
}

@Controller('v1/driver/marker-probe')
class DriverMarkerProbe {
  @Post()
  @Operation(probeOperations.driverWork)
  @HttpCode(201)
  create(): { ok: true } {
    return { ok: true };
  }
}

describe('web client marker on staff and platform writes (PLAT-6 item G)', () => {
  const signing = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
    // A path and trailing slash in the URL: the check compares origins only.
    PUBLIC_WEB_URL: `${webOrigin}/`,
    PUBLIC_ADMIN_URL: `${adminOrigin}/console`,
  });
  const account = uuidv7();
  const staffUser = uuidv7();
  const platformUser = uuidv7();
  let owner: postgres.Sql;
  let app: INestApplication<App>;

  const staff = () =>
    signAccessToken(signing, 'staff', { claims: { acc: account, sub: staffUser } }).then(
      (token) => `${staffCookie}=${token}`,
    );
  const platform = () =>
    signAccessToken(signing, 'platform', { claims: { sub: platformUser } }).then(
      (token) => `${platformCookie}=${token}`,
    );
  const keysOf = async (principal: string) =>
    Number(
      (
        await owner<{ count: string }[]>`
          SELECT count(*) AS count FROM core_idempotency_keys WHERE principal_id = ${principal}`
      )[0]?.count,
    );

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await owner`INSERT INTO core_accounts (id, name) VALUES (${account}, 'Marker account')`;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [StaffMarkerProbe, PlatformMarkerProbe, DriverMarkerProbe],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner`DELETE FROM core_idempotency_keys WHERE principal_id IN (${staffUser}, ${platformUser})`;
    await owner`DELETE FROM core_accounts WHERE id = ${account}`;
    await owner?.end();
  });

  const http = () => request(app.getHttpServer());
  const codeOf = (response: { body: unknown }) => (response.body as { code: string }).code;

  it('refuses a staff write without the marker, with another marker value, without or with a foreign Origin, and reserves no key', async () => {
    const before = handled;
    const cases: Record<string, string>[] = [
      { Origin: webOrigin },
      { 'X-EL-Client': 'mobile', Origin: webOrigin },
      { 'X-EL-Client': 'web' },
      { 'X-EL-Client': 'web', Origin: 'https://evil.example.test' },
      { 'X-EL-Client': 'web', Origin: adminOrigin },
      { 'X-EL-Client': 'web', Origin: `${webOrigin}:8443` },
      { 'X-EL-Client': 'web', Origin: 'null' },
    ];
    for (const headers of cases) {
      const response = await http()
        .post('/v1/staff/marker-probe')
        .set('Cookie', await staff())
        .set('Idempotency-Key', randomUUID())
        .set(headers)
        .send({})
        .expect(403);
      expect(codeOf(response)).toBe('forbidden');
      expect(response.headers['x-request-id']).toBeDefined();
    }
    expect(handled).toBe(before);
    expect(await keysOf(staffUser)).toBe(0);
  });

  it('accepts a staff write with the marker and the web origin, and reserves its key', async () => {
    await http()
      .post('/v1/staff/marker-probe')
      .set('Cookie', await staff())
      .set('Idempotency-Key', randomUUID())
      .set({ 'X-EL-Client': 'web', Origin: webOrigin })
      .send({})
      .expect(201);
    expect(await keysOf(staffUser)).toBe(1);
  });

  it('covers PATCH, DELETE and public staff doors; reads need nothing', async () => {
    const cookie = await staff();
    await http().patch('/v1/staff/marker-probe').set('Cookie', cookie).send({}).expect(403);
    await http().delete('/v1/staff/marker-probe').set('Cookie', cookie).expect(403);
    await http().post('/v1/staff/marker-probe/door').send({}).expect(403);
    const marker = { 'X-EL-Client': 'web', Origin: webOrigin };
    await http().patch('/v1/staff/marker-probe').set('Cookie', cookie).set(marker).expect(200);
    await http().delete('/v1/staff/marker-probe').set('Cookie', cookie).set(marker).expect(204);
    await http().post('/v1/staff/marker-probe/door').set(marker).send({}).expect(200);
    await http().get('/v1/staff/marker-probe').set('Cookie', cookie).expect(200);
  });

  it('refuses a platform write from the merchant web origin and accepts the console origin', async () => {
    const cookie = await platform();
    const refused = await http()
      .post('/v1/platform/marker-probe')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .set({ 'X-EL-Client': 'web', Origin: webOrigin })
      .send({})
      .expect(403);
    expect(codeOf(refused)).toBe('forbidden');
    expect(await keysOf(platformUser)).toBe(0);
    await http()
      .post('/v1/platform/marker-probe')
      .set('Cookie', cookie)
      .set('Idempotency-Key', randomUUID())
      .set({ 'X-EL-Client': 'web', Origin: adminOrigin })
      .send({})
      .expect(201);
    expect(await keysOf(platformUser)).toBe(1);
  });

  it('leaves the driver surface alone (bearer credential, no browser)', async () => {
    const token = await signAccessToken(signing, 'driver', { claims: { acc: account } });
    await http()
      .post('/v1/driver/marker-probe')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
  });
});

describe('web client marker without configured origins (PLAT-6 item G)', () => {
  const signing = testSigningKey();
  let app: INestApplication<App>;

  beforeAll(async () => {
    const config = integrationConfig({
      AUTH_SIGNING_KEY_ID: signing.keyId,
      AUTH_SIGNING_KEY: signing.key,
      PUBLIC_WEB_URL: '',
      PUBLIC_ADMIN_URL: '',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [StaffMarkerProbe],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('fails closed: every staff write is 403 whatever it sends', async () => {
    const cookie = `${staffCookie}=${await signAccessToken(signing, 'staff')}`;
    await request(app.getHttpServer())
      .patch('/v1/staff/marker-probe')
      .set('Cookie', cookie)
      .set({ 'X-EL-Client': 'web', Origin: 'http://localhost:3001' })
      .expect(403);
  });
});
