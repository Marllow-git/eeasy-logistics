import { randomBytes } from 'node:crypto';
import type { Membership } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas, schemas } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { freshEmail, insertAccount, insertMembership, insertUser } from './identity-fixtures.js';
import { latestMail, mailpitMessage, sendMailRow } from './mail-delivery.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-12 leg 2 over HTTP with real sessions (plan 2.4, 2.7 to 2.11, 2.14): the member list paged
// by name, created_at and status with its filters and `q`; a membership with its user; invitations
// mailed through Mailpit in the account's language and accepted; the owner rule, the site checks,
// re-invitations and replays.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `members:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'members',
  TRUST_PROXY_HOPS: '1',
});

const listOp = operationSchemas.listMembers;
const inviteOp = operationSchemas.inviteMember;
const errorOf = (body: unknown) => inviteOp.responses['4XX'].parse(body);
/** A `listMembers` page through the contract: the page, then each item as a `Membership`. */
function pageOf(body: unknown): { data: Membership[]; next_cursor: string | null } {
  const page = listOp.responses['200'].parse(body);
  const items: unknown[] = page.data ?? [];
  return {
    data: items.map((item) => schemas.GetMember200Response.parse(item)),
    next_cursor: page.next_cursor,
  };
}

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

describe('the member doors over HTTP (PLAT-12 items E to G)', () => {
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
    method: 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
    key = nextKey(),
  ) => {
    const call = staff
      .http()
      [method](path)
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', key);
    return body === undefined ? call : call.send(body);
  };
  const invite = (member: SignedInMember, body: object, key?: string) =>
    send(member, 'post', '/v1/staff/members/invitations', body, key);

  async function accountWithOwner(options: { locale?: 'ar' | 'en'; name?: string } = {}) {
    const accountId = await insertAccount(owner, { name: options.name });
    await owner`
      UPDATE core_accounts SET default_locale = ${options.locale ?? 'ar'} WHERE id = ${accountId}`;
    return { accountId, owning: await staff.member(accountId, ['owner']) };
  }

  /** A user and their membership, written as the owner (no sign-in). */
  async function plantMember(
    accountId: string,
    name: string,
    options: { status?: string; roles?: string[]; siteIds?: string[]; email?: string } = {},
  ) {
    const user = await insertUser(owner, { name, email: options.email });
    const membershipId = await insertMembership(owner, accountId, user.id, {
      roles: options.roles ?? ['viewer'],
      status: options.status ?? 'active',
      siteIds: options.siteIds ?? [],
    });
    return { membershipId, userId: user.id, email: user.email };
  }

  async function plantSite(accountId: string, status = 'active'): Promise<string> {
    const id = uuidv7();
    await owner`
      INSERT INTO core_sites (id, account_id, kind, name_ar, name_en, status)
      VALUES (${id}, ${accountId}, 'branch', 'فرع', 'Branch', ${status})`;
    return id;
  }

  describe('listMembers and getMember', () => {
    it('pages three times by name with a stable order under an insert between pages', async () => {
      const { accountId, owning } = await accountWithOwner();
      for (const name of ['Delta', 'Alpha', 'Echo', 'Charlie', 'Bravo']) {
        await plantMember(accountId, name);
      }
      const names: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = `?sort=name&limit=3${cursor === null ? '' : `&cursor=${cursor}`}`;
        const page = pageOf((await get(owning, `/v1/staff/members${query}`).expect(200)).body);
        names.push(...page.data.map((member) => member.user?.name ?? ''));
        cursor = page.next_cursor;
        pages += 1;
        // Between pages: one member sorting before the cursor, one after it.
        if (pages === 1) {
          await plantMember(accountId, 'Aardvark');
          await plantMember(accountId, 'Foxtrot');
        }
      } while (cursor !== null && pages < 10);
      // The signed-in owner is a `Test User`.
      expect(names).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Test User']);
      expect(pages).toBe(3);
    });

    it('pages newest first by default and by status, every state listed', async () => {
      const { accountId, owning } = await accountWithOwner();
      const planted = [];
      for (const status of ['active', 'invited', 'revoked', 'active']) {
        planted.push((await plantMember(accountId, `M ${status}`, { status })).membershipId);
      }
      // One second apart in planting order, after the owner's (rows of one millisecond would order
      // by id, and test ids of one millisecond are not monotonic).
      await owner`
        UPDATE core_memberships
        SET created_at = now() + make_interval(secs => array_position(${planted}::uuid[], id))
        WHERE id = ANY(${planted}::uuid[])`;
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const query: string = `?limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
        const page = pageOf((await get(owning, `/v1/staff/members${query}`).expect(200)).body);
        seen.push(...page.data.map((member) => member.id));
        cursor = page.next_cursor;
      } while (cursor !== null && seen.length < 20);
      expect(seen).toEqual([...planted].reverse().concat(owning.membershipId));
      const byStatus = pageOf(
        (await get(owning, '/v1/staff/members?sort=status&limit=10').expect(200)).body,
      );
      expect(byStatus.data.map((member) => member.status)).toEqual([
        'active',
        'active',
        'active',
        'invited',
        'revoked',
      ]);
    });

    it('filters on status, site and q (escaped, over name and email) and refuses bad filters', async () => {
      const { accountId, owning } = await accountWithOwner();
      const site = await plantSite(accountId);
      const ann = await plantMember(accountId, 'Ann Site', { siteIds: [site] });
      const ivy = await plantMember(accountId, 'Ivy', { status: 'invited' });
      const rex = await plantMember(accountId, 'Rex', { status: 'revoked' });
      const percent = await plantMember(accountId, '100% Sara');
      const underscore = await plantMember(accountId, 'Ann_x');
      const zed = await plantMember(accountId, 'Zed', { email: freshEmail('zed-mail') });
      const ids = async (query: string) =>
        pageOf((await get(owning, `/v1/staff/members${query}`).expect(200)).body)
          .data.map((member) => member.id)
          .sort();
      expect(await ids('?status=invited')).toEqual([ivy.membershipId]);
      expect(await ids('?status=revoked,invited')).toEqual(
        [ivy.membershipId, rex.membershipId].sort(),
      );
      expect(await ids(`?site_id=${site}`)).toEqual([ann.membershipId]);
      expect(await ids('?q=%20ann%20')).toEqual([ann.membershipId, underscore.membershipId].sort());
      // A wildcard in q is a literal character, not a LIKE pattern.
      expect(await ids(`?q=${encodeURIComponent('%')}`)).toEqual([percent.membershipId]);
      expect(await ids('?q=_')).toEqual([underscore.membershipId]);
      expect(await ids('?q=ZED-MAIL')).toEqual([zed.membershipId]);
      expect(await ids('?q=nobody')).toEqual([]);
      for (const [query, pointer] of [
        ['?status=suspended', '/query/status'],
        ['?sort=email', '/query/sort'],
        ['?site_id=nope', '/query/site_id'],
      ] as const) {
        const refused = await get(owning, `/v1/staff/members${query}`).expect(400);
        expect(errorOf(refused.body).details?.fields).toEqual([
          expect.objectContaining({ pointer }),
        ]);
      }
      // A cursor is bound to its filters, q included.
      const first = pageOf((await get(owning, '/v1/staff/members?q=ann&limit=1').expect(200)).body);
      const rebound = await get(
        owning,
        `/v1/staff/members?q=sara&limit=1&cursor=${first.next_cursor ?? ''}`,
      ).expect(400);
      expect(errorOf(rebound.body).details?.fields).toEqual([
        expect.objectContaining({ pointer: '/query/cursor', code: 'invalid' }),
      ]);
    });

    it('presents a membership with its user, 404 for another account, and lists for a site-restricted viewer', async () => {
      const { accountId, owning } = await accountWithOwner();
      const site = await plantSite(accountId);
      const user = await insertUser(owner, {
        name: 'Huda',
        secondFactorPhone: `+9665${String(Date.now()).slice(-8)}`,
      });
      await owner`UPDATE core_users SET phone = ${`+9665${String(Date.now() + 7).slice(-8)}`} WHERE id = ${user.id}`;
      const membershipId = await insertMembership(owner, accountId, user.id, {
        roles: ['dispatcher'],
        siteIds: [site],
      });
      const response = await get(owning, `/v1/staff/members/${membershipId}`).expect(200);
      const member = operationSchemas.getMember.responses['200'].parse(response.body);
      expect(member).toMatchObject({
        id: membershipId,
        roles: ['dispatcher'],
        site_ids: [site],
        status: 'active',
        user: {
          id: user.id,
          name: 'Huda',
          email: user.email,
          phone: null,
          locale: 'en',
          second_factor_enabled: true,
        },
      });
      expect(JSON.stringify(response.body)).not.toMatch(/token_version|password|\+9665/);

      const other = await accountWithOwner();
      const foreign = await get(other.owning, `/v1/staff/members/${membershipId}`).expect(404);
      expect(errorOf(foreign.body).code).toBe('not_found');
      await get(owning, `/v1/staff/members/${uuidv7()}`).expect(404);
      const foreignList = pageOf((await get(other.owning, '/v1/staff/members').expect(200)).body);
      expect(foreignList.data.map((item) => item.id)).toEqual([other.owning.membershipId]);

      // Members are an account resource: a viewer restricted to a site sees every member (2.11).
      const viewer = await staff.member(accountId, ['viewer'], { siteIds: [site] });
      const seen = pageOf((await get(viewer, '/v1/staff/members').expect(200)).body);
      expect(seen.data).toHaveLength(3);
      const dispatcher = await staff.member(accountId, ['dispatcher']);
      expect(errorOf((await get(dispatcher, '/v1/staff/members').expect(403)).body).code).toBe(
        'forbidden',
      );
    });
  });

  describe('inviteMember', () => {
    it.each([
      ['en', 'You are invited to join'],
      ['ar', 'دعوة للانضمام إلى'],
    ] as const)(
      'invites a new person (%s): 201 invited, audited, the link mailed and accepted',
      async (locale, subject) => {
        const name = `Acme ${randomBytes(3).toString('hex')}`;
        const { accountId, owning } = await accountWithOwner({ locale, name });
        const site = await plantSite(accountId, 'inactive');
        const email = freshEmail('invitee');
        const response = await invite(owning, {
          email: email.toUpperCase(),
          name: 'Nora',
          roles: ['dispatcher', 'cashier', 'dispatcher'],
          site_ids: [site],
        }).expect(201);
        const member = inviteOp.responses['201'].parse(response.body);
        expect(member).toMatchObject({
          roles: ['dispatcher', 'cashier'],
          site_ids: [site],
          status: 'invited',
          user: { email, name: 'Nora', phone: null, locale, second_factor_enabled: false },
        });
        const [row] = await owner<{ account_id: string }[]>`
          SELECT account_id FROM core_memberships WHERE id = ${member.id}`;
        expect(row?.account_id).toBe(accountId);
        const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
        expect(audit.filter((entry) => entry.action === 'core.member.invited')).toMatchObject([
          {
            actorId: owning.userId,
            accountId,
            targetType: 'membership',
            targetId: member.id,
            before: null,
            after: { roles: ['dispatcher', 'cashier'], site_ids: [site], email },
          },
        ]);

        const mail = await latestMail(owner, email, 'invitation');
        expect(mail?.payload.locale).toBe(locale);
        expect(JSON.stringify(mail?.payload)).not.toContain('/invitations/');
        await sendMailRow(config, mail?.id ?? '');
        const delivered = await mailpitMessage(`${mail?.id ?? ''}@eeasy-logistics`);
        expect(delivered.Subject).toContain(subject);
        expect(delivered.Subject).toContain(name);
        const link = /http:\/\/localhost:3001\/invitations\/[\w-]{43}/.exec(delivered.Text)?.[0];
        expect(link).toBeDefined();
        const accepted = await staff
          .http()
          .post('/v1/staff/auth/invitations/accept')
          .set(staff.writeHeaders())
          .send({
            token: link?.split('/').at(-1),
            name: 'Nora',
            password: `fresh horse ${randomBytes(6).toString('hex')}`,
          })
          .expect(200);
        expect(accepted.body).toMatchObject({ membership: { id: member.id, status: 'active' } });
        const after = await get(owning, `/v1/staff/members/${member.id}`).expect(200);
        expect(after.body).toMatchObject({ status: 'active' });
      },
    );

    it('refuses driver, an unknown or foreign site and a bad name, writing nothing; replays a retried key', async () => {
      const { accountId, owning } = await accountWithOwner();
      const site = await plantSite(accountId);
      const foreignSite = await plantSite((await accountWithOwner()).accountId);
      const email = freshEmail('refused');
      const body = { email, name: 'Omar', roles: ['viewer'] };
      const pointersOf = async (extra: object) =>
        errorOf((await invite(owning, { ...body, ...extra }).expect(400)).body).details?.fields;
      expect(await pointersOf({ roles: ['driver'] })).toEqual([
        expect.objectContaining({ pointer: '/body/roles/0' }),
      ]);
      expect(await pointersOf({ site_ids: [site, uuidv7()] })).toEqual([
        expect.objectContaining({ pointer: '/body/site_ids/1', code: 'invalid' }),
      ]);
      expect(await pointersOf({ site_ids: [foreignSite] })).toEqual([
        expect.objectContaining({ pointer: '/body/site_ids/0', code: 'invalid' }),
      ]);
      expect(await pointersOf({ name: 'Omar\nAdmin' })).toEqual([
        expect.objectContaining({ pointer: '/body/name', code: 'invalid' }),
      ]);
      expect(await pointersOf({ name: '', account_id: uuidv7() })).toEqual([
        expect.objectContaining({ pointer: '/body/account_id', code: 'invalid' }),
      ]);
      const [none] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_invitations WHERE email = ${email}`;
      expect(none?.n).toBe(0);

      const key = nextKey();
      const first = await invite(owning, body, key).expect(201);
      const replay = await invite(owning, body, key).expect(201);
      expect(replay.body).toEqual(first.body);
      const reused = await invite(owning, { ...body, name: 'Other' }, key).expect(422);
      expect(errorOf(reused.body).code).toBe('idempotency_key_reused');
      const [once] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_invitations WHERE email = ${email}`;
      expect(once?.n).toBe(1);
    });

    it('lets only an owner grant owner; re-invites a revoked member and refuses an active one', async () => {
      const { accountId, owning } = await accountWithOwner();
      const admin = await staff.member(accountId, ['admin']);
      const email = freshEmail('owner-to-be');
      const refused = await invite(admin, { email, name: 'Sami', roles: ['owner'] }).expect(403);
      expect(errorOf(refused.body).code).toBe('forbidden');
      const granted = await invite(owning, { email, name: 'Sami', roles: ['owner'] }).expect(201);
      // Replacing a pending owner invitation removes the grant: an owner's call too.
      await invite(admin, { email, name: 'Sami', roles: ['viewer'] }).expect(403);
      const [pending] = await owner<{ roles: string[] }[]>`
        SELECT roles FROM core_memberships WHERE id = ${(granted.body as Membership).id}`;
      expect(pending?.roles).toEqual(['owner']);

      const revoked = await plantMember(accountId, 'Former', {
        status: 'revoked',
        roles: ['owner'],
      });
      const again = await invite(admin, {
        email: revoked.email,
        name: 'Former',
        roles: ['dispatcher'],
      }).expect(201);
      expect(again.body).toMatchObject({
        id: revoked.membershipId,
        status: 'invited',
        roles: ['dispatcher'],
      });
      const active = await plantMember(accountId, 'Current');
      const conflict = await invite(admin, {
        email: active.email,
        name: 'Current',
        roles: ['viewer'],
      }).expect(409);
      expect(errorOf(conflict.body)).toMatchObject({
        code: 'invalid_transition',
        details: { current_status: 'active' },
      });
      const dispatcher = await staff.member(accountId, ['dispatcher']);
      const forbidden = await invite(dispatcher, {
        email: freshEmail(),
        name: 'X',
        roles: ['viewer'],
      }).expect(403);
      expect(errorOf(forbidden.body).code).toBe('forbidden');
    });
  });
});
