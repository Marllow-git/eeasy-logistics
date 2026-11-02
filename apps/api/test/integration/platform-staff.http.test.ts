import { randomBytes } from 'node:crypto';
import { operationSchemas, schemas } from '@eeasy-logistics/contracts/platform/schemas';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { freshEmail } from './identity-fixtures.js';
import { latestMail, mailpitMessage, sendMailRow } from './mail-delivery.js';
import type { SignedInPlatformStaff } from './platform-sessions.js';
import { platformStaff, platformWriteHeaders } from './platform-sessions.js';
import type { StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-13 item G over HTTP (plan 2.9, 2.11, 2.12; identity and tenancy §3.3): super admins list,
// invite, re-role and TOTP-reset platform staff. Super-admin rights come only from a super admin,
// nobody changes or resets themselves, a role change and a reset end the target's sessions, the
// reset mails a notice without a link in the user's language, and the next `platformLogin` asks for
// an enrolment. No response, audit row or mail carries TOTP material. Real platform sessions.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `staff-doors:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'staff-doors',
  TRUST_PROXY_HOPS: '1',
});

const listOp = operationSchemas.platformListStaffUsers;
const errorOf = (body: unknown) => listOp.responses['4XX'].parse(body);
const parseUser = (body: unknown) => schemas.PlatformInviteStaff201Response.parse(body);

let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

describe('platform staff doors over HTTP (PLAT-13 item G)', () => {
  let staff: StaffApp;
  let owner: postgres.Sql;
  let superAdmin: SignedInPlatformStaff;

  const get = (path: string, who: SignedInPlatformStaff = superAdmin) =>
    staff.http().get(path).set('Cookie', who.cookie).set('Accept-Language', 'en');
  const write = (
    method: 'post' | 'put',
    path: string,
    body: Record<string, unknown>,
    who: SignedInPlatformStaff = superAdmin,
    key = nextKey(),
  ) =>
    staff
      .http()
      [method](path)
      .set(platformWriteHeaders(config))
      .set('Cookie', who.cookie)
      .set('Idempotency-Key', key)
      .send(body);
  const invite = (body: Record<string, unknown>, who = superAdmin, key = nextKey()) =>
    write('post', '/v1/platform/staff-users/invitations', body, who, key);
  const setRoles = (userId: string, roles: string[], who = superAdmin) =>
    write('put', `/v1/platform/staff-users/${userId}/roles`, { roles }, who);
  const resetTotp = (userId: string, reason: string, who = superAdmin, key = nextKey()) =>
    write('post', `/v1/platform/staff-users/${userId}/totp/reset`, { reason }, who, key);
  const refresh = (who: SignedInPlatformStaff) =>
    staff
      .http()
      .post('/v1/platform/auth/refresh')
      .set(platformWriteHeaders(config))
      .set('Cookie', who.cookie);
  const login = (who: SignedInPlatformStaff) =>
    staff
      .http()
      .post('/v1/platform/auth/login')
      .set(platformWriteHeaders(config))
      .send({ email: who.email, password: who.password });

  /** Every staff page, followed to the end, as `PlatformUser`s. */
  async function everyStaffUser(): Promise<ReturnType<typeof parseUser>[]> {
    const users: ReturnType<typeof parseUser>[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
      const response = await get(`/v1/platform/staff-users?limit=100&sort=name${query}`).expect(
        200,
      );
      const page = listOp.responses['200'].parse(response.body);
      users.push(...((page.data ?? []) as unknown[]).map(parseUser));
      cursor = page.next_cursor ?? null;
    } while (cursor !== null);
    return users;
  }

  async function staffRow(userId: string) {
    const [row] = await owner<
      { role: string; revoked: boolean; enrolled: boolean; token_version: number }[]
    >`SELECT s.role, s.revoked_at IS NOT NULL AS revoked,
             s.totp_secret_ciphertext IS NOT NULL AS enrolled, u.token_version
      FROM core_platform_staff s JOIN core_users u ON u.id = s.user_id
      WHERE s.user_id = ${userId}`;
    return row;
  }

  beforeAll(async () => {
    owner = connectAs('owner', config);
    staff = await startStaffApp(config, owner);
    superAdmin = await platformStaff(staff.app, config, owner, 'super_admin');
  });

  afterAll(async () => {
    await staff?.close();
    await owner?.end();
  });

  it('lists staff with their role and enrolment, revoked ones with no role; admins are refused', async () => {
    const admin = await platformStaff(staff.app, config, owner, 'admin');
    const revoked = await platformStaff(staff.app, config, owner, 'support');
    await setRoles(revoked.userId, []).expect(200);
    const users = await everyStaffUser();
    expect(users.find((user) => user.id === superAdmin.userId)).toMatchObject({
      email: superAdmin.email,
      roles: ['platform_super_admin'],
      totp_enrolled: true,
    });
    expect(users.find((user) => user.id === revoked.userId)).toMatchObject({ roles: [] });
    expect(JSON.stringify(users)).not.toMatch(/secret|otpauth|ciphertext/i);
    const denied = await get('/v1/platform/staff-users', admin).expect(403);
    expect(errorOf(denied.body).code).toBe('forbidden');
  });

  it('invites: one role, a super admin by a super admin, the console mail; refuses live staff and admins', async () => {
    const email = freshEmail('invited-super');
    const key = nextKey();
    const response = await invite(
      { email, name: 'Invited Super', roles: ['platform_super_admin'] },
      superAdmin,
      key,
    ).expect(201);
    const user = parseUser(response.body);
    expect(user).toMatchObject({
      email,
      name: 'Invited Super',
      roles: ['platform_super_admin'],
      totp_enrolled: false,
    });
    const replay = await invite(
      { email, name: 'Invited Super', roles: ['platform_super_admin'] },
      superAdmin,
      key,
    ).expect(201);
    expect(replay.body).toEqual(response.body);
    const invitations = await owner`
      SELECT 1 FROM core_invitations WHERE email = ${email} AND kind = 'platform'`;
    expect(invitations).toHaveLength(1);
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.find((row) => row.action === 'core.platform_staff.invited')).toMatchObject({
      actorId: superAdmin.userId,
      accountId: null,
      targetId: user.id,
      after: { role: 'platform_super_admin', email },
    });
    const mail = await latestMail(owner, email, 'platform_invitation');
    if (mail === undefined) throw new Error('no platform invitation mail');
    await sendMailRow(config, mail.id);
    const delivered = await mailpitMessage(`${mail.id}@eeasy-logistics`);
    expect(delivered.Text).toContain('/invitations/');

    const two = await invite({
      email: freshEmail('two-roles'),
      name: 'Two Roles',
      roles: ['platform_admin', 'platform_support'],
    }).expect(400);
    expect(JSON.stringify(errorOf(two.body).details?.fields)).toContain('/body/roles');
    const live = await invite({
      email: superAdmin.email,
      name: 'Again',
      roles: ['platform_admin'],
    }).expect(409);
    expect(errorOf(live.body).code).toBe('invalid_transition');
    const admin = await platformStaff(staff.app, config, owner, 'admin');
    const byAdmin = await invite(
      { email: freshEmail('by-admin'), name: 'By Admin', roles: ['platform_super_admin'] },
      admin,
    ).expect(403);
    expect(errorOf(byAdmin.body).code).toBe('forbidden');
  });

  it('sets roles under audit, never on oneself; a change ends the sessions; revoke and re-grant', async () => {
    const self = await setRoles(superAdmin.userId, ['platform_admin']).expect(403);
    expect(errorOf(self.body).code).toBe('forbidden');
    const target = await platformStaff(staff.app, config, owner, 'admin');
    const response = await setRoles(target.userId, ['platform_support']).expect(200);
    expect(parseUser(response.body)).toMatchObject({
      id: target.userId,
      roles: ['platform_support'],
      totp_enrolled: true,
    });
    expect(await staffRow(target.userId)).toMatchObject({ role: 'support', revoked: false });
    const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
    expect(audit.find((row) => row.action === 'core.platform_staff.roles_changed')).toMatchObject({
      actorId: superAdmin.userId,
      targetId: target.userId,
      before: { roles: ['platform_admin'] },
      after: { roles: ['platform_support'], sessions_ended: 1 },
    });
    await refresh(target).expect(401);

    // An unchanged role writes nothing.
    const same = await setRoles(target.userId, ['platform_support']).expect(200);
    const quiet = await auditRowsOf(owner, String(same.headers['x-request-id']));
    expect(quiet.map((row) => row.action)).not.toContain('core.platform_staff.roles_changed');

    // Revoke: no role, the row revoked, no sign-in; a re-grant brings the role back without TOTP.
    const revoked = await setRoles(target.userId, []).expect(200);
    expect(parseUser(revoked.body)).toMatchObject({ roles: [] });
    expect(await staffRow(target.userId)).toMatchObject({ revoked: true });
    expect((await login(target)).status).not.toBe(200);
    const regranted = await setRoles(target.userId, ['platform_admin']).expect(200);
    expect(parseUser(regranted.body)).toMatchObject({
      roles: ['platform_admin'],
      totp_enrolled: false,
    });

    // Another super admin can be demoted while one is left; an unknown user is 404.
    const other = await platformStaff(staff.app, config, owner, 'super_admin');
    await setRoles(other.userId, ['platform_admin']).expect(200);
    const unknown = await setRoles('019a0000-0000-7000-8000-00000000beef', []).expect(404);
    expect(errorOf(unknown.body).code).toBe('not_found');
    const tooMany = await setRoles(target.userId, ['platform_admin', 'platform_support']).expect(
      400,
    );
    expect(errorOf(tooMany.body).code).toBe('validation_failed');
  });

  it('resets a TOTP: sessions end, the next login asks for enrolment, the notice in both locales', async () => {
    const self = await resetTotp(superAdmin.userId, 'Lost my phone').expect(403);
    expect(errorOf(self.body).code).toBe('forbidden');
    for (const locale of ['en', 'ar'] as const) {
      const target = await platformStaff(staff.app, config, owner, 'support');
      await owner`UPDATE core_users SET locale = ${locale} WHERE id = ${target.userId}`;
      const before = await staffRow(target.userId);
      const reason = `Ticket 5521: phone lost (${locale})`;
      const key = nextKey();
      const response = await resetTotp(target.userId, reason, superAdmin, key).expect(204);
      await resetTotp(target.userId, reason, superAdmin, key).expect(204);
      expect(await staffRow(target.userId)).toMatchObject({
        enrolled: false,
        token_version: (before?.token_version ?? 0) + 1,
      });
      await refresh(target).expect(401);
      const challenge = await login(target).expect(200);
      expect(challenge.body).toMatchObject({ totp_enrolment_required: true });

      const audit = await auditRowsOf(owner, String(response.headers['x-request-id']));
      const row = audit.find((entry) => entry.action === 'core.platform_staff.totp_reset');
      expect(row).toMatchObject({
        actorId: superAdmin.userId,
        targetId: target.userId,
        reason,
        after: { sessions_ended: 1, was_enrolled: true },
      });
      expect(JSON.stringify(audit)).not.toMatch(/secret|otpauth|ciphertext/i);

      const mail = await latestMail(owner, target.email, 'platform_totp_reset');
      if (mail === undefined) throw new Error('no TOTP reset mail');
      expect(mail.payload).toMatchObject({ locale, params: {} });
      await sendMailRow(config, mail.id);
      const delivered = await mailpitMessage(`${mail.id}@eeasy-logistics`);
      expect(delivered.Subject).toContain(locale === 'ar' ? 'المصادقة' : 'authenticator');
      expect(delivered.Text).not.toMatch(/https?:\/\//);
    }
    const target = await platformStaff(staff.app, config, owner, 'support');
    const short = await resetTotp(target.userId, 'abc').expect(400);
    expect(errorOf(short.body).code).toBe('validation_failed');
    const unknown = await resetTotp(
      '019a0000-0000-7000-8000-00000000cafe',
      'No such person',
    ).expect(404);
    expect(errorOf(unknown.body).code).toBe('not_found');
  });
});
