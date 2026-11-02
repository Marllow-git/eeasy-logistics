import { randomBytes } from 'node:crypto';
import type { Site } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas, schemas } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SiteUseChecks } from '../../src/modules/kernel/sites/site-use.js';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { insertAccount } from './identity-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-12 item C over HTTP with real sessions (plan 2.4, 2.5, 2.6, 2.14): sites created up to the
// limit (also concurrently) then 422; the whole-site update with its audit row and outbox event;
// a kind change and a deactivation refused by a registered in-use check; the status transitions;
// a site-scoped principal's 404 and filtered list; a foreign id's 404; cursor pages that stay
// stable under an insert between pages; the filters and sorts; idempotent replays.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `sites:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'sites',
  TRUST_PROXY_HOPS: '1',
});

const listOp = operationSchemas.listSites;
const createOp = operationSchemas.createSite;
const updateOp = operationSchemas.updateSite;
const errorOf = (body: unknown) => createOp.responses['4XX'].parse(body);
/** A `listSites` page through the contract: the page, then each item as a `Site`. */
function pageOf(body: unknown): { data: Site[]; next_cursor: string | null } {
  const page = listOp.responses['200'].parse(body);
  const items: unknown[] = page.data ?? [];
  return {
    data: items.map((item) => schemas.GetSite200Response.parse(item)),
    next_cursor: page.next_cursor,
  };
}

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

const olaya = {
  kind: 'branch',
  name_ar: 'فرع العليا',
  name_en: 'Olaya branch',
  address_text: 'Olaya St, Riyadh',
  national_address_short_code: 'rrrd2929',
  point: { lat: 24.7136, lng: 46.6753 },
  opening_hours: [{ weekday: 0, opens: '08:00', closes: '22:00' }],
};

describe('the site doors over HTTP (PLAT-12 item C)', () => {
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
    method: 'post' | 'patch',
    path: string,
    body: object = {},
    key = nextKey(),
  ) =>
    staff
      .http()
      [method](path)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', key)
      .send(body);
  const create = (member: SignedInMember, body: object = olaya, key?: string) =>
    send(member, 'post', '/v1/staff/sites', body, key);

  async function accountWithOwner(limits: Record<string, number> = {}) {
    const accountId = await insertAccount(owner);
    await owner`UPDATE core_accounts SET limits = ${owner.json(limits)} WHERE id = ${accountId}`;
    return { accountId, owning: await staff.member(accountId, ['owner']) };
  }

  async function plantSite(accountId: string, nameEn: string, status = 'active'): Promise<string> {
    const id = uuidv7();
    await owner`
      INSERT INTO core_sites (id, account_id, kind, name_ar, name_en, status)
      VALUES (${id}, ${accountId}, 'branch', ${`فرع ${nameEn}`}, ${nameEn}, ${status})`;
    return id;
  }

  describe('createSite', () => {
    it('creates a site as the contract presents it, audited, until the limit answers 422', async () => {
      const { accountId, owning } = await accountWithOwner({ sites: 2 });
      const first = await create(owning).expect(201);
      const site = createOp.responses['201'].parse(first.body);
      expect(site).toMatchObject({
        kind: 'branch',
        name_ar: 'فرع العليا',
        national_address_short_code: 'RRRD2929',
        point: { lat: 24.7136, lng: 46.6753 },
        opening_hours: [{ weekday: 0, opens: '08:00', closes: '22:00' }],
        status: 'active',
      });
      const [row] = await owner<{ srid: number; lng: number; lat: number; account_id: string }[]>`
        SELECT ST_SRID(point) AS srid, ST_X(point) AS lng, ST_Y(point) AS lat, account_id
        FROM core_sites WHERE id = ${site.id}`;
      expect(row).toEqual({ srid: 4326, lng: 46.6753, lat: 24.7136, account_id: accountId });
      const [audit, ...more] = await auditRowsOf(owner, first.headers['x-request-id'] ?? '');
      expect(more).toEqual([]);
      expect(audit).toMatchObject({
        actorId: owning.userId,
        accountId,
        targetType: 'site',
        targetId: site.id,
        action: 'core.site.created',
        before: null,
        after: {
          kind: 'branch',
          name_en: 'Olaya branch',
          point: { lat: 24.7136, lng: 46.6753 },
        },
      });

      await create(owning, { kind: 'warehouse', name_ar: 'مستودع', name_en: 'Depot' }).expect(201);
      const refused = await create(owning, { ...olaya, name_en: 'Third' }).expect(422);
      expect(errorOf(refused.body)).toMatchObject({
        code: 'limit_exceeded',
        details: { metric: 'sites', limit: 2 },
      });
      const [count] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_sites WHERE account_id = ${accountId}`;
      expect(count?.n).toBe(2);
    });

    it('holds the limit under concurrent creates', async () => {
      const { accountId, owning } = await accountWithOwner({ sites: 3 });
      const answers = await Promise.all(
        Array.from({ length: 6 }, (_, index) => create(owning, { ...olaya, name_en: `C${index}` })),
      );
      expect(answers.map((answer) => answer.status).sort()).toEqual([201, 201, 201, 422, 422, 422]);
      const [count] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_sites WHERE account_id = ${accountId}`;
      expect(count?.n).toBe(3);
    });

    it('replays a retried key without a second site and refuses read-only and foreign fields', async () => {
      const { accountId, owning } = await accountWithOwner();
      const key = nextKey();
      const first = await create(owning, olaya, key).expect(201);
      const replay = await create(owning, olaya, key).expect(201);
      expect(replay.body).toEqual(first.body);
      for (const extra of [
        { id: uuidv7() },
        { created_at: '2026-11-02T10:00:00Z' },
        { status: 'inactive' },
        { account_id: uuidv7() },
      ]) {
        const refused = await create(owning, { ...olaya, ...extra }).expect(400);
        expect(errorOf(refused.body).details?.fields).toEqual([
          expect.objectContaining({ pointer: `/body/${Object.keys(extra)[0]}`, code: 'invalid' }),
        ]);
      }
      const bad = await create(owning, {
        ...olaya,
        name_ar: '',
        national_address_short_code: 'RRRD-29',
        opening_hours: [{ weekday: 1, opens: '25:00', closes: '22:00' }],
      }).expect(400);
      expect(errorOf(bad.body).details?.fields).toEqual([
        expect.objectContaining({ pointer: '/body/name_ar', code: 'too_short' }),
        expect.objectContaining({ pointer: '/body/national_address_short_code', code: 'invalid' }),
        expect.objectContaining({ pointer: '/body/opening_hours/0/opens', code: 'invalid' }),
      ]);
      const [count] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_sites WHERE account_id = ${accountId}`;
      expect(count?.n).toBe(1);
    });

    it('answers 403 to a role without core.sites.manage', async () => {
      const { accountId } = await accountWithOwner();
      const dispatcher = await staff.member(accountId, ['dispatcher']);
      expect(errorOf((await create(dispatcher).expect(403)).body).code).toBe('forbidden');
    });
  });

  describe('updateSite', () => {
    it('writes the whole site, clears what the body leaves out, audits the changes and publishes', async () => {
      const { accountId, owning } = await accountWithOwner();
      const site = createOp.responses['201'].parse((await create(owning).expect(201)).body);
      const response = await send(owning, 'patch', `/v1/staff/sites/${site.id}`, {
        kind: 'both',
        name_ar: 'فرع العليا',
        name_en: 'Olaya hub',
      }).expect(200);
      const updated = updateOp.responses['200'].parse(response.body);
      expect(updated).toMatchObject({ kind: 'both', name_en: 'Olaya hub', opening_hours: [] });
      expect(response.body).not.toHaveProperty('point');
      expect(response.body).not.toHaveProperty('address_text');
      const [row] = await owner<{ version: number; point: string | null }[]>`
        SELECT version, point FROM core_sites WHERE id = ${site.id}`;
      expect(row).toEqual({ version: 2, point: null });
      const [audit] = await auditRowsOf(owner, response.headers['x-request-id'] ?? '');
      expect(audit).toMatchObject({
        action: 'core.site.updated',
        targetId: site.id,
        before: {
          kind: 'branch',
          name_en: 'Olaya branch',
          address_text: 'Olaya St, Riyadh',
          national_address_short_code: 'RRRD2929',
          point: { lat: 24.7136, lng: 46.6753 },
          opening_hours: [{ weekday: 0, opens: '08:00', closes: '22:00' }],
        },
        after: {
          kind: 'both',
          name_en: 'Olaya hub',
          address_text: null,
          national_address_short_code: null,
          point: null,
          opening_hours: [],
        },
      });
      const events = await owner<
        { type: string; kind: string; sequence: number; payload: unknown; account_id: string }[]
      >`
        SELECT type, kind, sequence, payload, account_id FROM core_outbox
        WHERE aggregate_type = 'site' AND aggregate_id = ${site.id}`;
      expect(events.map((event) => ({ ...event }))).toEqual([
        {
          type: 'core.site.updated',
          kind: 'internal_event',
          sequence: 2,
          payload: { site_id: site.id, kind: 'both', point: null },
          account_id: accountId,
        },
      ]);
      // The same body again changes nothing and writes nothing.
      const again = await send(owning, 'patch', `/v1/staff/sites/${site.id}`, {
        kind: 'both',
        name_ar: 'فرع العليا',
        name_en: 'Olaya hub',
      }).expect(200);
      expect(await auditRowsOf(owner, again.headers['x-request-id'] ?? '')).toEqual([]);
    });

    it('refuses a kind change and a deactivation a registered in-use check holds (409 site_in_use)', async () => {
      const { owning } = await accountWithOwner();
      const site = createOp.responses['201'].parse(
        (await create(owning, { ...olaya, kind: 'both' }).expect(201)).body,
      );
      staff.app
        .get(SiteUseChecks, { strict: false })
        .register('warehouse', (siteId) =>
          Promise.resolve(siteId === site.id ? 'stock_on_hand' : undefined),
        );
      const toBranch = await send(owning, 'patch', `/v1/staff/sites/${site.id}`, {
        ...olaya,
        kind: 'branch',
      }).expect(409);
      expect(errorOf(toBranch.body)).toMatchObject({
        code: 'site_in_use',
        details: { reasons: ['stock_on_hand'] },
      });
      // Dropping nothing the check protects passes: both → warehouse keeps the warehouse role.
      await send(owning, 'patch', `/v1/staff/sites/${site.id}`, {
        ...olaya,
        kind: 'warehouse',
      }).expect(200);
      const deactivate = await send(owning, 'post', `/v1/staff/sites/${site.id}/deactivate`).expect(
        409,
      );
      expect(errorOf(deactivate.body).code).toBe('site_in_use');
      const [row] = await owner<{ kind: string; status: string }[]>`
        SELECT kind, status FROM core_sites WHERE id = ${site.id}`;
      expect(row).toEqual({ kind: 'warehouse', status: 'active' });
    });
  });

  describe('deactivateSite and activateSite', () => {
    it('moves active ⇄ inactive with invalid_transition on a repeat, audited, within the limit', async () => {
      const { accountId, owning } = await accountWithOwner({ sites: 1 });
      const site = createOp.responses['201'].parse((await create(owning).expect(201)).body);
      const off = await send(owning, 'post', `/v1/staff/sites/${site.id}/deactivate`).expect(200);
      expect(off.body).toMatchObject({ status: 'inactive' });
      const [audit] = await auditRowsOf(owner, off.headers['x-request-id'] ?? '');
      expect(audit).toMatchObject({
        action: 'core.site.deactivated',
        before: { status: 'active' },
        after: { status: 'inactive' },
      });
      const again = await send(owning, 'post', `/v1/staff/sites/${site.id}/deactivate`).expect(409);
      expect(errorOf(again.body)).toMatchObject({
        code: 'invalid_transition',
        details: { current_status: 'inactive', version: 2 },
      });
      // The freed slot takes a new site; activating the old one would pass the limit.
      await create(owning, { ...olaya, name_en: 'Replacement' }).expect(201);
      const over = await send(owning, 'post', `/v1/staff/sites/${site.id}/activate`).expect(422);
      expect(errorOf(over.body).code).toBe('limit_exceeded');
      await owner`UPDATE core_accounts SET limits = '{"sites": 2}'::jsonb WHERE id = ${accountId}`;
      const on = await send(owning, 'post', `/v1/staff/sites/${site.id}/activate`).expect(200);
      expect(on.body).toMatchObject({ status: 'active' });
      const [activated] = await auditRowsOf(owner, on.headers['x-request-id'] ?? '');
      expect(activated?.action).toBe('core.site.activated');
      const repeat = await send(owning, 'post', `/v1/staff/sites/${site.id}/activate`).expect(409);
      expect(errorOf(repeat.body).details).toMatchObject({ current_status: 'active' });
    });
  });

  describe('scoping', () => {
    it('answers 404 for another account and outside a site-scoped principal’s sites, and filters its list', async () => {
      const { accountId, owning } = await accountWithOwner();
      const mine = await plantSite(accountId, 'Mine');
      const other = await plantSite(accountId, 'Other');
      const foreign = await plantSite((await accountWithOwner()).accountId, 'Foreign');
      await get(owning, `/v1/staff/sites/${foreign}`).expect(404);
      await send(owning, 'post', `/v1/staff/sites/${foreign}/deactivate`).expect(404);
      const siteStaff = await staff.member(accountId, ['site_staff'], { siteIds: [mine] });
      await get(siteStaff, `/v1/staff/sites/${mine}`).expect(200);
      const hidden = await get(siteStaff, `/v1/staff/sites/${other}`).expect(404);
      expect(errorOf(hidden.body).code).toBe('not_found');
      const list = pageOf((await get(siteStaff, '/v1/staff/sites').expect(200)).body);
      expect(list.data.map((site) => site.id)).toEqual([mine]);
      const all = pageOf((await get(owning, '/v1/staff/sites').expect(200)).body);
      expect(all.data.map((site) => site.id).sort()).toEqual([mine, other].sort());
    });
  });

  describe('listSites', () => {
    it('pages three times by name with a stable order under an insert between pages', async () => {
      const { accountId, owning } = await accountWithOwner();
      for (const name of ['Delta', 'Alpha', 'Echo', 'Charlie', 'Bravo']) {
        await plantSite(accountId, name);
      }
      const names: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = `?sort=name_en&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
        const page = pageOf((await get(owning, `/v1/staff/sites${query}`).expect(200)).body);
        names.push(...page.data.map((site) => site.name_en));
        cursor = page.next_cursor;
        pages += 1;
        // Between pages: one site sorting before the cursor, one after it.
        if (pages === 1) {
          await plantSite(accountId, 'Aardvark');
          await plantSite(accountId, 'Foxtrot');
        }
      } while (cursor !== null && pages < 10);
      expect(names).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot']);
      expect(pages).toBe(3);
    });

    it('pages newest first by default across sites created in one millisecond', async () => {
      const { accountId, owning } = await accountWithOwner();
      const ids = [];
      for (let index = 0; index < 5; index += 1) ids.push(await plantSite(accountId, `S${index}`));
      // All five in one millisecond (one statement, one now()), their microseconds against the
      // planting order: the cursor carries milliseconds (the row's Date), so the order is the
      // millisecond, then the id.
      await owner`
        UPDATE core_sites
        SET created_at = date_trunc('milliseconds', now())
          + make_interval(secs => (6 - array_position(${ids}::uuid[], id)) * 100 / 1e6)
        WHERE account_id = ${accountId}`;
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string = `?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
        const page = pageOf((await get(owning, `/v1/staff/sites${query}`).expect(200)).body);
        seen.push(...page.data.map((site) => site.id));
        cursor = page.next_cursor;
      } while (cursor !== null && seen.length < 20);
      expect(seen).toEqual([...ids].sort().reverse());
    });

    it('filters on status and kind and refuses an unknown status, sort or rebound cursor', async () => {
      const { accountId, owning } = await accountWithOwner();
      const active = await plantSite(accountId, 'Open');
      const inactive = await plantSite(accountId, 'Closed', 'inactive');
      const ids = async (query: string) =>
        pageOf((await get(owning, `/v1/staff/sites${query}`).expect(200)).body).data.map(
          (site) => site.id,
        );
      expect(await ids('?status=inactive')).toEqual([inactive]);
      expect((await ids('?status=active,inactive'))?.sort()).toEqual([active, inactive].sort());
      expect(await ids('?kind=warehouse')).toEqual([]);
      for (const [query, pointer] of [
        ['?status=closed', '/query/status'],
        ['?status=', '/query/status'],
        ['?sort=-updated_at', '/query/sort'],
        ['?kind=depot', '/query/kind'],
      ] as const) {
        const refused = await get(owning, `/v1/staff/sites${query}`).expect(400);
        expect(errorOf(refused.body).details?.fields).toEqual([
          expect.objectContaining({ pointer, code: 'invalid' }),
        ]);
      }
      const first = pageOf((await get(owning, '/v1/staff/sites?limit=1').expect(200)).body);
      const rebound = await get(
        owning,
        `/v1/staff/sites?limit=1&status=active&cursor=${first.next_cursor ?? ''}`,
      ).expect(400);
      expect(errorOf(rebound.body).details?.fields).toEqual([
        expect.objectContaining({ pointer: '/query/cursor', code: 'invalid' }),
      ]);
    });
  });
});
