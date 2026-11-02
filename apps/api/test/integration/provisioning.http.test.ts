import { randomBytes } from 'node:crypto';
import type { Account } from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas, schemas } from '@eeasy-logistics/contracts/platform/schemas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Invitations } from '../../src/modules/kernel/auth/invitations.js';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { freshEmail, insertAccount } from './identity-fixtures.js';
import { latestMail, mailpitMessage, sendMailRow } from './mail-delivery.js';
import type { SignedInPlatformStaff } from './platform-sessions.js';
import { platformStaff, platformWriteHeaders } from './platform-sessions.js';
import type { StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-13 item B over HTTP on the real tables (plan 2.2 to 2.4, 2.12): a platform admin provisions
// an account (limits, modules, the owner's invitation) in one transaction; the owner's mail reaches
// Mailpit; the owner accepts and the account turns `active`; the account is read, changed and
// listed; a second owner is invited; replays answer the first response. Real platform sessions
// (invited, TOTP-enrolled) and real staff sessions.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `provisioning:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'provisioning',
  TRUST_PROXY_HOPS: '1',
});

const provisionOp = operationSchemas.platformProvisionAccount;
const listOp = operationSchemas.platformListAccounts;
const errorOf = (body: unknown) => provisionOp.responses['4XX'].parse(body);
const reason = 'PLAT-13 provisioning suite';

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

const limits = { orders_per_month: 1200, drivers: 8, sites: 3, api_keys: 2 };

describe('provisioning doors over HTTP (PLAT-13 item B)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  let admin: SignedInPlatformStaff;
  let support: SignedInPlatformStaff;
  const runTag = randomBytes(4).toString('hex');

  const platformGet = (path: string, who: SignedInPlatformStaff = admin) =>
    staff.http().get(path).set('Cookie', who.cookie).set('Accept-Language', 'en');
  const platformWrite = (
    method: 'post' | 'patch',
    path: string,
    who: SignedInPlatformStaff = admin,
    key = nextKey(),
  ) =>
    staff
      .http()
      [method](path)
      .set(platformWriteHeaders(config))
      .set('Cookie', who.cookie)
      .set('Idempotency-Key', key);
  const provision = (body: Record<string, unknown>, who = admin, key = nextKey()) =>
    platformWrite('post', '/v1/platform/accounts', who, key).send(body);
  const provisionBody = (overrides: Record<string, unknown> = {}) => ({
    name: `Shop ${runTag} ${randomBytes(3).toString('hex')}`,
    default_locale: 'en',
    limits,
    modules: ['delivery'],
    owner: { email: freshEmail('owner'), name: 'Owner One' },
    ...overrides,
  });

  async function accountRow(id: string) {
    const [row] = await owner<
      {
        status: string;
        name: string;
        default_locale: string;
        limits: Record<string, number>;
        provisioned_by: string | null;
        version: number;
      }[]
    >`SELECT status, name, default_locale, limits, provisioned_by, version
      FROM core_accounts WHERE id = ${id}`;
    return row;
  }

  /** The owner accepts through the staff door with the link of the delivered invitation mail. */
  async function acceptOwnerInvitation(email: string, subjectName: string) {
    const mail = await latestMail(owner, email, 'invitation');
    if (mail === undefined) throw new Error('no owner invitation mail');
    await sendMailRow(config, mail.id);
    const delivered = await mailpitMessage(`${mail.id}@eeasy-logistics`);
    expect(delivered.Subject).toContain(subjectName);
    const link = /http:\/\/localhost:3001\/invitations\/[\w-]{43}/.exec(delivered.Text)?.[0];
    if (link === undefined) throw new Error('no link in the invitation mail');
    return staff
      .http()
      .post('/v1/staff/auth/invitations/accept')
      .set(staff.writeHeaders())
      .send({
        token: link.split('/').at(-1),
        name: 'Owner One',
        password: `fresh horse ${randomBytes(6).toString('hex')}`,
      });
  }

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
    admin = await platformStaff(staff.app, config, owner, 'admin');
    support = await platformStaff(staff.app, config, owner, 'support');
  });

  afterAll(async () => {
    await staff?.close();
    await owner?.end();
  });

  it('provisions in one transaction; the owner mail arrives; acceptance activates', async () => {
    const body = provisionBody();
    const response = await provision(body).expect(201);
    const account: Account = provisionOp.responses['201'].parse(response.body);
    expect(account).toMatchObject({
      name: body.name,
      country: 'SA',
      default_locale: 'en',
      timezone: 'Asia/Riyadh',
      status: 'provisioned',
      limits,
      usage: { orders_per_month: 0, drivers: 0, sites: 0, api_keys: 0 },
      provisioned_by: admin.userId,
    });
    const id = account.id ?? '';
    expect(await accountRow(id)).toMatchObject({
      status: 'provisioned',
      limits,
      provisioned_by: admin.userId,
      version: 1,
    });

    const flags = await owner<{ feature_key: string; enabled: boolean; provisioned_by: string }[]>`
      SELECT feature_key, enabled, provisioned_by FROM core_feature_flags WHERE account_id = ${id}`;
    expect(flags).toEqual([
      { feature_key: 'delivery', enabled: true, provisioned_by: admin.userId },
    ]);
    const memberships = await owner<{ roles: string[]; status: string }[]>`
      SELECT roles, status FROM core_memberships WHERE account_id = ${id}`;
    expect(memberships).toEqual([{ roles: ['owner'], status: 'invited' }]);
    const events = await owner<
      { account_id: string | null; kind: string; aggregate_id: string; payload: unknown }[]
    >`SELECT account_id, kind, aggregate_id, payload FROM core_outbox
      WHERE type = 'core.account.provisioned' AND aggregate_id = ${id}`;
    expect(events).toEqual([
      {
        account_id: null,
        kind: 'internal_event',
        aggregate_id: id,
        payload: { account_id: id, limits, modules: ['delivery'] },
      },
    ]);
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.filter((row) => row.action === 'core.account.provisioned')).toMatchObject([
      {
        actorType: 'platform_user',
        actorId: admin.userId,
        accountId: id,
        targetType: 'account',
        targetId: id,
        after: {
          name: body.name,
          default_locale: 'en',
          limits: { orders_per_month: 1200, drivers: 8, sites: 3, api_clients: 2 },
          modules: ['delivery'],
          owner_email: body.owner.email,
        },
      },
    ]);

    const accepted = await acceptOwnerInvitation(body.owner.email, body.name);
    expect(accepted.status).toBe(200);
    expect(await accountRow(id)).toMatchObject({ status: 'active', version: 2 });
    const activation = await auditRowsOf(owner, String(accepted.headers['x-request-id']));
    expect(activation.map((row) => row.action)).toContain('core.account.activated');
    expect(activation.find((row) => row.action === 'core.account.activated')).toMatchObject({
      actorType: 'user',
      accountId: id,
      before: { status: 'provisioned' },
      after: { status: 'active' },
    });
  });

  it('activates only on an owner acceptance', async () => {
    const response = await provision(provisionBody({ modules: [] })).expect(201);
    const id = String((response.body as { id: string }).id);
    const viewer = freshEmail('viewer');
    await staff.app.get(Invitations, { strict: false }).createStaff({
      accountId: id,
      email: viewer,
      name: 'Viewer',
      roles: ['viewer'],
      siteIds: [],
      invitedBy: admin.userId,
      locale: 'en',
    });
    const accepted = await acceptOwnerInvitation(viewer, '');
    expect(accepted.status).toBe(200);
    expect(await accountRow(id)).toMatchObject({ status: 'provisioned', version: 1 });
  });

  it('refuses a bad name, a missing limit, an unknown module and a bad owner name; creates nothing', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ name: 'Visit https://evil.test' }, '/body/name'],
      [{ name: 'Line\nbreak' }, '/body/name'],
      [{ name: 'x'.repeat(81) }, '/body/name'],
      [{ limits: { orders_per_month: 1, drivers: 1, api_keys: 1 } }, '/body/limits/sites'],
      [{ modules: ['delivery', 'channels'] }, '/body/modules/1'],
      [{ owner: { email: freshEmail('owner'), name: '' } }, '/body/owner/name'],
    ];
    const owners: string[] = [];
    for (const [overrides, pointer] of cases) {
      const body = provisionBody(overrides);
      owners.push(body.owner.email);
      const response = await provision(body).expect(400);
      const error = errorOf(response.body);
      expect(error.code).toBe('validation_failed');
      expect(JSON.stringify(error.details?.fields)).toContain(pointer);
    }
    const negativeBody = provisionBody({ limits: { ...limits, drivers: -1 } });
    owners.push(negativeBody.owner.email);
    const negative = await provision(negativeBody).expect(400);
    expect(errorOf(negative.body).code).toBe('validation_failed');
    // Nothing of any refused body was written: no account, no owner user, no invitation.
    const leaked = await owner`SELECT 1 FROM core_accounts WHERE name = 'Visit https://evil.test'`;
    expect(leaked).toHaveLength(0);
    const users = await owner`SELECT 1 FROM core_users WHERE email IN ${owner(owners)}`;
    expect(users).toHaveLength(0);
    const invitations = await owner`SELECT 1 FROM core_invitations WHERE email IN ${owner(owners)}`;
    expect(invitations).toHaveLength(0);
  });

  it('answers a replay with the first response and creates one account', async () => {
    const key = nextKey();
    const body = provisionBody();
    const first = await provision(body, admin, key).expect(201);
    const second = await provision(body, admin, key).expect(201);
    expect(second.body).toEqual(first.body);
    const rows = await owner`SELECT id FROM core_accounts WHERE name = ${body.name}`;
    expect(rows).toHaveLength(1);
  });

  it('refuses platform support (no platform.accounts.provision) with 403', async () => {
    const response = await provision(provisionBody(), support).expect(403);
    expect(errorOf(response.body).code).toBe('forbidden');
  });

  it('reads an account through the door: usage counted, one door row with the reason when sent', async () => {
    const created = await provision(provisionBody()).expect(201);
    const id = String((created.body as { id: string }).id);
    const response = await platformGet(`/v1/platform/accounts/${id}`)
      .set('X-Support-Reason', reason)
      .expect(200);
    expect(operationSchemas.platformGetAccount.responses['200'].parse(response.body)).toMatchObject(
      { id, status: 'provisioned', limits, usage: { sites: 0, orders_per_month: 0 } },
    );
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit).toMatchObject([
      { action: 'platform.cross_tenant.accessed', accountId: id, reason },
    ]);
    // A reason that is sent is still checked (PLAT-6's bound).
    const tooLong = await platformGet(`/v1/platform/accounts/${id}`)
      .set('X-Support-Reason', 'x'.repeat(201))
      .expect(400);
    expect(errorOf(tooLong.body).code).toBe('validation_failed');
  });

  it('answers the account configuration doors without X-Support-Reason, one door row each (lead ruling on 8.2 #8)', async () => {
    const created = await provision(provisionBody()).expect(201);
    const id = String((created.body as { id: string }).id);
    const calls = [
      await platformGet(`/v1/platform/accounts/${id}`).expect(200),
      await platformWrite('patch', `/v1/platform/accounts/${id}`)
        .send({ name: `No reason ${runTag}` })
        .expect(200),
      await platformWrite('post', `/v1/platform/accounts/${id}/owner-invitations`)
        .send({ email: freshEmail('owner-optional'), name: 'Optional Owner' })
        .expect(201),
      await platformGet(`/v1/platform/accounts/${id}/feature-flags`).expect(200),
    ];
    for (const call of calls) {
      const audit = await auditRowsOf(owner, String(call.headers['x-request-id']));
      expect(audit.filter((row) => row.action === 'platform.cross_tenant.accessed')).toMatchObject([
        { accountId: id, reason: null, after: { outcome: 'ok' } },
      ]);
    }
  });

  it('changes name, language and limits under audit; a no-op writes nothing', async () => {
    const created = await provision(provisionBody()).expect(201);
    const id = String((created.body as { id: string }).id);
    const update = (body: Record<string, unknown>) =>
      platformWrite('patch', `/v1/platform/accounts/${id}`)
        .set('X-Support-Reason', reason)
        .send(body);
    const name = `Renamed ${runTag}`;
    const response = await update({
      name,
      default_locale: 'ar',
      limits: { sites: 1, api_keys: 4 },
    }).expect(200);
    expect(
      operationSchemas.platformUpdateAccount.responses['200'].parse(response.body),
    ).toMatchObject({
      id,
      name,
      default_locale: 'ar',
      limits: { ...limits, sites: 1, api_keys: 4 },
    });
    expect(await accountRow(id)).toMatchObject({
      name,
      default_locale: 'ar',
      limits: { ...limits, sites: 1, api_keys: 4 },
      version: 2,
    });
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.find((row) => row.action === 'core.account.updated')).toMatchObject({
      actorType: 'platform_user',
      actorId: admin.userId,
      accountId: id,
      before: { default_locale: 'en', limits: { sites: 3, api_clients: 2 } },
      after: { name, default_locale: 'ar', limits: { sites: 1, api_clients: 4 } },
    });

    const same = await update({ name, limits: { sites: 1 } }).expect(200);
    expect(await accountRow(id)).toMatchObject({ version: 2 });
    const quiet = await auditRowsOf(owner, String(same.headers['x-request-id']));
    expect(quiet.map((row) => row.action)).toEqual(['platform.cross_tenant.accessed']);

    const bad = await update({ name: 'a://b' }).expect(400);
    expect(JSON.stringify(errorOf(bad.body).details?.fields)).toContain('/body/name');
  });

  it('invites a second owner; an active owner is 409 invalid_transition', async () => {
    const body = provisionBody();
    const created = await provision(body).expect(201);
    const id = String((created.body as { id: string }).id);
    expect((await acceptOwnerInvitation(body.owner.email, body.name)).status).toBe(200);
    const invite = (email: string) =>
      platformWrite('post', `/v1/platform/accounts/${id}/owner-invitations`)
        .set('X-Support-Reason', reason)
        .send({ email, name: 'Second Owner' });

    const second = freshEmail('owner-two');
    const response = await invite(second).expect(201);
    const membership = schemas.PlatformInviteOwner201Response.parse(response.body);
    expect(membership).toMatchObject({
      roles: ['owner'],
      status: 'invited',
      user: { email: second, name: 'Second Owner' },
    });
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.map((row) => row.action).sort()).toEqual([
      'core.member.invited',
      'platform.cross_tenant.accessed',
    ]);
    // PLAT-11's invitation mail is a platform-only row in the owner's language (the account's).
    expect((await latestMail(owner, second, 'invitation'))?.payload.locale).toBe('en');

    const again = await invite(body.owner.email).expect(409);
    expect(errorOf(again.body).code).toBe('invalid_transition');
  });

  it('lists accounts with status, q, sort and a cursor; no usage on items', async () => {
    const tag = `List ${runTag}`;
    for (const suffix of ['b', 'a', 'c']) {
      await provision(provisionBody({ name: `${tag} ${suffix}` })).expect(201);
    }
    const page = async (query: string) => {
      const response = await platformGet(`/v1/platform/accounts?${query}`).expect(200);
      const parsed = listOp.responses['200'].parse(response.body);
      const items = (parsed.data ?? []) as unknown[];
      return {
        data: items.map((item) => schemas.PlatformGetAccount200Response.parse(item)),
        next: parsed.next_cursor,
      };
    };
    const q = encodeURIComponent(tag);
    const first = await page(`q=${q}&sort=name&limit=2&status=provisioned`);
    expect(first.data.map((account) => account.name)).toEqual([`${tag} a`, `${tag} b`]);
    expect(first.data[0]).not.toHaveProperty('usage');
    expect(first.data[0]).toMatchObject({ limits, status: 'provisioned' });
    expect(first.next).not.toBeNull();
    const second = await page(
      `q=${q}&sort=name&limit=2&status=provisioned&cursor=${encodeURIComponent(first.next ?? '')}`,
    );
    expect(second.data.map((account) => account.name)).toEqual([`${tag} c`]);
    expect(second.next).toBeNull();
    expect((await page(`q=${q}&status=active`)).data).toEqual([]);
    const newest = await page(`q=${q}`);
    expect(newest.data.map((account) => account.name)).toEqual([
      `${tag} c`,
      `${tag} a`,
      `${tag} b`,
    ]);
    const literal = await page(`q=${encodeURIComponent('%')}&limit=1`);
    expect(literal.data.every((account) => account.name?.includes('%'))).toBe(true);
    const badStatus = await platformGet('/v1/platform/accounts?status=gone').expect(400);
    expect(errorOf(badStatus.body).code).toBe('validation_failed');
  });
});

describe('the account doors run in one platform transaction (lead ruling on 8.2 #11)', () => {
  // A platform pool of one connection: a door that asked for a second platform connection while it
  // holds its own would wait forever, so every call answering at all proves it ran in one.
  const single = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
    CREDENTIALS_KEYS: `provisioning-one:${randomBytes(32).toString('base64')}`,
    CREDENTIALS_ACTIVE_KEY_ID: 'provisioning-one',
    TRUST_PROXY_HOPS: '1',
    DATABASE_POOL_SIZE_PLATFORM: '1',
  });
  let staff: StaffApp;
  let owner: postgres.Sql;
  let admin: SignedInPlatformStaff;

  beforeAll(async () => {
    owner = connectAs('owner', single);
    staff = await startStaffApp(single, owner);
    admin = await platformStaff(staff.app, single, owner, 'admin');
  });

  afterAll(async () => {
    await staff?.close();
    await owner?.end();
  });

  const call = (method: 'get' | 'post' | 'patch', path: string) => {
    const pending = staff
      .http()
      [method](path)
      .set('Cookie', admin.cookie)
      .set('X-Support-Reason', reason)
      .timeout(8000);
    if (method === 'get') return pending.set('Accept-Language', 'en');
    return pending.set(platformWriteHeaders(single)).set('Idempotency-Key', nextKey());
  };

  it('reads, changes and invites an owner on a one-connection platform pool', async () => {
    const created = await call('post', '/v1/platform/accounts')
      .send({
        name: `One connection ${randomBytes(3).toString('hex')}`,
        default_locale: 'ar',
        limits,
        modules: [],
        owner: { email: freshEmail('owner-one'), name: 'Owner One' },
      })
      .expect(201);
    const id = String((created.body as { id: string }).id);
    await call('get', `/v1/platform/accounts/${id}`).expect(200);
    await call('patch', `/v1/platform/accounts/${id}`)
      .send({ name: `One connection renamed ${randomBytes(3).toString('hex')}` })
      .expect(200);
    const invited = await call('post', `/v1/platform/accounts/${id}/owner-invitations`)
      .send({ email: freshEmail('owner-one-b'), name: 'Owner Two' })
      .expect(201);
    const audit = await auditRowsOf(owner, String(invited.headers['x-request-id']));
    expect(audit.map((row) => row.action).sort()).toEqual([
      'core.member.invited',
      'platform.cross_tenant.accessed',
    ]);
  });

  it('suspends, reactivates, suspends and closes on a one-connection platform pool (item E)', async () => {
    const id = await insertAccount(owner);
    await staff.member(id, ['owner']);
    // Item F: the member list reads users and the account's language through the door too.
    await call('get', `/v1/platform/accounts/${id}/members`).expect(200);
    for (const action of ['suspend', 'reactivate', 'suspend', 'close']) {
      await call('post', `/v1/platform/accounts/${id}/${action}`).send({ reason }).expect(200);
    }
    const [row] = await owner<{ status: string }[]>`
      SELECT status FROM core_accounts WHERE id = ${id}`;
    expect(row?.status).toBe('closed');
  });
});
