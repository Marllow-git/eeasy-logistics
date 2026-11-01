import { randomBytes, randomUUID } from 'node:crypto';
import { createAppPool, getUnitOfWork, uuidv7, withUnitOfWork } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import type { Pool } from '@eeasy-logistics/db';
import { createPlatformPool, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type { INestApplication } from '@nestjs/common';
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { platformCookie, staffCookie } from '../../src/modules/kernel/auth/principal.js';
import { TenantIdempotencyStore } from '../../src/modules/kernel/idempotency/idempotency.repository.js';
import { PlatformIdempotencyStore } from '../../src/modules/kernel/platform/idempotency.repository.js';
import { ApiException, Idempotent } from '../../src/modules/kernel/public/index.js';
import {
  purgeIdempotencyKeys,
  runIdempotencyPurge,
} from '../../src/worker/system/idempotency-purge.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import type { ProbeRow } from './probe-table.js';
import { ProbeRepository, createProbeTable, dropProbeTable, probeLabels } from './probe-table.js';
import { webClientHeaders } from '../support/web-client.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-6 item E on the real database: idempotent writes (plan 2.8) and the purge (plan 2.9). The
// probe routes are test-only and have no OpenAPI operation, so their bodies are typed here
// (handbook 03's contract-types rule covers operations of the contracts).

let releaseSlow: (() => void) | undefined;
let slowStarted: (() => void) | undefined;

interface ProbeBody {
  readonly label: string;
  readonly cash_pin?: string;
}

@Controller('v1/staff/probe-rows')
class StaffController {
  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(@Body() body: ProbeBody): Promise<ProbeRow | undefined> {
    const [row] = await new ProbeRepository(getUnitOfWork()).add({
      id: uuidv7(),
      label: body.label,
    });
    if (body.label === 'slow') {
      await new Promise<void>((resolve) => {
        releaseSlow = resolve;
        slowStarted?.();
      });
    }
    if (body.label === 'fail') throw new ApiException('invalid_transition');
    return row;
  }

  @Post('links')
  @HttpCode(201)
  @Idempotent({ secretResponse: true })
  async link(@Body() body: ProbeBody): Promise<{ id: string; link: string }> {
    const [row] = await new ProbeRepository(getUnitOfWork()).add({
      id: uuidv7(),
      label: body.label,
    });
    const token = randomBytes(24).toString('base64url');
    return { id: row?.id ?? '', link: `https://track.example.test/t/${token}` };
  }

  @Post('secrets')
  @HttpCode(201)
  @Idempotent({ secretResponse: true })
  async issue(@Body() body: ProbeBody): Promise<{ id: string; label: string; secret: string }> {
    const [row] = await new ProbeRepository(getUnitOfWork()).add({
      id: uuidv7(),
      label: body.label,
    });
    return { id: row?.id ?? '', label: body.label, secret: randomBytes(24).toString('base64url') };
  }
}

@Controller('v1/driver/probe-rows')
class DriverController {
  @Post()
  @HttpCode(201)
  @Idempotent()
  async create(@Body() body: ProbeBody): Promise<{ label: string; at: string }> {
    await new ProbeRepository(getUnitOfWork()).add({ id: uuidv7(), label: body.label });
    return { label: body.label, at: uuidv7() };
  }
}

@Controller('v1/platform/probe-notes')
class PlatformController {
  @Post()
  @HttpCode(201)
  @Idempotent()
  note(@Body() body: ProbeBody): { note: string; at: string } {
    return { note: body.label, at: uuidv7() };
  }
}

interface KeyRow {
  account_id: string | null;
  principal_type: string;
  principal_id: string;
  route: string;
  state: string;
  response_status: number | null;
  response_body: unknown;
  request_hash: Buffer;
  ttl_hours: number;
}

describe('idempotent writes (PLAT-6 item E)', () => {
  const signing = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
  });
  const account = uuidv7();
  const user = uuidv7();
  const platformUser = uuidv7();
  let owner: postgres.Sql;
  let app: INestApplication<App>;

  const staff = (sub = user) =>
    signAccessToken(signing, 'staff', { claims: { acc: account, sub } }).then(
      (token) => `${staffCookie}=${token}`,
    );
  const keyRows = (key: string) => owner<KeyRow[]>`
    SELECT account_id, principal_type, principal_id, route, state, response_status, response_body,
           request_hash, extract(epoch FROM expires_at - created_at)::int / 3600 AS ttl_hours
    FROM core_idempotency_keys WHERE key = ${key}`;
  const codeOf = (response: { body: unknown }) => (response.body as { code: string }).code;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await owner`INSERT INTO core_accounts (id, name) VALUES (${account}, 'Idempotency account')`;
    await createProbeTable(owner, config);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
      controllers: [StaffController, DriverController, PlatformController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await dropProbeTable(owner);
    await owner`DELETE FROM core_idempotency_keys
      WHERE account_id = ${account} OR principal_id = ${platformUser}`;
    await owner`DELETE FROM core_accounts WHERE id = ${account}`;
    await owner.end();
  });

  const http = () => request(app.getHttpServer());

  it('requires a UUID Idempotency-Key and stores nothing without one', async () => {
    const missing = await http()
      .post('/v1/staff/probe-rows')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .send({ label: 'no-key' })
      .expect(400);
    expect(codeOf(missing)).toBe('idempotency_key_required');
    const malformed = await http()
      .post('/v1/staff/probe-rows')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .set('Idempotency-Key', 'not-a-uuid')
      .send({ label: 'no-key' })
      .expect(400);
    expect(codeOf(malformed)).toBe('idempotency_key_required');
    expect(await probeLabels(owner, account)).not.toContain('no-key');
  });

  it('replays the stored response for the same key and body, without running again', async () => {
    const key = randomUUID();
    const first = await http()
      .post('/v1/staff/probe-rows')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .set('Idempotency-Key', key)
      .send({ label: 'once' })
      .expect(201);
    expect(first.headers['idempotency-replayed']).toBeUndefined();
    const replay = await http()
      .post('/v1/staff/probe-rows')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .set('Idempotency-Key', key.toUpperCase())
      .send({ label: 'once' })
      .expect(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect((await probeLabels(owner, account)).filter((label) => label === 'once')).toHaveLength(1);
    const [row] = await keyRows(key);
    expect(row).toMatchObject({
      account_id: account,
      principal_type: 'staff',
      principal_id: user,
      route: 'POST /v1/staff/probe-rows',
      state: 'completed',
      response_status: 201,
      ttl_hours: 24,
    });
  });

  it('answers 422 idempotency_key_reused for the same key with another body', async () => {
    const key = randomUUID();
    await http()
      .post('/v1/staff/probe-rows')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .set('Idempotency-Key', key)
      .send({ label: 'first-body' })
      .expect(201);
    const reused = await http()
      .post('/v1/staff/probe-rows')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .set('Idempotency-Key', key)
      .send({ label: 'second-body' })
      .expect(422);
    expect(codeOf(reused)).toBe('idempotency_key_reused');
    expect(await probeLabels(owner, account)).not.toContain('second-body');
  });

  it('answers 409 idempotency_in_progress with Retry-After while the first is running', async () => {
    const key = randomUUID();
    const started = new Promise<void>((resolve) => {
      slowStarted = resolve;
    });
    const cookie = await staff();
    const first = http()
      .post('/v1/staff/probe-rows')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ label: 'slow' })
      .then((response) => response);
    await started;
    const second = await http()
      .post('/v1/staff/probe-rows')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ label: 'slow' })
      .expect(409);
    expect(codeOf(second)).toBe('idempotency_in_progress');
    expect(second.headers['retry-after']).toBe('2');
    releaseSlow?.();
    expect((await first).status).toBe(201);
  });

  it('rolls the reserve back with a failed request, so a retry runs again', async () => {
    const key = randomUUID();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await http()
        .post('/v1/staff/probe-rows')
        .set(webClientHeaders(config, 'staff'))
        .set('Cookie', await staff())
        .set('Idempotency-Key', key)
        .send({ label: 'fail' })
        .expect(409);
    }
    expect(await keyRows(key)).toEqual([]);
    expect(await probeLabels(owner, account)).not.toContain('fail');
  });

  it('keys per principal: another user with the same key is a new request', async () => {
    const key = randomUUID();
    await http()
      .post('/v1/staff/probe-rows')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .set('Idempotency-Key', key)
      .send({ label: 'per-principal' })
      .expect(201);
    const other = await http()
      .post('/v1/staff/probe-rows')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff(uuidv7()))
      .set('Idempotency-Key', key)
      .send({ label: 'per-principal' })
      .expect(201);
    expect(other.headers['idempotency-replayed']).toBeUndefined();
    expect(await keyRows(key)).toHaveLength(2);
  });

  it('never stores a one-time secret; its replay is 409 secret_already_issued', async () => {
    const key = randomUUID();
    const first = await http()
      .post('/v1/staff/probe-rows/secrets')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .set('Idempotency-Key', key)
      .send({ label: 'api-key' })
      .expect(201);
    const issued = first.body as { id: string; secret: string };
    const replay = await http()
      .post('/v1/staff/probe-rows/secrets')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .set('Idempotency-Key', key)
      .send({ label: 'api-key' })
      .expect(409);
    expect(replay.body).toMatchObject({
      code: 'secret_already_issued',
      details: { resource_id: issued.id },
    });
    expect(replay.text).not.toContain(issued.secret);
    const [row] = await keyRows(key);
    expect(row?.response_body).toEqual({ id: issued.id });
    expect(JSON.stringify(row)).not.toContain(issued.secret);
  });

  it('stores only the id when the secret has another field name (adversary M-3: link)', async () => {
    const key = randomUUID();
    const first = await http()
      .post('/v1/staff/probe-rows/links')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .set('Idempotency-Key', key)
      .send({ label: 'tracking' })
      .expect(201);
    const issued = first.body as { id: string; link: string };
    const [row] = await keyRows(key);
    expect(row?.response_body).toEqual({ id: issued.id });
    expect(JSON.stringify(row)).not.toContain(issued.link);
    const replay = await http()
      .post('/v1/staff/probe-rows/links')
      .set(webClientHeaders(config, 'staff'))
      .set('Cookie', await staff())
      .set('Idempotency-Key', key)
      .send({ label: 'tracking' })
      .expect(409);
    expect(replay.body).toMatchObject({ details: { resource_id: issued.id } });
  });

  it('keys a driver by device, hashes the cash PIN only through the HMAC', async () => {
    const key = randomUUID();
    const token = await signAccessToken(signing, 'driver', { claims: { acc: account } });
    const device = (
      JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { dev: string }
    ).dev;
    await http()
      .post('/v1/driver/probe-rows')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ label: 'cash', cash_pin: '4321' })
      .expect(201);
    const otherPin = await http()
      .post('/v1/driver/probe-rows')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ label: 'cash', cash_pin: '8765' })
      .expect(422);
    expect(codeOf(otherPin)).toBe('idempotency_key_reused');
    const [row] = await keyRows(key);
    expect(row).toMatchObject({ principal_type: 'driver', principal_id: device });
    expect(row?.request_hash).toHaveLength(32);
    expect(JSON.stringify(row?.response_body)).not.toContain('4321');
  });

  it('stores a platform principal key with no account, and replays it', async () => {
    const key = randomUUID();
    const cookie = `${platformCookie}=${await signAccessToken(signing, 'platform', {
      claims: { sub: platformUser },
    })}`;
    const first = await http()
      .post('/v1/platform/probe-notes')
      .set(webClientHeaders(config, 'platform'))
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ label: 'note' })
      .expect(201);
    const replay = await http()
      .post('/v1/platform/probe-notes')
      .set(webClientHeaders(config, 'platform'))
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send({ label: 'note' })
      .expect(201);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(await keyRows(key)).toMatchObject([
      { account_id: null, principal_type: 'platform', principal_id: platformUser },
    ]);
  });
});

describe('idempotency TTL (review round 1, finding 1)', () => {
  const config = integrationConfig();
  const account = uuidv7();
  const principal = uuidv7();
  let owner: postgres.Sql;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await owner`INSERT INTO core_accounts (id, name) VALUES (${account}, 'TTL account')`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core_idempotency_keys WHERE principal_id = ${principal}`;
    await owner`DELETE FROM core_accounts WHERE id = ${account}`;
    await owner.end();
  });

  it('derives expires_at from the same TTL in the tenant and the platform store', async () => {
    const appPool = createAppPool(config.db, 'elx-ttl-test');
    const platformPool = createPlatformPool(config.db, 'elx-ttl-test-platform');
    const claim = (key: string) => ({
      principalType: 'staff' as const,
      principalId: principal,
      key,
      route: 'POST /x',
      requestHash: Buffer.alloc(32),
    });
    const context = {
      accountId: account,
      membershipId: null,
      userId: principal,
      deviceId: null,
      actingCrossTenant: false,
    };
    try {
      await withUnitOfWork(appPool.db, context, async (uow) => {
        const store = new TenantIdempotencyStore(uow, 48);
        const id = await store.insert(claim(randomUUID()));
        await store.complete(id ?? '', 201, {});
      });
      await withPlatformUnitOfWork(platformPool.db, async (uow) => {
        const store = new PlatformIdempotencyStore(uow, 48);
        const id = await store.insert(claim(randomUUID()));
        await store.complete(id ?? '', 201, {});
      });
    } finally {
      await appPool.close();
      await platformPool.close();
    }
    const rows = await owner<{ account_id: string | null; hours: number }[]>`
      SELECT account_id, extract(epoch FROM expires_at - created_at)::int / 3600 AS hours
      FROM core_idempotency_keys WHERE principal_id = ${principal} ORDER BY account_id NULLS LAST`;
    expect(rows).toEqual([
      { account_id: account, hours: 48 },
      { account_id: null, hours: 48 },
    ]);
  });
});

describe('idempotency purge (PLAT-6 plan 2.9)', () => {
  const config = integrationConfig();
  const account = uuidv7();
  const principal = uuidv7();
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let redis: Redis;

  const insertKey = (accountId: string | null, expiresInHours: number) => owner`
    INSERT INTO core_idempotency_keys
      (id, account_id, principal_type, principal_id, key, route, request_hash, state,
       response_status, response_body, expires_at)
    VALUES (${uuidv7()}, ${accountId}, 'staff', ${principal}, ${randomUUID()}, 'POST /x',
       ${Buffer.alloc(32)}, 'completed', 201, '{}'::jsonb,
       now() + make_interval(hours => ${expiresInHours}))`;
  const remaining = async () =>
    (
      await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM core_idempotency_keys WHERE principal_id = ${principal}`
    )[0]?.n;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'elx-purge-test');
    const url = config.redis.url;
    if (url === undefined) throw new Error('REDIS_URL is not configured');
    redis = new Redis(url.reveal(), { maxRetriesPerRequest: 1 });
    await owner`INSERT INTO core_accounts (id, name) VALUES (${account}, 'Purge account')`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core_idempotency_keys WHERE principal_id = ${principal}`;
    await owner`DELETE FROM core_accounts WHERE id = ${account}`;
    await owner.end();
    await pool.close();
    redis.disconnect();
  });

  it('deletes expired keys of every account and of platform principals, in batches', async () => {
    for (let index = 0; index < 5; index += 1) await insertKey(account, -1);
    await insertKey(null, -1);
    await insertKey(account, 23);
    expect(await remaining()).toBe(7);
    const deleted = await purgeIdempotencyKeys(pool.db, 2);
    expect(deleted).toBeGreaterThanOrEqual(6);
    expect(await remaining()).toBe(1);
  });

  it('runs once per lock: a second worker within the hour skips', async () => {
    const lockKey = `elx:test:idempotency-purge:${randomUUID()}`;
    try {
      await insertKey(account, -1);
      expect(await runIdempotencyPurge(pool.db, redis, lockKey)).toMatchObject({ ran: true });
      expect(await runIdempotencyPurge(pool.db, redis, lockKey)).toEqual({ ran: false });
      expect(await redis.pttl(lockKey)).toBeGreaterThan(54 * 60 * 1000);
      expect(await remaining()).toBe(1);
    } finally {
      await redis.del(lockKey);
    }
  });
});
