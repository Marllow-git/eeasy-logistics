import { randomBytes } from 'node:crypto';
import { operationSchemas as platformOps } from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import type { RequestContext } from '@eeasy-logistics/db';
import { createAppPool, uuidv7, withUnitOfWork } from '@eeasy-logistics/db';
import { transactionOf } from '@eeasy-logistics/db/testing';
import { sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoverageQuery, outsideCoverage } from '../../src/modules/delivery/public/index.js';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { insertAccount } from './identity-fixtures.js';
import type { SignedInPlatformStaff } from './platform-sessions.js';
import { platformStaff, platformWriteHeaders } from './platform-sessions.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';
import { plantSite, polygon } from './zone-fixtures.js';

// DEL-1 item C over HTTP (plan 2.5, 2.6): the coverage check by point (inside, on the boundary,
// outside, one site's coverage, the smaller of two overlapping zones, an inactive zone ignored) and
// by address through the stub geocoder; `CoverageQuery` inside a caller's transaction; the
// provisioning trio as a platform admin (site, zones, coverage, the door row with and without a
// reason), `409` on a closed account, and the owner's dispatcher then checking the coverage.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `coverage:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'coverage',
  TRUST_PROXY_HOPS: '1',
  GEOCODER_SOURCES: 'stub',
});

const checkOp = operationSchemas.checkCoverage;
const zoneOp = operationSchemas.createZone;
const errorOf = (body: unknown) => checkOp.responses['4XX'].parse(body);

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

/** Al Olaya in the geocoder fixture (short code REMA7572): 24.695, 46.685. */
const olaya = { lat: 24.695, lng: 46.685 };

describe('the coverage check, the port and the provisioning doors (DEL-1 item C)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  let admin: SignedInPlatformStaff;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
    admin = await platformStaff(staff.app, config, owner, 'admin');
  });

  afterAll(async () => {
    await staff?.close();
    await owner?.end();
  });

  const write = (member: SignedInMember, method: 'post' | 'patch' | 'put', path: string) =>
    staff
      .http()
      [method](path)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', nextKey());
  const zone = async (member: SignedInMember, name: string, boundary: object) =>
    zoneOp.responses['201'].parse(
      (
        await write(member, 'post', '/v1/staff/zones')
          .send({ name_ar: name, name_en: name, source: 'drawn', boundary })
          .expect(201)
      ).body,
    ).id;
  const cover = (member: SignedInMember, siteId: string, zoneIds: string[]) =>
    write(member, 'put', `/v1/staff/sites/${siteId}/coverage`)
      .send({ zone_ids: zoneIds })
      .expect(200);
  const check = async (member: SignedInMember, body: object) =>
    checkOp.responses['200'].parse(
      (
        await staff
          .http()
          .post('/v1/staff/coverage/check')
          .set(staff.writeHeaders())
          .set('Cookie', member.cookie)
          .send(body)
          .expect(200)
      ).body,
    );

  it('answers by point: inside, on the boundary, outside, per site, smallest overlap, active only', async () => {
    const accountId = await insertAccount(owner);
    const admin = await staff.member(accountId, ['admin']);
    const big = await zone(admin, 'Big', polygon(46.6, 24.6, 46.8, 24.8));
    const small = await zone(admin, 'Small', polygon(46.66, 24.68, 46.7, 24.72));
    const north = await plantSite(owner, accountId, 'branch');
    const south = await plantSite(owner, accountId, 'both');
    await cover(admin, north, [big]);
    await cover(admin, south, [small]);

    expect(await check(admin, { point: olaya })).toEqual({
      covered: true,
      zone_id: small,
      site_ids: [north, south].sort(),
      point: olaya,
    });
    // `point` wins over an address that is elsewhere.
    expect(
      (await check(admin, { point: olaya, address: { text: 'Al Rawdah', city: 'Jeddah' } }))
        .zone_id,
    ).toBe(small);
    expect(await check(admin, { point: { lat: 24.75, lng: 46.75 } })).toMatchObject({
      covered: true,
      zone_id: big,
      site_ids: [north],
    });
    // A point on the boundary is covered (ST_Covers, D-3).
    expect((await check(admin, { point: { lat: 24.6, lng: 46.7 } })).zone_id).toBe(big);
    expect(await check(admin, { point: { lat: 21.5, lng: 39.2 } })).toEqual({
      covered: false,
      zone_id: null,
      site_ids: [],
      point: { lat: 21.5, lng: 39.2 },
    });
    expect(await check(admin, { point: olaya, site_id: north })).toMatchObject({
      zone_id: big,
      site_ids: [north],
    });
    await write(admin, 'patch', `/v1/staff/zones/${small}`).send({ active: false }).expect(200);
    expect(await check(admin, { point: olaya })).toMatchObject({ zone_id: big, site_ids: [north] });
    const [rows] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM del_coverage WHERE zone_id = ${small}`;
    expect(rows?.n).toBe(1);

    const viewer = await staff.member(accountId, ['viewer']);
    expect((await check(viewer, { point: olaya })).covered).toBe(true);
    const none = errorOf(
      (
        await staff
          .http()
          .post('/v1/staff/coverage/check')
          .set(staff.writeHeaders())
          .set('Cookie', admin.cookie)
          .send({})
          .expect(400)
      ).body,
    );
    expect(none.details).toMatchObject({ fields: [{ pointer: '/body/point', code: 'required' }] });
  });

  it('answers by address through the geocoder: short code first, then text; unknown is not covered', async () => {
    const accountId = await insertAccount(owner);
    const admin = await staff.member(accountId, ['admin']);
    const olayaZone = await zone(admin, 'Olaya', polygon(46.66, 24.68, 46.7, 24.72));
    const branch = await plantSite(owner, accountId);
    await cover(admin, branch, [olayaZone]);
    expect(
      await check(admin, {
        address: { text: 'nowhere', city: 'Riyadh', national_address_short_code: 'REMA7572' },
      }),
    ).toEqual({ covered: true, zone_id: olayaZone, site_ids: [branch], point: olaya });
    expect(await check(admin, { address: { text: 'Al Olaya', city: 'Riyadh' } })).toMatchObject({
      covered: true,
      zone_id: olayaZone,
    });
    expect(
      await check(admin, { address: { text: 'Planet Mars district', city: 'Nowhere' } }),
    ).toEqual({ covered: false, zone_id: null, site_ids: [] });
  });

  it('answers through CoverageQuery inside the caller transaction, with the typed reason', async () => {
    const accountId = await insertAccount(owner);
    const siteId = await plantSite(owner, accountId);
    const pool = createAppPool(config.db, 'elx-coverage-port-test');
    const context: RequestContext = {
      accountId,
      membershipId: null,
      userId: null,
      deviceId: null,
      actingCrossTenant: false,
    };
    try {
      const answers = await withUnitOfWork(pool.db, context, async (uow) => {
        const query = new CoverageQuery();
        const before = await query.coverage(olaya, { uow });
        const zoneId = uuidv7();
        // Written in this transaction only: the port must see it (same unit of work).
        await transactionOf(uow).execute(sql`
          INSERT INTO del_zones (id, account_id, name_ar, name_en, boundary, source)
          VALUES (${zoneId}, ${accountId}, 'م', 'Z',
                  ST_GeomFromText('MULTIPOLYGON(((46.6 24.6, 46.8 24.6, 46.8 24.8, 46.6 24.8, 46.6 24.6)))', 4326),
                  'drawn')`);
        await transactionOf(uow).execute(sql`
          INSERT INTO del_coverage (id, account_id, site_id, zone_id)
          VALUES (${uuidv7()}, ${accountId}, ${siteId}, ${zoneId})`);
        const after = await query.coverage(olaya, { uow, siteId });
        throw Object.assign(new Error('rollback'), { answers: { before, after, zoneId } });
      }).catch((error: { answers?: unknown }) => error.answers);
      expect(answers).toMatchObject({
        before: { zoneId: null, siteIds: [] },
        after: { siteIds: [siteId] },
      });
      const { after, zoneId } = answers as { after: { zoneId: string }; zoneId: string };
      expect(after.zoneId).toBe(zoneId);
    } finally {
      await pool.close();
    }
    expect(outsideCoverage).toBe('outside_coverage');
  });

  describe('the provisioning trio', () => {
    const platformWrite = (method: 'post' | 'put', path: string, reason?: string) => {
      const call = staff
        .http()
        [method](path)
        .set(platformWriteHeaders(config))
        .set('Cookie', admin.cookie)
        .set('Idempotency-Key', nextKey());
      return reason === undefined ? call : call.set('X-Support-Reason', reason);
    };

    it('provisions a site, two zones and the coverage; the dispatcher then checks it', async () => {
      const accountId = await insertAccount(owner, { status: 'provisioned' });
      const site = await platformWrite('post', `/v1/platform/accounts/${accountId}/sites`, 'setup')
        .send({ kind: 'branch', name_ar: 'فرع العليا', name_en: 'Olaya branch' })
        .expect(201);
      const siteId = platformOps.platformProvisionSite.responses['201'].parse(site.body).id;
      const siteAudit = await auditRowsOf(owner, site.headers['x-request-id'] as string);
      expect(siteAudit.map((row) => [row.action, row.actorType, row.reason])).toEqual([
        ['core.site.created', 'platform_user', null],
        ['platform.cross_tenant.accessed', 'platform_user', 'setup'],
      ]);
      expect(siteAudit[0]).toMatchObject({ accountId, actorId: admin.userId, targetId: siteId });

      const zoneIds: string[] = [];
      for (const [name, box] of [
        ['Olaya', polygon(46.66, 24.68, 46.7, 24.72)],
        ['Riyadh', polygon(46.6, 24.6, 46.8, 24.8)],
      ] as const) {
        const response = await platformWrite('post', `/v1/platform/accounts/${accountId}/zones`)
          .send({ name_ar: name, name_en: name, source: 'official', boundary: box })
          .expect(201);
        zoneIds.push(platformOps.platformProvisionZone.responses['201'].parse(response.body).id);
        const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
        expect(audit.map((row) => [row.action, row.actorType, row.reason])).toEqual([
          ['delivery.zone.created', 'platform_user', null],
          ['platform.cross_tenant.accessed', 'platform_user', null],
        ]);
      }
      const [olayaZone, riyadhZone] = zoneIds as [string, string];
      const coverage = await platformWrite('put', `/v1/platform/accounts/${accountId}/coverage`)
        .send({ entries: [{ site_id: siteId, zone_ids: [olayaZone, riyadhZone, olayaZone] }] })
        .expect(200);
      const list = platformOps.platformProvisionCoverage.responses['200'].parse(coverage.body);
      expect((list.data ?? []).map((row) => [row.site_id, row.zone_id]).sort()).toEqual(
        [
          [siteId, olayaZone],
          [siteId, riyadhZone],
        ].sort(),
      );
      const audit = await auditRowsOf(owner, coverage.headers['x-request-id'] as string);
      expect(audit.map((row) => row.action)).toEqual([
        'delivery.coverage.replaced',
        'platform.cross_tenant.accessed',
      ]);
      expect(audit[0]?.after).toEqual({ zone_ids: [olayaZone, riyadhZone].sort() });

      // Every site and zone must be the account's (404, the contract), a warehouse is 422.
      const other = await insertAccount(owner);
      const foreignSite = await plantSite(owner, other);
      await platformWrite('put', `/v1/platform/accounts/${accountId}/coverage`)
        .send({ entries: [{ site_id: foreignSite, zone_ids: [] }] })
        .expect(404);
      await platformWrite('put', `/v1/platform/accounts/${accountId}/coverage`)
        .send({ entries: [{ site_id: siteId, zone_ids: [uuidv7()] }] })
        .expect(404);
      const warehouse = await plantSite(owner, accountId, 'warehouse');
      await platformWrite('put', `/v1/platform/accounts/${accountId}/coverage`)
        .send({ entries: [{ site_id: warehouse, zone_ids: [olayaZone] }] })
        .expect(422);

      const dispatcher = await staff.member(accountId, ['dispatcher']);
      expect(await check(dispatcher, { point: olaya })).toEqual({
        covered: true,
        zone_id: olayaZone,
        site_ids: [siteId],
        point: olaya,
      });
    });

    it('answers 409 invalid_transition on a closed account and 404 on an unknown one', async () => {
      const closed = await insertAccount(owner, { status: 'closed' });
      const response = await platformWrite('post', `/v1/platform/accounts/${closed}/zones`)
        .send({
          name_ar: 'م',
          name_en: 'Z',
          source: 'drawn',
          boundary: polygon(46.6, 24.6, 46.7, 24.7),
        })
        .expect(409);
      expect(errorOf(response.body)).toMatchObject({
        code: 'invalid_transition',
        details: { current_status: 'closed' },
      });
      await platformWrite('post', `/v1/platform/accounts/${closed}/sites`)
        .send({ kind: 'branch', name_ar: 'فرع', name_en: 'Branch' })
        .expect(409);
      await platformWrite('put', `/v1/platform/accounts/${closed}/coverage`)
        .send({ entries: [] })
        .expect(409);
      await platformWrite('post', `/v1/platform/accounts/${uuidv7()}/sites`)
        .send({ kind: 'branch', name_ar: 'فرع', name_en: 'Branch' })
        .expect(404);
    });
  });
});
