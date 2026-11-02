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
    it('shows an invited membership of a known user with the invitation’s fields only (adversary M-2)', async () => {
      // A user who belongs to another account, with a stored name, locale and enrolled factor: none
      // of it may reach this account while the membership is only invited (or revoked).
      const { owning } = await accountWithOwner({ locale: 'ar' });
      const elsewhere = await accountWithOwner();
      const known = await insertUser(owner, {
        name: 'Stored Elsewhere',
        locale: 'en',
        secondFactorPhone: `+9665${String(randomBytes(4).readUInt32BE(0) % 1e8).padStart(8, '0')}`,
      });
      await insertMembership(owner, elsewhere.accountId, known.id, { roles: ['viewer'] });
      const response = await invite(owning, {
        email: known.email,
        name: 'Invited Name',
        roles: ['viewer'],
      }).expect(201);
      const member = inviteOp.responses['201'].parse(response.body);
      const invitedUser = {
        id: known.id,
        name: 'Invited Name',
        email: known.email,
        phone: null,
        locale: 'ar',
        second_factor_enabled: false,
        created_at: member.created_at,
        updated_at: member.updated_at,
      };
      expect(member.user).toEqual(invitedUser);
      const read = await get(owning, `/v1/staff/members/${member.id}`).expect(200);
      expect(operationSchemas.getMember.responses['200'].parse(read.body).user).toEqual(
        invitedUser,
      );
      const listed = pageOf((await get(owning, '/v1/staff/members').expect(200)).body);
      expect(listed.data.find((item) => item.id === member.id)?.user).toEqual(invitedUser);
      // `q` and the name sort see the invitation's name, never the stored one.
      const ids = async (query: string) =>
        pageOf((await get(owning, `/v1/staff/members${query}`).expect(200)).body).data.map(
          (item) => item.id,
        );
      expect(await ids('?q=Stored')).toEqual([]);
      expect(await ids('?q=invited%20name')).toEqual([member.id]);
      for (const body of [response.body, read.body, listed]) {
        expect(JSON.stringify(body)).not.toContain('Stored Elsewhere');
      }

      // Revoked before acceptance: still the invitation's fields.
      await revoke(owning, member.id).expect(204);
      const revoked = await get(owning, `/v1/staff/members/${member.id}`).expect(200);
      expect(revoked.body).toMatchObject({
        status: 'revoked',
        user: { name: 'Invited Name', locale: 'ar', second_factor_enabled: false },
      });
      expect(JSON.stringify(revoked.body)).not.toContain('Stored Elsewhere');
    });

    it('keeps a driver role on a re-invitation and checks the combination (adversary L-2)', async () => {
      const { accountId, owning } = await accountWithOwner();
      const driver = await plantMember(accountId, 'Driver', {
        status: 'revoked',
        roles: ['driver'],
      });
      const again = await invite(owning, {
        email: driver.email,
        name: 'Driver',
        roles: ['viewer'],
      }).expect(201);
      expect(again.body).toMatchObject({
        id: driver.membershipId,
        status: 'invited',
        roles: ['viewer', 'driver'],
      });
      const cash = await invite(owning, {
        email: driver.email,
        name: 'Driver',
        roles: ['cashier'],
      }).expect(422);
      expect(errorOf(cash.body).code).toBe('role_combination_forbidden');
      expect(await rolesOf(driver.membershipId)).toEqual({
        roles: ['viewer', 'driver'],
        status: 'invited',
      });
    });
  });

  const update = (member: SignedInMember, membershipId: string, body: object) =>
    send(member, 'patch', `/v1/staff/members/${membershipId}`, body);
  const revoke = (member: SignedInMember, membershipId: string) =>
    send(member, 'delete', `/v1/staff/members/${membershipId}`);
  const refresh = (member: SignedInMember) =>
    staff
      .http()
      .post('/v1/staff/auth/refresh')
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie);
  const rolesOf = async (membershipId: string) => {
    const [row] = await owner<{ roles: string[]; status: string }[]>`
      SELECT roles, status FROM core_memberships WHERE id = ${membershipId}`;
    return row;
  };

  describe('updateMember', () => {
    it('changes roles and sites, audited; the sessions of that membership end and a new sign-in carries the new roles', async () => {
      const { accountId, owning } = await accountWithOwner();
      const site = await plantSite(accountId);
      const member = await staff.member(accountId, ['dispatcher']);
      const response = await update(owning, member.membershipId, {
        roles: ['viewer'],
        site_ids: [site, site],
      }).expect(200);
      expect(operationSchemas.updateMember.responses['200'].parse(response.body)).toMatchObject({
        id: member.membershipId,
        roles: ['viewer'],
        site_ids: [site],
        status: 'active',
        user: { email: member.email, phone: null },
      });
      const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
      expect(audit).toMatchObject([
        {
          actorId: owning.userId,
          accountId,
          targetType: 'membership',
          targetId: member.membershipId,
          action: 'core.member.updated',
          before: { roles: ['dispatcher'], site_ids: [] },
          after: { roles: ['viewer'], site_ids: [site] },
        },
      ]);
      const families = await owner<{ reason: string | null }[]>`
        SELECT revoked_reason AS reason FROM core_refresh_tokens
        WHERE membership_id = ${member.membershipId}`;
      expect(families.map((family) => family.reason)).toEqual(['revoked']);
      expect(errorOf((await refresh(member).expect(401)).body).code).toBe('token_invalid');
      const again = await staff.login(member.email);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({
        me: { membership: { roles: ['viewer'], site_ids: [site] } },
      });
      // The caller's own session is untouched.
      await get(owning, '/v1/staff/members').expect(200);

      // A body that changes nothing writes nothing; an absent field keeps its value.
      const same = await update(owning, member.membershipId, { roles: ['viewer'] }).expect(200);
      expect(await auditRowsOf(owner, String(same.headers['x-request-id']))).toEqual([]);
      const sites = await update(owning, member.membershipId, { site_ids: [] }).expect(200);
      expect(sites.body).toMatchObject({ roles: ['viewer'], site_ids: [] });
      expect(await auditRowsOf(owner, String(sites.headers['x-request-id']))).toMatchObject([
        { before: { site_ids: [site] }, after: { site_ids: [] } },
      ]);
    });

    it('refuses the caller’s own membership, owner changes by an admin, a revoked one, an unknown site and driver with cash', async () => {
      const { accountId, owning } = await accountWithOwner();
      const site = await plantSite(accountId);
      const admin = await staff.member(accountId, ['admin']);
      const codeOf = async (response: Promise<{ body: unknown }>) =>
        errorOf((await response).body).code;
      expect(
        await codeOf(update(admin, admin.membershipId, { roles: ['viewer'] }).expect(403)),
      ).toBe('forbidden');
      expect(
        await codeOf(update(owning, owning.membershipId, { site_ids: [site] }).expect(403)),
      ).toBe('forbidden');
      const dispatcher = await plantMember(accountId, 'Dina', { roles: ['dispatcher'] });
      await update(admin, dispatcher.membershipId, { roles: ['owner'] }).expect(403);
      expect((await rolesOf(dispatcher.membershipId))?.roles).toEqual(['dispatcher']);
      const second = await plantMember(accountId, 'Second owner', { roles: ['owner'] });
      await update(admin, second.membershipId, { roles: ['admin'] }).expect(403);
      // An owner is changed only by an owner, sites included (adversary M-3).
      await update(admin, second.membershipId, { site_ids: [site] }).expect(403);
      await update(owning, dispatcher.membershipId, { roles: ['owner', 'dispatcher'] }).expect(200);
      await update(owning, second.membershipId, { roles: ['admin'] }).expect(200);

      const revoked = await plantMember(accountId, 'Gone', { status: 'revoked' });
      expect(
        errorOf(
          (await update(owning, revoked.membershipId, { roles: ['admin'] }).expect(409)).body,
        ),
      ).toMatchObject({ code: 'invalid_transition', details: { current_status: 'revoked' } });
      const foreign = await plantMember((await accountWithOwner()).accountId, 'Foreign');
      await update(owning, foreign.membershipId, { roles: ['admin'] }).expect(404);
      const unknownSite = await update(owning, dispatcher.membershipId, {
        site_ids: [site, uuidv7()],
      }).expect(400);
      expect(errorOf(unknownSite.body).details?.fields).toEqual([
        expect.objectContaining({ pointer: '/body/site_ids/1', code: 'invalid' }),
      ]);
      await update(owning, dispatcher.membershipId, { roles: ['driver'] }).expect(400);

      // A driver role the drivers resource gave stays, and counts in the combination (A-7).
      const driver = await plantMember(accountId, 'Driver', { roles: ['driver'] });
      const cash = await update(owning, driver.membershipId, { roles: ['cashier'] }).expect(422);
      expect(errorOf(cash.body).code).toBe('role_combination_forbidden');
      const viewer = await update(owning, driver.membershipId, { roles: ['viewer'] }).expect(200);
      expect(viewer.body).toMatchObject({ roles: ['viewer', 'driver'] });

      const reader = await staff.member(accountId, ['viewer']);
      await update(reader, dispatcher.membershipId, { roles: ['viewer'] }).expect(403);
    });

    it('lets two owners demoting each other at once leave one owner', async () => {
      const { accountId, owning } = await accountWithOwner();
      const other = await staff.member(accountId, ['owner']);
      // Both rows held by another transaction until both requests are in flight, so without the
      // membership write lock both would pass their checks before either writes.
      let release = () => undefined as void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked = () => undefined as void;
      const holding = new Promise<void>((resolve) => (locked = resolve));
      const holder = owner.begin(async (tx) => {
        await tx`
          SELECT id FROM core_memberships
          WHERE id IN (${owning.membershipId}, ${other.membershipId}) FOR UPDATE`;
        locked();
        await released;
      });
      await holding;
      const racing = Promise.all([
        update(owning, other.membershipId, { roles: ['admin'] }),
        update(other, owning.membershipId, { roles: ['admin'] }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 750));
      release();
      await holder;
      const answers = await racing;
      expect(answers.map((answer) => answer.status).sort()).toEqual([200, 403]);
      const [owners] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_memberships
        WHERE account_id = ${accountId} AND status = 'active' AND 'owner' = ANY(roles)`;
      expect(owners?.n).toBe(1);
    });

    it('answers 401 token_invalid once the caller’s token version moved, changing nothing', async () => {
      const { accountId, owning } = await accountWithOwner();
      const member = await plantMember(accountId, 'Kept', { roles: ['dispatcher'] });
      await owner`UPDATE core_users SET token_version = token_version + 1 WHERE id = ${owning.userId}`;
      const refused = await update(owning, member.membershipId, { roles: ['viewer'] }).expect(401);
      expect(errorOf(refused.body).code).toBe('token_invalid');
      expect(errorOf((await revoke(owning, member.membershipId).expect(401)).body).code).toBe(
        'token_invalid',
      );
      expect(await rolesOf(member.membershipId)).toEqual({
        roles: ['dispatcher'],
        status: 'active',
      });
    });
  });

  describe('revokeMember', () => {
    it('revokes: 204, the sessions end, the open invitation expires, audited, a repeat is 409', async () => {
      const { accountId, owning } = await accountWithOwner();
      const member = await staff.member(accountId, ['dispatcher']);
      const response = await revoke(owning, member.membershipId).expect(204);
      expect(await auditRowsOf(owner, String(response.headers['x-request-id']))).toMatchObject([
        {
          actorId: owning.userId,
          targetType: 'membership',
          targetId: member.membershipId,
          action: 'core.member.revoked',
          before: { status: 'active' },
          after: { status: 'revoked', invitations_expired: 0 },
        },
      ]);
      await refresh(member).expect(401);
      expect((await staff.login(member.email)).status).toBe(401);
      const read = await get(owning, `/v1/staff/members/${member.membershipId}`).expect(200);
      expect(read.body).toMatchObject({ status: 'revoked' });
      const repeat = await revoke(owning, member.membershipId).expect(409);
      expect(errorOf(repeat.body)).toMatchObject({
        code: 'invalid_transition',
        details: { current_status: 'revoked' },
      });

      const email = freshEmail('withdrawn');
      const invited = await invite(owning, { email, name: 'Wafa', roles: ['viewer'] }).expect(201);
      const id = (invited.body as Membership).id;
      const withdrawn = await revoke(owning, id).expect(204);
      expect(await auditRowsOf(owner, String(withdrawn.headers['x-request-id']))).toMatchObject([
        { before: { status: 'invited' }, after: { status: 'revoked', invitations_expired: 1 } },
      ]);
      const [open] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_invitations
        WHERE membership_id = ${id} AND expires_at > now()`;
      expect(open?.n).toBe(0);
    });

    it('refuses oneself and an owner revoked by an admin; another account’s id is 404', async () => {
      const { accountId, owning } = await accountWithOwner();
      const admin = await staff.member(accountId, ['admin']);
      expect(errorOf((await revoke(owning, owning.membershipId).expect(403)).body).code).toBe(
        'forbidden',
      );
      await revoke(admin, admin.membershipId).expect(403);
      await revoke(admin, owning.membershipId).expect(403);
      expect(await rolesOf(owning.membershipId)).toEqual({ roles: ['owner'], status: 'active' });
      const second = await plantMember(accountId, 'Second owner', { roles: ['owner'] });
      await revoke(owning, second.membershipId).expect(204);
      const foreign = await plantMember((await accountWithOwner()).accountId, 'Foreign');
      await revoke(owning, foreign.membershipId).expect(404);
      expect((await rolesOf(foreign.membershipId))?.status).toBe('active');
      const viewer = await staff.member(accountId, ['viewer']);
      await revoke(viewer, admin.membershipId).expect(403);
    });
  });

  describe('resetMemberSecondFactor', () => {
    const reset = (member: SignedInMember, membershipId: string, body: object, key?: string) =>
      send(member, 'post', `/v1/staff/members/${membershipId}/second-factor/reset`, body, key);
    const phone = () => `+9665${String(randomBytes(4).readUInt32BE(0) % 1e8).padStart(8, '0')}`;

    it.each([
      ['en', 'Set up your Eeasy Logistics verification again'],
      ['ar', 'أعد إعداد التحقق في إيزي لوجستكس'],
    ] as const)(
      'resets a member’s factor (%s): 204, the sessions end, the link mailed, both audit rows',
      async (locale, subject) => {
        const { accountId, owning } = await accountWithOwner();
        const member = await staff.member(accountId, ['dispatcher'], { locale });
        await owner`
          UPDATE core_users SET second_factor_enabled = true, second_factor_phone = ${phone()}
          WHERE id = ${member.userId}`;
        const key = nextKey();
        const response = await reset(
          owning,
          member.membershipId,
          { reason: 'Lost phone' },
          key,
        ).expect(204);
        const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
        expect(audit).toMatchObject([
          {
            action: 'core.auth.second_factor_reset',
            actorId: owning.userId,
            accountId,
            targetType: 'user',
            targetId: member.userId,
          },
          {
            action: 'core.member.second_factor_reset',
            actorId: owning.userId,
            accountId,
            targetType: 'membership',
            targetId: member.membershipId,
            reason: 'Lost phone',
            after: { user_id: member.userId },
          },
        ]);
        expect(errorOf((await refresh(member).expect(401)).body).code).toBe('token_invalid');
        const read = await get(owning, `/v1/staff/members/${member.membershipId}`).expect(200);
        expect(read.body).toMatchObject({
          status: 'active',
          user: { second_factor_enabled: false },
        });

        const mail = await latestMail(owner, member.email, 'second_factor_reset');
        expect(mail?.payload.locale).toBe(locale);
        await sendMailRow(config, mail?.id ?? '');
        const delivered = await mailpitMessage(`${mail?.id ?? ''}@eeasy-logistics`);
        expect(delivered.Subject).toBe(subject);
        expect(delivered.Text).toMatch(
          /http:\/\/localhost:3001\/second-factor\/enrol\/[\da-f-]{36}\.[\w-]{43}/,
        );
        // A retried key answers the stored 204 without a second reset or mail.
        await reset(owning, member.membershipId, { reason: 'Lost phone' }, key).expect(204);
        const [mails] = await owner<{ n: number }[]>`
          SELECT count(*)::int AS n FROM core_outbox
          WHERE kind = 'message' AND payload->>'to' = ${member.email}
            AND payload->>'template_key' = 'second_factor_reset'`;
        expect(mails?.n).toBe(1);
      },
    );

    it('refuses oneself, another account’s or a non-active membership, a reader, a bad reason and a user it cannot reset', async () => {
      const { accountId, owning } = await accountWithOwner();
      const body = { reason: 'Lost phone' };
      expect(errorOf((await reset(owning, owning.membershipId, body).expect(403)).body).code).toBe(
        'forbidden',
      );
      const foreign = await plantMember((await accountWithOwner()).accountId, 'Foreign');
      await reset(owning, foreign.membershipId, body).expect(404);
      const invited = await plantMember(accountId, 'Invited', { status: 'invited' });
      await reset(owning, invited.membershipId, body).expect(404);
      const revoked = await plantMember(accountId, 'Revoked', { status: 'revoked' });
      await reset(owning, revoked.membershipId, body).expect(404);
      const active = await plantMember(accountId, 'Active');
      const short = await reset(owning, active.membershipId, { reason: 'Lost' }).expect(400);
      expect(errorOf(short.body).details?.fields).toEqual([
        expect.objectContaining({ pointer: '/body/reason' }),
      ]);
      const viewer = await staff.member(accountId, ['viewer']);
      await reset(viewer, active.membershipId, body).expect(403);
      await owner`UPDATE core_users SET email = NULL WHERE id = ${active.userId}`;
      const unreachable = await reset(owning, active.membershipId, body).expect(409);
      expect(errorOf(unreachable.body)).toMatchObject({
        code: 'invalid_transition',
        details: { current_status: 'active' },
      });
      const other = await plantMember(accountId, 'Other');
      await owner`UPDATE core_users SET token_version = token_version + 1 WHERE id = ${owning.userId}`;
      const moved = await reset(owning, other.membershipId, body).expect(401);
      expect(errorOf(moved.body).code).toBe('token_invalid');
      const [audits] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_audit_log
        WHERE action = 'core.member.second_factor_reset' AND account_id = ${accountId}`;
      expect(audits?.n).toBe(0);
    });

    it('lets only an owner change an owner: sites and the factor reset included (adversary M-3, L-1)', async () => {
      const { accountId, owning } = await accountWithOwner();
      const site = await plantSite(accountId);
      const admin = await staff.member(accountId, ['admin']);
      const second = await staff.member(accountId, ['owner']);
      await owner`
        UPDATE core_users SET second_factor_enabled = true, second_factor_phone = ${phone()}
        WHERE id = ${second.userId}`;
      const sites = await update(admin, second.membershipId, { site_ids: [site] }).expect(403);
      expect(errorOf(sites.body).code).toBe('forbidden');
      const resetting = await reset(admin, second.membershipId, { reason: 'Lost phone' }).expect(
        403,
      );
      expect(errorOf(resetting.body).code).toBe('forbidden');
      // Nothing changed: the owner's sites, factor and sessions are as they were.
      const [row] = await owner<{ site_ids: string[] }[]>`
        SELECT site_ids FROM core_memberships WHERE id = ${second.membershipId}`;
      expect(row?.site_ids).toEqual([]);
      const [user] = await owner<{ second_factor_enabled: boolean }[]>`
        SELECT second_factor_enabled FROM core_users WHERE id = ${second.userId}`;
      expect(user?.second_factor_enabled).toBe(true);
      await refresh(second).expect(204);
      // An owner may do both.
      await update(owning, second.membershipId, { site_ids: [site] }).expect(200);
      await reset(owning, second.membershipId, { reason: 'Lost phone' }).expect(204);
    });
  });

  describe('budgets of the mailing doors (adversary L-5)', () => {
    const reset = (member: SignedInMember, membershipId: string) =>
      send(member, 'post', `/v1/staff/members/${membershipId}/second-factor/reset`, {
        reason: 'Lost phone',
      });

    it('limits inviteMember to 30 an hour per account', async () => {
      const { owning } = await accountWithOwner();
      const body = () => ({ email: freshEmail('budget'), name: 'Budget', roles: ['viewer'] });
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await invite(owning, body()).expect(201);
      }
      const over = body();
      const refused = await invite(owning, over).expect(429);
      expect(errorOf(refused.body).code).toBe('rate_limited');
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      const [none] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_invitations WHERE email = ${over.email}`;
      expect(none?.n).toBe(0);
      // Another account has a budget of its own.
      await invite((await accountWithOwner()).owning, body()).expect(201);
    });

    it('limits resetMemberSecondFactor to 10 an hour per account', async () => {
      const { accountId, owning } = await accountWithOwner();
      const member = await plantMember(accountId, 'Often reset');
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await reset(owning, member.membershipId).expect(204);
      }
      const refused = await reset(owning, member.membershipId).expect(429);
      expect(errorOf(refused.body).code).toBe('rate_limited');
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
      const [audits] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_audit_log
        WHERE action = 'core.member.second_factor_reset' AND account_id = ${accountId}`;
      expect(audits?.n).toBe(10);
    });
  });
});
