import { randomBytes } from 'node:crypto';
import type { Vehicle } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { insertAccount } from './identity-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// DEL-4 item C over HTTP (plan 2.6): vehicles created with a normalised plate unique per account,
// listed by plate or creation with the `active` filter, updated field by field, audited.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `vehicles:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'vehicles',
  TRUST_PROXY_HOPS: '1',
});

const createOp = operationSchemas.createVehicle;
const listOp = operationSchemas.listVehicles;
const errorOf = (body: unknown) => createOp.responses['4XX'].parse(body);

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

describe('the vehicle doors over HTTP (DEL-4 item C)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
  });

  afterAll(async () => {
    await staff?.close();
    await owner.end();
  });

  const get = (member: SignedInMember, path: string) =>
    staff.http().get(path).set('Cookie', member.cookie).set('Accept-Language', 'en');
  const send = (member: SignedInMember, method: 'post' | 'patch', path: string, body: object) =>
    staff
      .http()
      [method](path)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', nextKey())
      .send(body);
  const create = (member: SignedInMember, body: object) =>
    send(member, 'post', '/v1/staff/vehicles', body);
  const plates = async (member: SignedInMember, query: string) =>
    (listOp.responses['200'].parse(
      (await get(member, `/v1/staff/vehicles${query}`).expect(200)).body,
    ).data ?? []) as Vehicle[];

  async function dispatcherOf() {
    const accountId = await insertAccount(owner);
    return { accountId, dispatcher: await staff.member(accountId, ['dispatcher']) };
  }

  it('creates a vehicle with its plate normalised, audited; a repeated plate is 400 duplicate', async () => {
    const { accountId, dispatcher } = await dispatcherOf();
    const response = await create(dispatcher, {
      plate: '  abc   1234 ',
      kind: 'van',
      capacity_parcels: 60,
    }).expect(201);
    const vehicle = createOp.responses['201'].parse(response.body);
    expect(vehicle).toMatchObject({
      plate: 'ABC 1234',
      kind: 'van',
      capacity_parcels: 60,
      active: true,
    });
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit.map((row) => row.action)).toEqual(['delivery.vehicle.created']);
    expect(audit[0]).toMatchObject({ accountId, targetType: 'vehicle', targetId: vehicle.id });
    expect(audit[0]?.after).toEqual({
      plate: 'ABC 1234',
      kind: 'van',
      capacity_parcels: 60,
      active: true,
    });

    const duplicate = await create(dispatcher, {
      plate: 'Abc 1234',
      kind: 'car',
      capacity_parcels: 4,
    }).expect(400);
    expect(errorOf(duplicate.body).details).toMatchObject({
      fields: [{ pointer: '/body/plate', code: 'duplicate' }],
    });
    const other = await dispatcherOf();
    await create(other.dispatcher, { plate: 'ABC 1234', kind: 'car', capacity_parcels: 4 }).expect(
      201,
    );

    const missing = await create(dispatcher, { kind: 'car' }).expect(400);
    expect(errorOf(missing.body).details).toMatchObject({
      fields: [
        { pointer: '/body/plate', code: 'required' },
        { pointer: '/body/capacity_parcels', code: 'required' },
      ],
    });
    await create(dispatcher, { plate: 'x'.repeat(21), kind: 'car', capacity_parcels: 1 }).expect(
      400,
    );
    await create(dispatcher, { plate: 'Z 1', kind: 'truck', capacity_parcels: 1 }).expect(400);
    await create(dispatcher, { plate: 'Z 2', kind: 'car', capacity_parcels: -1 }).expect(400);
  });

  it('updates field by field, keeps the plate unique, writes nothing for no change, 404 for another account', async () => {
    const { dispatcher } = await dispatcherOf();
    const first = createOp.responses['201'].parse(
      (await create(dispatcher, { plate: 'one 1', kind: 'car', capacity_parcels: 5 }).expect(201))
        .body,
    );
    await create(dispatcher, { plate: 'two 2', kind: 'motorbike', capacity_parcels: 2 }).expect(
      201,
    );
    const path = `/v1/staff/vehicles/${first.id}`;
    const response = await send(dispatcher, 'patch', path, {
      active: false,
      capacity_parcels: 7,
    }).expect(200);
    expect(operationSchemas.updateVehicle.responses['200'].parse(response.body)).toMatchObject({
      plate: 'ONE 1',
      kind: 'car',
      capacity_parcels: 7,
      active: false,
    });
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit[0]).toMatchObject({
      action: 'delivery.vehicle.updated',
      before: { capacity_parcels: 5, active: true },
      after: { capacity_parcels: 7, active: false },
    });
    const [row] = await owner<
      { version: number }[]
    >`SELECT version FROM del_vehicles WHERE id = ${first.id}`;
    expect(row?.version).toBe(2);
    const same = await send(dispatcher, 'patch', path, { plate: ' one  1 ' }).expect(200);
    expect(await auditRowsOf(owner, same.headers['x-request-id'] as string)).toEqual([]);
    const taken = await send(dispatcher, 'patch', path, { plate: 'TWO 2' }).expect(400);
    expect(errorOf(taken.body).details).toMatchObject({
      fields: [{ pointer: '/body/plate', code: 'duplicate' }],
    });
    await send(dispatcher, 'patch', `/v1/staff/vehicles/${uuidv7()}`, { active: true }).expect(404);
    const other = await dispatcherOf();
    await send(other.dispatcher, 'patch', path, { active: true }).expect(404);
  });

  it('lists by plate by default and by creation, filters active, pages; a viewer reads but cannot write', async () => {
    const { accountId, dispatcher } = await dispatcherOf();
    for (const [plate, active] of [
      ['C 3', true],
      ['A 1', true],
      ['D 4', false],
      ['B 2', true],
    ] as const) {
      await create(dispatcher, { plate, kind: 'car', capacity_parcels: 1, active }).expect(201);
    }
    expect((await plates(dispatcher, '')).map((vehicle) => vehicle.plate)).toEqual([
      'A 1',
      'B 2',
      'C 3',
      'D 4',
    ]);
    expect((await plates(dispatcher, '?active=false')).map((vehicle) => vehicle.plate)).toEqual([
      'D 4',
    ]);
    expect((await plates(dispatcher, '?sort=-created_at')).map((vehicle) => vehicle.plate)).toEqual(
      ['B 2', 'D 4', 'A 1', 'C 3'],
    );
    const page = listOp.responses['200'].parse(
      (await get(dispatcher, '/v1/staff/vehicles?limit=3').expect(200)).body,
    );
    expect(page.next_cursor).not.toBeNull();
    const rest = await plates(dispatcher, `?limit=3&cursor=${page.next_cursor ?? ''}`);
    expect(rest.map((vehicle) => vehicle.plate)).toEqual(['D 4']);
    await get(dispatcher, '/v1/staff/vehicles?sort=kind').expect(400);
    const viewer = await staff.member(accountId, ['viewer']);
    expect(await plates(viewer, '?limit=1')).toHaveLength(1);
    await create(viewer, { plate: 'V 1', kind: 'car', capacity_parcels: 1 }).expect(403);
  });
});
