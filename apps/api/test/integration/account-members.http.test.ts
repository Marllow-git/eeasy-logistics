import { randomBytes } from 'node:crypto';
import { operationSchemas, schemas } from '@eeasy-logistics/contracts/platform/schemas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Invitations } from '../../src/modules/kernel/auth/invitations.js';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { freshEmail, insertAccount } from './identity-fixtures.js';
import type { SignedInPlatformStaff } from './platform-sessions.js';
import { platformStaff } from './platform-sessions.js';
import type { StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-13 item F over HTTP (plan 2.8, 2.12; identity and tenancy §5, §7): platform staff read an
// account's members through the cross-tenant door. `X-Support-Reason` is required (`400
// reason_required`, one committed refusal row); a read leaves exactly one
// `platform.cross_tenant.accessed` row with the reason and writes nothing else; PLAT-12's presenter
// shows each membership's person; a closed account stays readable; a cursor of one account never
// continues in another.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `members-door:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'members-door',
  TRUST_PROXY_HOPS: '1',
});

const listOp = operationSchemas.platformListAccountMembers;
const errorOf = (body: unknown) => listOp.responses['4XX'].parse(body);
const reason = 'Ticket 9120: owner cannot find a member';

describe('platformListAccountMembers over HTTP (PLAT-13 item F)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  let support: SignedInPlatformStaff;

  const list = (accountId: string, query = '', withReason: string | null = reason) => {
    const call = staff
      .http()
      .get(`/v1/platform/accounts/${accountId}/members${query}`)
      .set('Cookie', support.cookie)
      .set('Accept-Language', 'en');
    return withReason === null ? call : call.set('X-Support-Reason', withReason);
  };
  const page = (body: unknown) => {
    const parsed = listOp.responses['200'].parse(body);
    const items = (parsed.data ?? []) as unknown[];
    return {
      data: items.map((item) => schemas.PlatformInviteOwner201Response.parse(item)),
      next: parsed.next_cursor,
    };
  };

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
    support = await platformStaff(staff.app, config, owner, 'support');
  });

  afterAll(async () => {
    await staff?.close();
    await owner?.end();
  });

  it('refuses without the reason: 400 reason_required and one committed refusal row', async () => {
    const accountId = await insertAccount(owner);
    const response = await list(accountId, '', null).expect(400);
    expect(errorOf(response.body).code).toBe('reason_required');
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit).toMatchObject([
      {
        action: 'platform.cross_tenant.refused',
        accountId: null,
        targetId: accountId,
        after: { outcome: 'reason_missing' },
      },
    ]);
  });

  it('lists the members with the person each shows; one door row with the reason, nothing else', async () => {
    const accountId = await insertAccount(owner, {
      name: `Members ${randomBytes(3).toString('hex')}`,
    });
    const active = await staff.member(accountId, ['owner']);
    const invitee = freshEmail('invitee');
    await staff.app.get(Invitations, { strict: false }).createStaff({
      accountId,
      email: invitee,
      name: 'Invited Viewer',
      roles: ['viewer'],
      siteIds: [],
      invitedBy: active.userId,
      locale: 'en',
    });
    const outboxBefore = await owner<{ count: number }[]>`
      SELECT count(*)::int AS count FROM core_outbox WHERE account_id = ${accountId}`;

    const response = await list(accountId).expect(200);
    const { data, next } = page(response.body);
    expect(next).toBeNull();
    expect(data.map((member) => member.status).sort()).toEqual(['active', 'invited']);
    expect(data.find((member) => member.status === 'invited')).toMatchObject({
      roles: ['viewer'],
      user: { email: invitee, name: 'Invited Viewer', phone: null },
    });
    expect(data.find((member) => member.status === 'active')).toMatchObject({
      id: active.membershipId,
      roles: ['owner'],
      user: { id: active.userId, email: active.email },
    });

    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit).toMatchObject([
      {
        action: 'platform.cross_tenant.accessed',
        actorType: 'platform_user',
        actorId: support.userId,
        accountId,
        targetId: accountId,
        reason,
        after: { outcome: 'ok', status: 200 },
      },
    ]);
    const outboxAfter = await owner<{ count: number }[]>`
      SELECT count(*)::int AS count FROM core_outbox WHERE account_id = ${accountId}`;
    expect(outboxAfter).toEqual(outboxBefore);
  });

  it('pages with a cursor bound to the account; a closed account stays readable', async () => {
    const accountId = await insertAccount(owner);
    const other = await insertAccount(owner);
    await staff.member(accountId, ['owner']);
    await staff.member(accountId, ['admin']);
    await staff.member(other, ['owner']);
    await staff.member(other, ['admin']);
    const first = page((await list(accountId, '?limit=1&sort=created_at').expect(200)).body);
    expect(first.data).toHaveLength(1);
    expect(first.next).not.toBeNull();
    const cursor = encodeURIComponent(first.next ?? '');
    const second = page(
      (await list(accountId, `?limit=1&sort=created_at&cursor=${cursor}`).expect(200)).body,
    );
    expect(second.data).toHaveLength(1);
    expect(second.data[0]?.id).not.toBe(first.data[0]?.id);
    const elsewhere = await list(other, `?limit=1&sort=created_at&cursor=${cursor}`).expect(400);
    expect(errorOf(elsewhere.body).code).toBe('validation_failed');

    await owner`UPDATE core_accounts SET status = 'closed', closed_at = now() WHERE id = ${accountId}`;
    const closed = page((await list(accountId).expect(200)).body);
    expect(closed.data).toHaveLength(2);
  });

  it('answers 404 for an unknown account, with a committed refusal row', async () => {
    const response = await list('019a0000-0000-7000-8000-00000000f00d').expect(404);
    expect(errorOf(response.body).code).toBe('not_found');
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit).toMatchObject([
      { action: 'platform.cross_tenant.refused', after: { outcome: 'not_found' } },
    ]);
  });
});
