import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Driver } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas, schemas } from '@eeasy-logistics/contracts/staff/schemas';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EngineMessageSender } from '../../src/modules/kernel/messaging/engine/engine-message-sender.js';
import { MessageSenders } from '../../src/modules/kernel/messaging/message-sender.js';
import { MessageKindHandler } from '../../src/modules/kernel/messaging/message.handler.js';
import { accountSenderResolver } from '../../src/modules/kernel/messaging/sender-resolver.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { messagingStore } from '../../src/modules/kernel/platform/messaging.repository.js';
import type { OutboxJob } from '../../src/worker/system/outbox-workers.js';
import { processOutboxJob } from '../../src/worker/system/outbox-workers.js';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { insertAccount, insertMembership, insertUser } from './identity-fixtures.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// DEL-4 leg 1 over HTTP with real staff sessions (plan 2.2 to 2.4, 2.15): a dispatcher creates a
// driver by phone, the WhatsApp invitation leaves from the account's own sender in the driver's
// language and reaches the stub; the home site, the role combination, the drivers limit and a
// repeated phone are refused; reads, updates (name, home site, capacity, suspension, archive,
// re-creation) and the list with its filters, `q` and pages; every write audited.

const signing = testSigningKey();
const credentialsKey = randomBytes(32).toString('base64');
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `drivers:${credentialsKey}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'drivers',
  TRUST_PROXY_HOPS: '1',
});

const createOp = operationSchemas.createDriver;
const listOp = operationSchemas.listDrivers;
const errorOf = (body: unknown) => createOp.responses['4XX'].parse(body);
const driverOf = (body: unknown): Driver => schemas.GetDriver200Response.parse(body);
function pageOf(body: unknown): { data: Driver[]; next_cursor: string | null } {
  const page = listOp.responses['200'].parse(body);
  const items: unknown[] = page.data ?? [];
  return { data: items.map(driverOf), next_cursor: page.next_cursor };
}

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;
const saudiMobile = () => `+96655${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
/** Noon in Riyadh: outside the quiet hours a deferrable template waits out. */
const noonInRiyadh = new Date('2026-11-02T09:00:00Z');
const quiet = { log: () => undefined, warn: () => undefined };

describe('the staff driver doors over HTTP (DEL-4 item B)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'drivers-http-test');
    staff = await startStaffApp(config, owner);
  });

  afterAll(async () => {
    await staff?.close();
    await Promise.all([owner.end(), pool?.close()]);
  });

  const get = (member: SignedInMember, path: string) =>
    staff.http().get(path).set('Cookie', member.cookie).set('Accept-Language', 'en');
  const send = (
    member: SignedInMember,
    method: 'post' | 'patch',
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
  const create = (member: SignedInMember, body: object, key?: string) =>
    send(member, 'post', '/v1/staff/drivers', body, key);
  const update = (member: SignedInMember, id: string, body: object, key?: string) =>
    send(member, 'patch', `/v1/staff/drivers/${id}`, body, key);

  async function plantSite(
    accountId: string,
    kind: 'branch' | 'warehouse' | 'both' = 'branch',
    status = 'active',
  ): Promise<string> {
    const id = uuidv7();
    await owner`
      INSERT INTO core_sites (id, account_id, kind, name_ar, name_en, status)
      VALUES (${id}, ${accountId}, ${kind}, 'فرع', 'Branch', ${status})`;
    return id;
  }

  /** An account with a branch and a signed-in dispatcher. */
  async function world(options: { name?: string; locale?: 'ar' | 'en'; drivers?: number } = {}) {
    const accountId = await insertAccount(owner, { name: options.name });
    const limits = options.drivers === undefined ? {} : { drivers: options.drivers };
    await owner`
      UPDATE core_accounts SET default_locale = ${options.locale ?? 'ar'}, limits = ${owner.json(limits)}
      WHERE id = ${accountId}`;
    const siteId = await plantSite(accountId);
    const dispatcher = await staff.member(accountId, ['dispatcher']);
    return { accountId, siteId, dispatcher };
  }

  const driverRow = async (id: string) =>
    (
      await owner<
        {
          account_id: string;
          user_id: string;
          membership_id: string;
          home_site_id: string;
          name: string;
          status: string;
          capacity_limit: number;
          version: number;
        }[]
      >`SELECT account_id, user_id, membership_id, home_site_id, name, status, capacity_limit,
               version
        FROM del_drivers WHERE id = ${id}`
    )[0];
  const membershipOf = async (id: string) =>
    (
      await owner<{ roles: string[]; site_ids: string[]; status: string }[]>`
        SELECT roles, site_ids, status FROM core_memberships WHERE id = ${id}`
    )[0];
  const invitationRows = (driverId: string) =>
    owner<
      {
        id: string;
        account_id: string | null;
        type: string;
        supersede_key: string;
        payload: {
          template_key: string;
          to: string;
          locale: string;
          params: Record<string, string>;
        };
      }[]
    >`SELECT id, account_id, type, supersede_key, payload FROM core_outbox
      WHERE kind = 'message' AND aggregate_id = ${driverId} ORDER BY id`;

  /** Runs the worker's `message` handler on one row, through the engine adapter, to the stub. */
  async function deliver(outboxId: string): Promise<string> {
    const { stubUrl, engine } = config.messaging;
    if (
      stubUrl === undefined ||
      engine.serviceId === undefined ||
      engine.keyId === undefined ||
      engine.commandSecret === undefined ||
      engine.platformInstanceId === undefined
    ) {
      throw new Error('MESSAGING_STUB_URL and the WHATSAPP_ENGINE_* variables are required');
    }
    const whatsapp = new EngineMessageSender({
      provider: 'stub',
      appEnv: config.app.env,
      baseUrl: stubUrl,
      key: {
        service: engine.serviceId.reveal(),
        keyId: engine.keyId.reveal(),
        secret: engine.commandSecret.reveal(),
      },
    });
    const platformRoute = { engineAccountId: 1, senderInstanceId: engine.platformInstanceId };
    const senders = new MessageSenders({ whatsapp, mail: null, platformRoute });
    const handler = new MessageKindHandler({
      senders,
      cipher: config.credentials === null ? null : createCredentialsCipher(config.credentials),
      resolver: accountSenderResolver(messagingStore(pool.db), platformRoute),
      policies: { now: () => noonInRiyadh },
      logger: quiet,
    });
    const job = {
      data: { outboxId },
      moveToDelayed: vi.fn(() => Promise.resolve()),
      updateData: vi.fn(() => Promise.resolve()),
    } as unknown as OutboxJob;
    await processOutboxJob(
      {
        db: pool.db,
        registry: new KindHandlerRegistry([handler]),
        logger: quiet,
        random: () => 0.5,
      },
      'message',
      job,
      'token',
    );
    const [row] = await owner<{ status: string }[]>`
      SELECT status FROM core_outbox WHERE id = ${outboxId}`;
    return row?.status ?? 'missing';
  }

  async function sentText(outboxId: string) {
    const response = await fetch(`${config.messaging.stubUrl ?? ''}/sent`);
    const sent = (await response.json()) as {
      body?: {
        command?: string;
        eeasy_message_id?: string;
        sender_instance_id?: string;
        payload?: { to_number?: string; body?: string; locale?: string };
      };
    }[];
    return sent.find((record) => record.body?.eeasy_message_id === outboxId)?.body;
  }

  describe('createDriver', () => {
    it('creates the person, an active driver membership and the driver, audited, and invites over WhatsApp in the driver language', async () => {
      const { accountId, siteId, dispatcher } = await world({ name: 'Riyadh Express' });
      const instance = randomUUID();
      await owner`
        INSERT INTO core_messaging_senders (account_id, sender_instance_id)
        VALUES (${accountId}, ${instance})`;
      const phone = saudiMobile();
      const national = `0${phone.slice(4)}`;
      const response = await create(dispatcher, {
        name: 'Fahad Al-Harbi',
        phone: national,
        home_site_id: siteId,
        locale: 'en',
      }).expect(201);
      const driver = createOp.responses['201'].parse(response.body);
      expect(driver).toMatchObject({
        name: 'Fahad Al-Harbi',
        phone,
        home_site_id: siteId,
        status: 'active',
        capacity_limit: 30,
        active_orders: 0,
        cash_pin_locked: false,
        cash_blocked_at: null,
      });
      const row = await driverRow(driver.id);
      expect(row).toMatchObject({ account_id: accountId, status: 'active', version: 1 });
      expect(row?.user_id).toBe(driver.user_id);
      const [user] = await owner<
        { phone: string; email: string | null; password_hash: string | null; locale: string }[]
      >`SELECT phone, email, password_hash, locale FROM core_users WHERE id = ${driver.user_id ?? ''}`;
      expect(user).toEqual({ phone, email: null, password_hash: null, locale: 'en' });
      expect(await membershipOf(row?.membership_id ?? '')).toEqual({
        roles: ['driver'],
        site_ids: [siteId],
        status: 'active',
      });

      const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
      expect(audit.map((entry) => entry.action)).toEqual(['delivery.driver.created']);
      expect(audit[0]).toMatchObject({
        actorId: dispatcher.userId,
        accountId,
        targetType: 'driver',
        targetId: driver.id,
      });
      expect(audit[0]?.after).toMatchObject({
        name: 'Fahad Al-Harbi',
        phone_tail: `…${phone.slice(-2)}`,
        home_site_id: siteId,
        capacity_limit: 30,
      });
      expect(JSON.stringify(audit[0])).not.toContain(phone.slice(4));

      const [invitation, ...more] = await invitationRows(driver.id);
      expect(more).toEqual([]);
      expect(invitation).toMatchObject({
        account_id: accountId,
        type: 'delivery.driver.created',
        supersede_key: `driver_invitation:${driver.id}`,
        payload: {
          template_key: 'driver_invitation',
          to: phone,
          locale: 'en',
          params: { account_name: 'Riyadh Express', app_link: 'https://eeasy.sa/driver' },
        },
      });
      expect(await deliver(invitation?.id ?? '')).toBe('done');
      const sent = await sentText(invitation?.id ?? '');
      expect(sent?.command).toBe('message.send.text');
      expect(sent?.sender_instance_id).toBe(instance);
      expect(sent?.payload?.to_number).toBe(phone);
      expect(sent?.payload?.body).toContain(
        'You have been added as a driver at Riyadh Express. Install the Eeasy Driver app',
      );
      expect(sent?.payload?.body).toContain('https://eeasy.sa/driver');
    });

    it('invites in the account language when the body names none, Arabic here', async () => {
      const { accountId, siteId, dispatcher } = await world({ name: 'شركة التوصيل', locale: 'ar' });
      await owner`
        INSERT INTO core_messaging_senders (account_id, sender_instance_id)
        VALUES (${accountId}, ${randomUUID()})`;
      const phone = saudiMobile();
      const driver = driverOf(
        (await create(dispatcher, { name: 'سالم', phone, home_site_id: siteId }).expect(201)).body,
      );
      const [invitation] = await invitationRows(driver.id);
      expect(invitation?.payload.locale).toBe('ar');
      expect(await deliver(invitation?.id ?? '')).toBe('done');
      const sent = await sentText(invitation?.id ?? '');
      expect(sent?.payload?.body).toContain('تمت إضافتك سائقًا لدى شركة التوصيل');
      expect(sent?.payload?.body).not.toMatch(/[٠-٩]/);
    });

    it('creates the driver even when the account has no sender: the invitation is skipped, not lost', async () => {
      const { siteId, dispatcher } = await world();
      const driver = driverOf(
        (
          await create(dispatcher, {
            name: 'No Sender',
            phone: saudiMobile(),
            home_site_id: siteId,
          }).expect(201)
        ).body,
      );
      const [invitation] = await invitationRows(driver.id);
      expect(await deliver(invitation?.id ?? '')).toBe('done');
      expect(await sentText(invitation?.id ?? '')).toBeUndefined();
    });

    it('refuses a warehouse home site 422, an unknown or inactive one 400, a bad phone and name 400', async () => {
      const { accountId, dispatcher } = await world();
      const warehouse = await plantSite(accountId, 'warehouse');
      const inactive = await plantSite(accountId, 'branch', 'inactive');
      const other = await plantSite(await insertAccount(owner));
      const both = await plantSite(accountId, 'both');
      const phone = saudiMobile();
      const refused = await create(dispatcher, {
        name: 'W',
        phone,
        home_site_id: warehouse,
      }).expect(422);
      expect(errorOf(refused.body).code).toBe('site_kind_mismatch');
      for (const site of [inactive, other, uuidv7()]) {
        const bad = await create(dispatcher, { name: 'W', phone, home_site_id: site }).expect(400);
        expect(errorOf(bad.body).details).toMatchObject({
          fields: [{ pointer: '/body/home_site_id', code: 'invalid' }],
        });
      }
      const fields = errorOf(
        (await create(dispatcher, { name: 'A\nB', phone: '12', home_site_id: both }).expect(400))
          .body,
      ).details;
      expect(fields).toMatchObject({
        fields: [
          { pointer: '/body/name', code: 'invalid' },
          { pointer: '/body/phone', code: 'invalid' },
        ],
      });
      const [count] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM del_drivers WHERE account_id = ${accountId}`;
      expect(count?.n).toBe(0);
      await create(dispatcher, { name: 'Both', phone, home_site_id: both }).expect(201);
    });

    it('refuses the phone of an owner (role_combination_forbidden) and merges a dispatcher', async () => {
      const { accountId, siteId, dispatcher } = await world();
      const ownerPhone = saudiMobile();
      const owning = await insertUser(owner, { name: 'The Owner' });
      await owner`UPDATE core_users SET phone = ${ownerPhone} WHERE id = ${owning.id}`;
      const owningMembership = await insertMembership(owner, accountId, owning.id, {
        roles: ['owner'],
      });
      const refused = await create(dispatcher, {
        name: 'Owner As Driver',
        phone: ownerPhone,
        home_site_id: siteId,
      }).expect(422);
      expect(errorOf(refused.body).code).toBe('role_combination_forbidden');
      expect(await membershipOf(owningMembership)).toMatchObject({ roles: ['owner'] });
      const [none] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM del_drivers WHERE user_id = ${owning.id}`;
      expect(none?.n).toBe(0);

      const staffPhone = saudiMobile();
      const colleague = await insertUser(owner, { name: 'Dispatcher Two' });
      await owner`UPDATE core_users SET phone = ${staffPhone} WHERE id = ${colleague.id}`;
      const colleagueMembership = await insertMembership(owner, accountId, colleague.id, {
        roles: ['dispatcher'],
      });
      const driver = driverOf(
        (
          await create(dispatcher, {
            name: 'Driving Colleague',
            phone: staffPhone,
            home_site_id: siteId,
          }).expect(201)
        ).body,
      );
      // The driver carries the body's name and the person keeps theirs (adversary H-3); one
      // membership per user and account, roles merged.
      expect(driver.name).toBe('Driving Colleague');
      const [person] = await owner<{ name: string }[]>`
        SELECT name FROM core_users WHERE id = ${colleague.id}`;
      expect(person?.name).toBe('Dispatcher Two');
      expect(await membershipOf(colleagueMembership)).toEqual({
        roles: ['dispatcher', 'driver'],
        site_ids: [],
        status: 'active',
      });
      expect((await driverRow(driver.id))?.membership_id).toBe(colleagueMembership);
    });

    it("never reads or writes another account's name for a shared person (adversary H-3)", async () => {
      const a = await world();
      const b = await world();
      const phone = saudiMobile();
      const inA = driverOf(
        (await create(a.dispatcher, { name: 'Ahmad', phone, home_site_id: a.siteId }).expect(201))
          .body,
      );
      const inB = driverOf(
        (
          await create(b.dispatcher, {
            name: 'Abu Khalid',
            phone,
            home_site_id: b.siteId,
          }).expect(201)
        ).body,
      );
      expect(inB.user_id).toBe(inA.user_id);
      expect(inB.name).toBe('Abu Khalid');
      const personName = async () =>
        (
          await owner<
            { name: string }[]
          >`SELECT name FROM core_users WHERE id = ${inA.user_id ?? ''}`
        )[0]?.name;
      expect(await personName()).toBe('Ahmad');
      await update(b.dispatcher, inB.id, { name: 'Khalid' }).expect(200);
      expect(await personName()).toBe('Ahmad');
      const seenByA = driverOf(
        (await get(a.dispatcher, `/v1/staff/drivers/${inA.id}`).expect(200)).body,
      );
      expect(seenByA.name).toBe('Ahmad');
      const seenByB = driverOf(
        (await get(b.dispatcher, `/v1/staff/drivers/${inB.id}`).expect(200)).body,
      );
      expect(seenByB.name).toBe('Khalid');
    });

    it('refuses the next driver at limits.drivers, counting suspended ones and not archived ones', async () => {
      const { siteId, dispatcher } = await world({ drivers: 2 });
      const first = driverOf(
        (
          await create(dispatcher, {
            name: 'One',
            phone: saudiMobile(),
            home_site_id: siteId,
          }).expect(201)
        ).body,
      );
      const second = driverOf(
        (
          await create(dispatcher, {
            name: 'Two',
            phone: saudiMobile(),
            home_site_id: siteId,
          }).expect(201)
        ).body,
      );
      await update(dispatcher, second.id, { status: 'suspended' }).expect(200);
      const third = saudiMobile();
      const refused = await create(dispatcher, {
        name: 'Three',
        phone: third,
        home_site_id: siteId,
      }).expect(422);
      expect(errorOf(refused.body)).toMatchObject({
        code: 'limit_exceeded',
        details: { metric: 'drivers', limit: 2 },
      });
      const [none] = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_users WHERE phone = ${third}`;
      expect(none?.n).toBe(0);
      await update(dispatcher, first.id, { status: 'archived' }).expect(200);
      await create(dispatcher, { name: 'Three', phone: third, home_site_id: siteId }).expect(201);
    });

    it('lets concurrent creates pass the limit one at a time', async () => {
      const { siteId, dispatcher } = await world({ drivers: 2 });
      const answers = await Promise.all(
        [1, 2, 3, 4].map((n) =>
          create(dispatcher, { name: `Racer ${n}`, phone: saudiMobile(), home_site_id: siteId }),
        ),
      );
      expect(answers.map((answer) => answer.status).sort()).toEqual([201, 201, 422, 422]);
    });

    it('answers 400 duplicate for a phone that already drives here, replays a retried key, and brings an archived driver back', async () => {
      const { accountId, siteId, dispatcher } = await world();
      const phone = saudiMobile();
      const key = nextKey();
      const first = await create(
        dispatcher,
        { name: 'Repeat', phone, home_site_id: siteId },
        key,
      ).expect(201);
      const replay = await create(
        dispatcher,
        { name: 'Repeat', phone, home_site_id: siteId },
        key,
      ).expect(201);
      expect(replay.body).toEqual(first.body);
      const duplicate = await create(dispatcher, {
        name: 'Again',
        phone,
        home_site_id: siteId,
      }).expect(400);
      expect(errorOf(duplicate.body).details).toMatchObject({
        fields: [{ pointer: '/body/phone', code: 'duplicate' }],
      });
      const driver = driverOf(first.body);
      await update(dispatcher, driver.id, { status: 'archived' }).expect(200);
      const branch = await plantSite(accountId, 'both');
      const back = driverOf(
        (
          await create(dispatcher, {
            name: 'Repeat',
            phone,
            home_site_id: branch,
            capacity_limit: 12,
          }).expect(201)
        ).body,
      );
      expect(back).toMatchObject({
        id: driver.id,
        status: 'active',
        home_site_id: branch,
        capacity_limit: 12,
      });
      expect(await membershipOf((await driverRow(driver.id))?.membership_id ?? '')).toEqual({
        roles: ['driver'],
        site_ids: [branch],
        status: 'active',
      });
      expect(await invitationRows(driver.id)).toHaveLength(2);
    });

    it('is refused to a member without delivery.drivers.manage, and another account sees nothing', async () => {
      const { accountId, siteId } = await world();
      const viewer = await staff.member(accountId, ['viewer']);
      await create(viewer, { name: 'X', phone: saudiMobile(), home_site_id: siteId }).expect(403);
      const theirs = await world();
      const driver = driverOf(
        (
          await create(theirs.dispatcher, {
            name: 'Theirs',
            phone: saudiMobile(),
            home_site_id: theirs.siteId,
          }).expect(201)
        ).body,
      );
      const mine = await staff.member(accountId, ['dispatcher']);
      await get(mine, `/v1/staff/drivers/${driver.id}`).expect(404);
      await update(mine, driver.id, { capacity_limit: 3 }).expect(404);
      expect((await driverRow(driver.id))?.capacity_limit).toBe(30);
    });
  });

  describe('getDriver and updateDriver', () => {
    async function withDriver() {
      const w = await world();
      const phone = saudiMobile();
      const driver = driverOf(
        (await create(w.dispatcher, { name: 'Majed', phone, home_site_id: w.siteId }).expect(201))
          .body,
      );
      const row = await driverRow(driver.id);
      if (row === undefined) throw new Error('no driver row');
      return { ...w, driver, row, phone };
    }

    /** A live driver refresh row of the membership (what leg 2's sign-in writes). */
    async function plantSession(userId: string, membershipId: string, deviceId: string | null) {
      const id = uuidv7();
      await owner`
        INSERT INTO core_refresh_tokens (id, surface, user_id, membership_id, device_id, family_id,
                                         token_hash, token_version, expires_at)
        VALUES (${id}, 'driver', ${userId}, ${membershipId}, ${deviceId}, ${uuidv7()},
                ${randomBytes(32)}, 1, now() + interval '90 days')`;
      return id;
    }
    const revokedReason = async (id: string) =>
      (
        await owner<{ revoked_reason: string | null }[]>`
          SELECT revoked_reason FROM core_refresh_tokens WHERE id = ${id}`
      )[0]?.revoked_reason;
    const tokenVersion = async (userId: string) =>
      (
        await owner<{ v: number }[]>`SELECT token_version AS v FROM core_users WHERE id = ${userId}`
      )[0]?.v;

    it('reads a driver, renames the driver (not the person), moves the home site and the capacity, audited with the changes', async () => {
      const { accountId, dispatcher, driver, row } = await withDriver();
      expect(
        driverOf((await get(dispatcher, `/v1/staff/drivers/${driver.id}`).expect(200)).body),
      ).toEqual(driver);
      const both = await plantSite(accountId, 'both');
      const response = await update(dispatcher, driver.id, {
        name: 'Majed Al-Otaibi',
        home_site_id: both,
        capacity_limit: 0,
      }).expect(200);
      const updated = schemas.UpdateDriver200Response.parse(response.body);
      expect(updated).toMatchObject({
        name: 'Majed Al-Otaibi',
        home_site_id: both,
        capacity_limit: 0,
      });
      expect(await driverRow(driver.id)).toMatchObject({
        name: 'Majed Al-Otaibi',
        home_site_id: both,
        capacity_limit: 0,
        version: 2,
      });
      // The person's own name is never written by an account (adversary H-3).
      const [user] = await owner<
        { name: string }[]
      >`SELECT name FROM core_users WHERE id = ${row.user_id}`;
      expect(user?.name).toBe('Majed');
      expect(await membershipOf(row.membership_id)).toMatchObject({ site_ids: [both] });
      const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
      expect(audit.map((entry) => entry.action)).toEqual(['delivery.driver.updated']);
      expect(audit[0]?.before).toEqual({
        name: 'Majed',
        home_site_id: row.home_site_id,
        capacity_limit: 30,
      });
      expect(audit[0]?.after).toEqual({
        name: 'Majed Al-Otaibi',
        home_site_id: both,
        capacity_limit: 0,
      });

      const same = await update(dispatcher, driver.id, { capacity_limit: 0 }).expect(200);
      expect(await auditRowsOf(owner, same.headers['x-request-id'] as string)).toEqual([]);
      expect((await driverRow(driver.id))?.version).toBe(2);

      const warehouse = await plantSite(accountId, 'warehouse');
      const refused = await update(dispatcher, driver.id, { home_site_id: warehouse }).expect(422);
      expect(errorOf(refused.body).code).toBe('site_kind_mismatch');
      await update(dispatcher, driver.id, { name: '' }).expect(400);
      await update(dispatcher, driver.id, { capacity_limit: -1 }).expect(400);
      await get(dispatcher, `/v1/staff/drivers/${uuidv7()}`).expect(404);
    });

    it('suspends: the driver sessions of the membership end, the token version stays (ruling 8.2 #23); then back to active', async () => {
      const { dispatcher, driver, row } = await withDriver();
      const session = await plantSession(row.user_id, row.membership_id, uuidv7());
      const version = await tokenVersion(row.user_id);
      const response = await update(dispatcher, driver.id, { status: 'suspended' }).expect(200);
      expect(driverOf(response.body).status).toBe('suspended');
      expect(await revokedReason(session)).toBe('revoked');
      expect(await tokenVersion(row.user_id)).toBe(version);
      expect(await membershipOf(row.membership_id)).toMatchObject({ status: 'active' });
      const audit = await auditRowsOf(owner, response.headers['x-request-id'] as string);
      expect(audit[0]).toMatchObject({
        action: 'delivery.driver.updated',
        before: { status: 'active' },
        after: { status: 'suspended' },
      });
      await update(dispatcher, driver.id, { status: 'active' }).expect(200);
      expect(await tokenVersion(row.user_id)).toBe(version);
    });

    it('archives: devices revoked, push tokens cleared, sessions ended, the driver role released; no way back by update', async () => {
      const { accountId, dispatcher, driver, row } = await withDriver();
      const devices = [uuidv7(), uuidv7(), uuidv7()];
      for (const [index, id] of devices.entries()) {
        await owner`
          INSERT INTO del_driver_devices (id, account_id, driver_id, device_id, platform, app_version,
                                          push_token, revoked_at)
          VALUES (${id}, ${accountId}, ${driver.id}, ${`device-${index}`}, 'android', '1.0.0',
                  ${`ExponentPushToken[${index}]`}, ${index === 2 ? new Date().toISOString() : null}::timestamptz)`;
      }
      const session = await plantSession(row.user_id, row.membership_id, devices[0] ?? null);
      await update(dispatcher, driver.id, { status: 'archived' }).expect(200);
      const stored = await owner<{ revoked: boolean; push_token: string | null }[]>`
        SELECT revoked_at IS NOT NULL AS revoked, push_token FROM del_driver_devices
        WHERE driver_id = ${driver.id}`;
      expect(stored).toHaveLength(3);
      expect(stored.every((device) => device.revoked && device.push_token === null)).toBe(true);
      expect(await revokedReason(session)).toBe('revoked');
      expect(await membershipOf(row.membership_id)).toMatchObject({
        roles: ['driver'],
        status: 'revoked',
      });
      const back = await update(dispatcher, driver.id, { status: 'active' }).expect(409);
      expect(errorOf(back.body)).toMatchObject({
        code: 'invalid_transition',
        details: { current_status: 'archived' },
      });
    });

    it('archives a driver who is also a dispatcher: the staff roles stay', async () => {
      const { accountId, siteId, dispatcher } = await world();
      const phone = saudiMobile();
      const colleague = await insertUser(owner, { name: 'Two Hats' });
      await owner`UPDATE core_users SET phone = ${phone} WHERE id = ${colleague.id}`;
      const membershipId = await insertMembership(owner, accountId, colleague.id, {
        roles: ['dispatcher'],
      });
      const driver = driverOf(
        (await create(dispatcher, { name: 'x', phone, home_site_id: siteId }).expect(201)).body,
      );
      await update(dispatcher, driver.id, { status: 'archived' }).expect(200);
      expect(await membershipOf(membershipId)).toEqual({
        roles: ['dispatcher'],
        site_ids: [],
        status: 'active',
      });
    });
  });

  describe('listDrivers', () => {
    it('filters by status, home site, cash block and q, and pages by name with a bound cursor', async () => {
      const { accountId, siteId, dispatcher } = await world();
      const other = await plantSite(accountId, 'both');
      const made: Driver[] = [];
      for (const [name, site] of [
        ['Delta', siteId],
        ['Alpha', other],
        ['Echo', siteId],
        ['Charlie', siteId],
        ['Bravo', other],
      ] as const) {
        made.push(
          driverOf(
            (
              await create(dispatcher, { name, phone: saudiMobile(), home_site_id: site }).expect(
                201,
              )
            ).body,
          ),
        );
      }
      const byName = (name: string) => made.find((driver) => driver.name === name);
      await update(dispatcher, byName('Echo')?.id ?? '', { status: 'suspended' }).expect(200);
      await owner`
        UPDATE del_drivers SET cash_blocked_at = now(), cash_blocked_reason = 'over_limit'
        WHERE id = ${byName('Charlie')?.id ?? ''}`;

      const names: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = `?sort=name&limit=2${cursor === null ? '' : `&cursor=${cursor}`}`;
        const page = pageOf((await get(dispatcher, `/v1/staff/drivers${query}`).expect(200)).body);
        names.push(...page.data.map((driver) => driver.name ?? ''));
        cursor = page.next_cursor;
        pages += 1;
      } while (cursor !== null && pages < 10);
      expect(names).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']);
      expect(pages).toBe(3);

      const list = async (query: string) =>
        pageOf((await get(dispatcher, `/v1/staff/drivers${query}`).expect(200)).body).data.map(
          (driver) => driver.name,
        );
      expect(await list('?status=suspended')).toEqual(['Echo']);
      expect(await list(`?site_id=${other}&sort=name`)).toEqual(['Alpha', 'Bravo']);
      expect(await list('?cash_blocked=true')).toEqual(['Charlie']);
      expect(await list('?cash_blocked=false&sort=-name')).toEqual([
        'Echo',
        'Delta',
        'Bravo',
        'Alpha',
      ]);
      expect(await list('?q=ALPH')).toEqual(['Alpha']);
      const tail = byName('Delta')?.phone?.slice(-4) ?? '';
      expect(await list(`?q=${tail}`)).toContain('Delta');
      expect(await list('?status=active,suspended&sort=status')).toHaveLength(5);

      const first = pageOf(
        (await get(dispatcher, '/v1/staff/drivers?sort=name&limit=2').expect(200)).body,
      );
      const moved = await get(
        dispatcher,
        `/v1/staff/drivers?sort=name&limit=2&status=active&cursor=${first.next_cursor ?? ''}`,
      ).expect(400);
      expect(errorOf(moved.body).code).toBe('validation_failed');
      await get(dispatcher, '/v1/staff/drivers?status=retired').expect(400);
      await get(dispatcher, '/v1/staff/drivers?sort=phone').expect(400);
    });
  });
});
