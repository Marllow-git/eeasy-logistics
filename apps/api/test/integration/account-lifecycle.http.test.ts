import { randomBytes } from 'node:crypto';
import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RelayRow } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { KindHandlerRegistry } from '../../src/modules/kernel/outbox/kind-handlers.js';
import { nextOutboxId } from '../../src/modules/kernel/outbox/outbox-id.js';
import type { OutboxKind } from '../../src/modules/kernel/schema/outbox.js';
import type { RelayDependencies } from '../../src/worker/system/outbox-relay.js';
import { relayBatch } from '../../src/worker/system/outbox-relay.js';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { cookieHeader, freshEmail, insertAccount, setCookies } from './identity-fixtures.js';
import type { SignedInPlatformStaff } from './platform-sessions.js';
import { platformStaff, platformWriteHeaders } from './platform-sessions.js';
import type { SignedInMember, StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-13 item E over HTTP on the real tables (plan 2.7, 2.12; K-2; identity and tenancy §6): a
// platform admin suspends an active account, reactivates it and closes a suspended one through the
// account's door, with the reason in the body. A suspended account's members cannot refresh
// (`403 account_suspended`) or write, their staff families are revoked, its external outbox effects
// wait while its internal events relay; reactivation restores writes and a new session refreshes;
// closure is only from `suspended`, revokes every session and expires the open invitations. Real
// platform sessions (invited, TOTP-enrolled) and real staff sessions.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `lifecycle:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'lifecycle',
  TRUST_PROXY_HOPS: '1',
});

const suspendOp = operationSchemas.platformSuspendAccount;
const errorOf = (body: unknown) => suspendOp.responses['4XX'].parse(body);
const reason = 'Ticket 7781: unpaid invoices';

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

/**
 * What the relay would enqueue of `kind` now: a queue double records the rows, then refuses, so the
 * batch rolls back and no other suite's row is ever marked (PLAT-8's relay-test pattern).
 */
async function offeredFor(pool: Pool<PlatformDatabase>, kind: OutboxKind): Promise<Set<string>> {
  const offered = new Set<string>();
  const refusing: RelayDependencies['queues'] = {
    add: (_kind, ids) => {
      for (const id of ids) offered.add(id);
      return Promise.reject(new Error('rolled back on purpose'));
    },
    existingJobs: () => Promise.resolve(new Set()),
  };
  const single = new KindHandlerRegistry([
    {
      kind,
      orderingKey: (row: RelayRow) => row.aggregateId,
      execute: () => Promise.resolve({ outcome: 'done' as const }),
    },
  ]);
  await relayBatch(pool.db, refusing, single, 100_000).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== 'rolled back on purpose') throw error;
  });
  return offered;
}

describe('suspension, reactivation and closure over HTTP (PLAT-13 item E)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let admin: SignedInPlatformStaff;
  let support: SignedInPlatformStaff;

  const lifecycle = (
    accountId: string,
    action: 'suspend' | 'reactivate' | 'close',
    who: SignedInPlatformStaff = admin,
    key = nextKey(),
    body: Record<string, unknown> = { reason },
  ) =>
    staff
      .http()
      .post(`/v1/platform/accounts/${accountId}/${action}`)
      .set(platformWriteHeaders(config))
      .set('Cookie', who.cookie)
      .set('Idempotency-Key', key)
      .send(body);
  const refresh = (member: SignedInMember) =>
    staff
      .http()
      .post('/v1/staff/auth/refresh')
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie);
  const write = (member: SignedInMember) =>
    staff
      .http()
      .patch('/v1/staff/account/settings')
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', nextKey())
      .send({});
  const read = (member: SignedInMember) =>
    staff.http().get('/v1/staff/account').set('Cookie', member.cookie).set('Accept-Language', 'en');

  async function accountRow(id: string) {
    const [row] = await owner<{ status: string; version: number; closed: boolean }[]>`
      SELECT status, version, closed_at IS NOT NULL AS closed FROM core_accounts WHERE id = ${id}`;
    return row;
  }

  async function liveFamilies(membershipId: string): Promise<number> {
    const [row] = await owner<{ live: number }[]>`
      SELECT count(*)::int AS live FROM core_refresh_tokens
      WHERE membership_id = ${membershipId} AND revoked_at IS NULL`;
    return row?.live ?? 0;
  }

  async function plant(accountId: string, kind: OutboxKind): Promise<string> {
    const id = nextOutboxId();
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind)
      VALUES (${id}, 'core.site.updated', 1, ${accountId}, 'site', ${uuidv7()}, 1, '{}', ${kind})`;
    return id;
  }

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'account-lifecycle-test');
    staff = await startStaffApp(config, owner);
    admin = await platformStaff(staff.app, config, owner, 'admin');
    support = await platformStaff(staff.app, config, owner, 'support');
  });

  afterAll(async () => {
    await staff?.close();
    await pool?.close();
    await owner?.end();
  });

  it('suspends: refresh and writes refused, families revoked, effects held, event and audit with the reason', async () => {
    const accountId = await insertAccount(owner);
    const member = await staff.member(accountId, ['owner']);
    expect(await liveFamilies(member.membershipId)).toBe(1);

    const response = await lifecycle(accountId, 'suspend').expect(200);
    expect(suspendOp.responses['200'].parse(response.body)).toMatchObject({
      id: accountId,
      status: 'suspended',
    });
    expect(await accountRow(accountId)).toMatchObject({ status: 'suspended', version: 2 });
    expect(await liveFamilies(member.membershipId)).toBe(0);

    const refused = await refresh(member).expect(403);
    expect(errorOf(refused.body).code).toBe('account_suspended');
    const blocked = await write(member).expect(403);
    expect(errorOf(blocked.body).code).toBe('account_suspended');
    // Reads stay open for the access token's lifetime (the data is kept, K-2).
    await read(member).expect(200);
    // A suspended member cannot sign in again (PLAT-11 skips suspended memberships).
    expect((await staff.login(member.email)).status).not.toBe(200);

    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.find((row) => row.action === 'core.account.suspended')).toMatchObject({
      actorType: 'platform_user',
      actorId: admin.userId,
      accountId,
      targetType: 'account',
      targetId: accountId,
      before: { status: 'active' },
      after: { status: 'suspended', sessions_ended: 1 },
      reason,
    });
    expect(audit.find((row) => row.action === 'platform.cross_tenant.accessed')).toMatchObject({
      accountId,
      reason,
    });
    const [event] = await owner<
      { id: string; account_id: string; kind: string; sequence: number; payload: unknown }[]
    >`SELECT id, account_id, kind, sequence, payload FROM core_outbox
      WHERE type = 'core.account.suspended' AND aggregate_id = ${accountId}`;
    expect(event).toMatchObject({
      account_id: accountId,
      kind: 'internal_event',
      sequence: 2,
      payload: { reason },
    });

    // The relay holds the account's external effects and still relays its internal events.
    const webhook = await plant(accountId, 'webhook');
    expect((await offeredFor(pool, 'webhook')).has(webhook)).toBe(false);
    expect((await offeredFor(pool, 'internal_event')).has(event?.id ?? '')).toBe(true);

    // Reactivation: writes again, a new session refreshes, the held effect is relayable.
    const reactivated = await lifecycle(accountId, 'reactivate').expect(200);
    expect(reactivated.body).toMatchObject({ status: 'active' });
    expect(await accountRow(accountId)).toMatchObject({ status: 'active', version: 3 });
    expect((await offeredFor(pool, 'webhook')).has(webhook)).toBe(true);
    const relogin = await staff.login(member.email);
    expect(relogin.status).toBe(200);
    const cookies = setCookies(relogin.headers);
    const again: SignedInMember = {
      ...member,
      cookie: cookieHeader({
        el_staff_at: cookies.get('el_staff_at')?.value,
        el_staff_rt: cookies.get('el_staff_rt')?.value,
      }),
    };
    await refresh(again).expect(204);
    await write(again).expect(200);
    const reactivation = await auditRowsOf(owner, String(reactivated.headers['x-request-id']));
    expect(reactivation.find((row) => row.action === 'core.account.reactivated')).toMatchObject({
      before: { status: 'suspended' },
      after: { status: 'active' },
      reason,
    });
    const events = await owner<{ type: string }[]>`
      SELECT type FROM core_outbox WHERE aggregate_id = ${accountId} ORDER BY sequence`;
    expect(events.map((row) => row.type)).toEqual([
      'core.account.suspended',
      'core.account.reactivated',
    ]);
    await owner`UPDATE core_outbox SET status = 'done' WHERE id = ${webhook}`;
  });

  it('answers 409 invalid_transition with the current status and version for every other arrow', async () => {
    const provisioned = await insertAccount(owner, { status: 'provisioned' });
    const active = await insertAccount(owner);
    const cases: [string, 'suspend' | 'reactivate' | 'close', string][] = [
      [provisioned, 'suspend', 'provisioned'],
      [active, 'reactivate', 'active'],
      [active, 'close', 'active'],
      [provisioned, 'close', 'provisioned'],
    ];
    for (const [accountId, action, current] of cases) {
      const response = await lifecycle(accountId, action).expect(409);
      const error = errorOf(response.body);
      expect(error.code).toBe('invalid_transition');
      expect(error.details).toMatchObject({ current_status: current, version: 1 });
      // The refusal rolled back: the account and its outbox are unchanged; the door row says failed.
      expect(await accountRow(accountId)).toMatchObject({ status: current, version: 1 });
      const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
      expect(audit.map((row) => row.action)).toEqual(['platform.cross_tenant.accessed']);
      expect(audit[0]?.after).toMatchObject({ outcome: 'failed', status: 409 });
    }
    const events = await owner`
      SELECT 1 FROM core_outbox WHERE aggregate_id IN (${provisioned}, ${active})`;
    expect(events).toHaveLength(0);
  });

  it('closes a suspended account only: every session revoked, open invitations expired, final', async () => {
    const accountId = await insertAccount(owner);
    const member = await staff.member(accountId, ['owner']);
    const invitee = freshEmail('invitee');
    await staff
      .http()
      .post('/v1/staff/members/invitations')
      .set(staff.writeHeaders())
      .set('Cookie', member.cookie)
      .set('Idempotency-Key', nextKey())
      .send({ email: invitee, name: 'Invited Person', roles: ['viewer'] })
      .expect(201);
    await lifecycle(accountId, 'suspend').expect(200);
    // A staff family revoked by the suspension; plant a live driver family for the closure.
    const driverFamily = uuidv7();
    await owner`
      INSERT INTO core_refresh_tokens (id, surface, user_id, membership_id, family_id, token_hash,
                                       token_version, amr, expires_at)
      VALUES (${uuidv7()}, 'driver', ${member.userId}, ${member.membershipId}, ${driverFamily},
              ${randomBytes(32)}, 1, '{otp}', now() + interval '1 day')`;

    const response = await lifecycle(accountId, 'close').expect(200);
    expect(response.body).toMatchObject({ id: accountId, status: 'closed' });
    expect(await accountRow(accountId)).toMatchObject({ status: 'closed', closed: true });
    expect(await liveFamilies(member.membershipId)).toBe(0);
    const open = await owner`
      SELECT 1 FROM core_invitations
      WHERE account_id = ${accountId} AND accepted_at IS NULL AND expires_at > now()`;
    expect(open).toHaveLength(0);
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.find((row) => row.action === 'core.account.closed')).toMatchObject({
      before: { status: 'suspended' },
      after: { status: 'closed', sessions_ended: 1, invitations_expired: 1 },
      reason,
    });
    const [closed] = await owner<{ kind: string; payload: unknown }[]>`
      SELECT kind, payload FROM core_outbox
      WHERE type = 'core.account.closed' AND aggregate_id = ${accountId}`;
    expect(closed).toEqual({ kind: 'internal_event', payload: { reason } });

    // Final: no arrow leaves `closed`; the account stays readable through the door.
    const reopen = await lifecycle(accountId, 'reactivate').expect(409);
    expect(errorOf(reopen.body).details).toMatchObject({ current_status: 'closed' });
    await staff
      .http()
      .get(`/v1/platform/accounts/${accountId}`)
      .set('Cookie', admin.cookie)
      .set('X-Support-Reason', reason)
      .expect(200);
    // The member's still-valid access token cannot write to a closed account.
    const blocked = await write(member).expect(401);
    expect(errorOf(blocked.body).code).toBe('token_invalid');
  });

  it('answers a replay with the first response; refuses support and a reason the door bounds', async () => {
    const accountId = await insertAccount(owner);
    const key = nextKey();
    const first = await lifecycle(accountId, 'suspend', admin, key).expect(200);
    const second = await lifecycle(accountId, 'suspend', admin, key).expect(200);
    expect(second.body).toEqual(first.body);
    const rows = await owner`
      SELECT 1 FROM core_audit_log WHERE action = 'core.account.suspended' AND account_id = ${accountId}`;
    expect(rows).toHaveLength(1);

    const denied = await lifecycle(accountId, 'reactivate', support).expect(403);
    expect(errorOf(denied.body).code).toBe('forbidden');
    const missing = await lifecycle(accountId, 'reactivate', admin, nextKey(), {}).expect(400);
    expect(errorOf(missing.body).code).toBe('reason_required');
    const short = await lifecycle(accountId, 'reactivate', admin, nextKey(), { reason: 'abc' });
    expect(short.status).toBe(400);
    expect(errorOf(short.body).code).toBe('validation_failed');
    expect(await accountRow(accountId)).toMatchObject({ status: 'suspended' });
  });
});
