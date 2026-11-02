import { randomBytes } from 'node:crypto';
import type { Coverage, Zone } from '@eeasy-logistics/contracts/staff/schemas';
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
import { plantSite, plantZones, polygon, ring } from './zone-fixtures.js';

// DEL-1 item B over HTTP (plan 2.2 to 2.4, 2.7): zones created from a polygon or a multipolygon
// within the bounds and valid in PostGIS, listed without boundaries in both names' order, read
// with the boundary, updated field by field and audited; a site's coverage replaced as a set,
// refused for a warehouse or a foreign zone, audited before and after; another account's zone is
// invisible.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `zones:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'zones',
  TRUST_PROXY_HOPS: '1',
});

const createOp = operationSchemas.createZone;
const listOp = operationSchemas.listZones;
const errorOf = (body: unknown) => createOp.responses['4XX'].parse(body);

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

describe('the zone and coverage doors over HTTP (DEL-1 item B)', () => {
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
  const send = (
    member: SignedInMember,
    method: 'post' | 'patch' | 'put',
    path: string,
    body: object,
  ) =>
    staff
      .http()
      [method](path)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', nextKey())
      .send(body);
  const create = (member: SignedInMember, body: object) =>
    send(member, 'post', '/v1/staff/zones', body);
  const zoneBody = (overrides: object = {}) => ({
    name_ar: 'العليا',
    name_en: 'Olaya',
    source: 'drawn',
    boundary: polygon(46.66, 24.68, 46.7, 24.72),
    ...overrides,
  });
  const listed = async (member: SignedInMember, query: string) =>
    (listOp.responses['200'].parse((await get(member, `/v1/staff/zones${query}`).expect(200)).body)
      .data ?? []) as Zone[];

  async function adminOf() {
    const accountId = await insertAccount(owner);
    return { accountId, admin: await staff.member(accountId, ['admin']) };
  }

  it('creates a zone from a polygon (wrapped) and a multipolygon, audited by counts', async () => {
    const { accountId, admin } = await adminOf();
    const response = await create(admin, zoneBody({ name_en: '  Olaya  ' })).expect(201);
    const zone = createOp.responses['201'].parse(response.body);
    expect(zone).toMatchObject({
      name_ar: 'العليا',
      name_en: 'Olaya',
      source: 'drawn',
      active: true,
      boundary: { type: 'MultiPolygon', coordinates: [[ring(46.66, 24.68, 46.7, 24.72)]] },
    });
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit.map((row) => row.action)).toEqual(['delivery.zone.created']);
    expect(audit[0]).toMatchObject({
      accountId,
      actorType: 'user',
      actorId: admin.userId,
      targetType: 'zone',
      targetId: zone.id,
    });
    expect(audit[0]?.after).toEqual({
      name_ar: 'العليا',
      name_en: 'Olaya',
      source: 'drawn',
      active: true,
      boundary: { polygons: 1, positions: 5 },
    });

    const multi = {
      type: 'MultiPolygon',
      coordinates: [[ring(46.6, 24.6, 46.62, 24.62)], [ring(46.7, 24.7, 46.72, 24.72)]],
    };
    const second = await create(
      admin,
      zoneBody({ name_en: 'Two parts', source: 'official', boundary: multi }),
    ).expect(201);
    expect(createOp.responses['201'].parse(second.body).boundary).toEqual(multi);
  });

  it('refuses an invalid ring with PostGIS reason, a boundary outside the box, and the 201st zone', async () => {
    const { accountId, admin } = await adminOf();
    const bowtie = {
      type: 'Polygon',
      coordinates: [
        [
          [46.6, 24.6],
          [46.7, 24.7],
          [46.7, 24.6],
          [46.6, 24.7],
          [46.6, 24.6],
        ],
      ],
    };
    const invalid = errorOf((await create(admin, zoneBody({ boundary: bowtie })).expect(400)).body);
    expect(invalid.code).toBe('validation_failed');
    expect(invalid.details).toMatchObject({
      fields: [{ pointer: '/body/boundary', code: 'invalid' }],
    });
    expect((invalid.details as { reason?: string }).reason).toMatch(/self-intersection/i);
    const atlantic = errorOf(
      (await create(admin, zoneBody({ boundary: polygon(-30, 40, -29, 41) })).expect(400)).body,
    );
    expect(atlantic.details).toMatchObject({
      fields: [{ pointer: '/body/boundary', code: 'invalid' }],
    });
    const missing = errorOf((await create(admin, { name_en: 'x' }).expect(400)).body);
    expect(missing.details).toMatchObject({
      fields: [
        { pointer: '/body/name_ar', code: 'required' },
        { pointer: '/body/boundary', code: 'required' },
        { pointer: '/body/source', code: 'required' },
      ],
    });

    await plantZones(owner, accountId, 199);
    await create(admin, zoneBody()).expect(201);
    const over = errorOf((await create(admin, zoneBody()).expect(422)).body);
    expect(over).toMatchObject({
      code: 'limit_exceeded',
      details: { metric: 'zones', limit: 200 },
    });
  });

  it('lists without boundaries by either name and the active filter, gets with the boundary', async () => {
    const { admin } = await adminOf();
    const names = [
      ['ب', 'Alpha'],
      ['أ', 'Bravo'],
      ['ج', 'Charlie'],
    ];
    const ids: string[] = [];
    for (const [ar, en] of names) {
      ids.push(
        createOp.responses['201'].parse(
          (await create(admin, zoneBody({ name_ar: ar, name_en: en })).expect(201)).body,
        ).id,
      );
    }
    await send(admin, 'patch', `/v1/staff/zones/${ids[2]}`, { active: false }).expect(200);
    const byEnglish = await listed(admin, '?sort=name_en');
    expect(byEnglish.map((zone) => zone.name_en)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(byEnglish.every((zone) => zone.boundary === undefined)).toBe(true);
    expect((await listed(admin, '?sort=name_ar')).map((zone) => zone.name_ar)).toEqual([
      'أ',
      'ب',
      'ج',
    ]);
    expect((await listed(admin, '?active=true&sort=-name_en')).map((z) => z.name_en)).toEqual([
      'Bravo',
      'Alpha',
    ]);
    expect((await listed(admin, '?q=rav')).map((zone) => zone.name_en)).toEqual(['Bravo']);
    const page = listOp.responses['200'].parse(
      (await get(admin, '/v1/staff/zones?sort=name_en&limit=2').expect(200)).body,
    );
    expect(page.next_cursor).not.toBeNull();
    const rest = await listed(admin, `?sort=name_en&cursor=${page.next_cursor ?? ''}`);
    expect(rest.map((zone) => zone.name_en)).toEqual(['Charlie']);

    const one = operationSchemas.getZone.responses['200'].parse(
      (await get(admin, `/v1/staff/zones/${ids[0]}`).expect(200)).body,
    );
    expect(one.boundary).toEqual({
      type: 'MultiPolygon',
      coordinates: [[ring(46.66, 24.68, 46.7, 24.72)]],
    });
  });

  it('updates names and the boundary as a PATCH, audits changed keys, writes nothing for no change', async () => {
    const { admin } = await adminOf();
    const zone = createOp.responses['201'].parse(
      (await create(admin, zoneBody()).expect(201)).body,
    );
    const path = `/v1/staff/zones/${zone.id}`;
    const boundary = polygon(46.6, 24.6, 46.8, 24.8);
    const response = await send(admin, 'patch', path, { name_en: 'Olaya North', boundary }).expect(
      200,
    );
    expect(operationSchemas.updateZone.responses['200'].parse(response.body)).toMatchObject({
      name_ar: 'العليا',
      name_en: 'Olaya North',
      boundary: { type: 'MultiPolygon', coordinates: [boundary.coordinates] },
    });
    const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
    expect(audit.map((row) => row.action)).toEqual(['delivery.zone.updated']);
    expect(audit[0]?.before).toEqual({ name_en: 'Olaya', boundary: { polygons: 1, positions: 5 } });
    expect(audit[0]?.after).toEqual({
      name_en: 'Olaya North',
      boundary: { polygons: 1, positions: 5 },
    });
    const [row] = await owner<{ version: number }[]>`
      SELECT version FROM del_zones WHERE id = ${zone.id}`;
    expect(row?.version).toBe(2);
    const same = await send(admin, 'patch', path, { name_en: 'Olaya North' }).expect(200);
    expect(await auditRowsOf(owner, same.headers['x-request-id'] as string)).toEqual([]);
    await send(admin, 'patch', path, { name_ar: '' }).expect(400);
    await send(admin, 'patch', path, { boundary: polygon(10, 10, 11, 11) }).expect(400);
  });

  it('replaces a site coverage as a set, audited; refuses a warehouse and a foreign zone', async () => {
    const { accountId, admin } = await adminOf();
    const zones: string[] = [];
    for (const name of ['One', 'Two', 'Three']) {
      zones.push(
        createOp.responses['201'].parse(
          (await create(admin, zoneBody({ name_en: name })).expect(201)).body,
        ).id,
      );
    }
    const [one, two, three] = zones as [string, string, string];
    const branch = await plantSite(owner, accountId, 'branch');
    const path = `/v1/staff/sites/${branch}/coverage`;
    const first = await send(admin, 'put', path, { zone_ids: [two, one, two] }).expect(200);
    expect(operationSchemas.replaceSiteCoverage.responses['200'].parse(first.body)).toEqual({
      site_id: branch,
      zone_ids: [one, two].sort(),
    });
    const second = await send(admin, 'put', path, { zone_ids: [two, three] }).expect(200);
    const audit = await auditRowsOf(owner, second.headers['x-request-id'] as string);
    expect(audit.map((row) => row.action)).toEqual(['delivery.coverage.replaced']);
    expect(audit[0]).toMatchObject({ targetType: 'site', targetId: branch });
    expect(audit[0]?.before).toEqual({ zone_ids: [one, two].sort() });
    expect(audit[0]?.after).toEqual({ zone_ids: [two, three].sort() });

    const listed = operationSchemas.listCoverage.responses['200'].parse(
      (await get(admin, `/v1/staff/coverage?site_id=${branch}`).expect(200)).body,
    );
    const rows = (listed.data ?? []) as Coverage[];
    expect(rows.map((row) => row.zone_id).sort()).toEqual([two, three].sort());

    const warehouse = await plantSite(owner, accountId, 'warehouse');
    const kind = errorOf(
      (
        await send(admin, 'put', `/v1/staff/sites/${warehouse}/coverage`, {
          zone_ids: [one],
        }).expect(422)
      ).body,
    );
    expect(kind).toMatchObject({ code: 'site_kind_mismatch', details: { kind: 'warehouse' } });
    const inactive = await plantSite(owner, accountId, 'both', 'inactive');
    await send(admin, 'put', `/v1/staff/sites/${inactive}/coverage`, { zone_ids: [one] }).expect(
      409,
    );

    const other = await adminOf();
    const foreign = createOp.responses['201'].parse(
      (await create(other.admin, zoneBody()).expect(201)).body,
    );
    const refused = errorOf(
      (await send(admin, 'put', path, { zone_ids: [one, foreign.id] }).expect(400)).body,
    );
    expect(refused.details).toMatchObject({
      fields: [{ pointer: '/body/zone_ids/1', code: 'invalid' }],
    });
    await send(admin, 'put', `/v1/staff/sites/${uuidv7()}/coverage`, { zone_ids: [] }).expect(404);
    const cleared = await send(admin, 'put', path, { zone_ids: [] }).expect(200);
    expect(cleared.body).toEqual({ site_id: branch, zone_ids: [] });
  });

  it("hides another account's zone (404) and refuses a dispatcher the coverage write", async () => {
    const mine = await adminOf();
    const theirs = await adminOf();
    const zone = createOp.responses['201'].parse(
      (await create(theirs.admin, zoneBody()).expect(201)).body,
    );
    await get(mine.admin, `/v1/staff/zones/${zone.id}`).expect(404);
    await send(mine.admin, 'patch', `/v1/staff/zones/${zone.id}`, { active: false }).expect(404);
    expect((await listed(mine.admin, '')).map((row) => row.id)).not.toContain(zone.id);
    const dispatcher = await staff.member(mine.accountId, ['dispatcher']);
    await create(dispatcher, zoneBody()).expect(201);
    const site = await plantSite(owner, mine.accountId);
    await send(dispatcher, 'put', `/v1/staff/sites/${site}/coverage`, { zone_ids: [] }).expect(403);
  });
});
