import { randomBytes } from 'node:crypto';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { insertAccount } from './identity-fixtures.js';
import type { StaffApp } from './staff-sessions.js';
import { startStaffApp } from './staff-sessions.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-12 item B over HTTP with real sessions (plan 2.2, 2.3, 2.14): the account with its limits
// over the defaults and the usage counted now; the settings over their defaults; the PATCH merge
// with its audit row, the idempotent replay and the rules beyond the contract; the permissions of
// roles.yaml; `second_factor_required` asked at the next sign-in.

const signing = testSigningKey();
const config = integrationConfig({
  AUTH_SIGNING_KEY_ID: signing.keyId,
  AUTH_SIGNING_KEY: signing.key,
  CREDENTIALS_KEYS: `account:${randomBytes(32).toString('base64')}`,
  CREDENTIALS_ACTIVE_KEY_ID: 'account',
  TRUST_PROXY_HOPS: '1',
});

const getAccount = operationSchemas.getAccount;
const getSettings = operationSchemas.getAccountSettings;
const updateSettings = operationSchemas.updateAccountSettings;
/** An error body through the contract's `Error` schema. */
const errorOf = (body: unknown) => updateSettings.responses['4XX'].parse(body);

/** `Idempotency-Key` values in the nil pattern (gitleaks, PLAT-8 leg 3 trap). */
let keySequence = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keySequence).padStart(12, '0')}`;

describe('the account doors over HTTP (PLAT-12 item B)', () => {
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

  const read = (cookie: string, path: string) =>
    staff.http().get(path).set('Cookie', cookie).set('Accept-Language', 'en');
  const patch = (cookie: string, body: unknown, key = nextKey()) =>
    staff
      .http()
      .patch('/v1/staff/account/settings')
      .set(staff.writeHeaders())
      .set('Cookie', cookie)
      .set('Idempotency-Key', key)
      .send(body as object);

  async function insertSite(accountId: string, status: 'active' | 'inactive'): Promise<void> {
    await owner`
      INSERT INTO core_sites (id, account_id, kind, name_ar, name_en, status)
      VALUES (${uuidv7()}, ${accountId}, 'branch', 'فرع', 'Branch', ${status})`;
  }

  describe('getAccount', () => {
    it('presents the token account with the limits over their defaults and the usage counted now', async () => {
      const accountId = await insertAccount(owner, { name: 'Riyadh Foods' });
      await owner`UPDATE core_accounts SET limits = '{"sites": 2}'::jsonb WHERE id = ${accountId}`;
      await insertSite(accountId, 'active');
      await insertSite(accountId, 'active');
      await insertSite(accountId, 'inactive');
      await owner`
        INSERT INTO core_usage_counters (account_id, metric, period, value) VALUES
          (${accountId}, 'orders',
           date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh')::date, 7),
          (${accountId}, 'orders',
           (date_trunc('month', now() AT TIME ZONE 'Asia/Riyadh') - interval '1 month')::date, 99)`;
      const other = await insertAccount(owner);
      await insertSite(other, 'active');
      const viewer = await staff.member(accountId, ['viewer']);

      const response = await read(viewer.cookie, '/v1/staff/account').expect(200);
      const account = getAccount.responses['200'].parse(response.body);
      expect(account).toMatchObject({
        id: accountId,
        name: 'Riyadh Foods',
        country: 'SA',
        default_locale: 'ar',
        timezone: 'Asia/Riyadh',
        status: 'active',
        limits: { orders_per_month: 5000, drivers: 25, sites: 2, api_keys: 5 },
        usage: { orders_per_month: 7, drivers: 0, sites: 2, api_keys: 0 },
      });
      expect(response.body).not.toHaveProperty('provisioned_by');
    });

    it('takes no account from the query and answers 403 to a role without core.account.read', async () => {
      const accountId = await insertAccount(owner);
      const viewer = await staff.member(accountId, ['viewer']);
      const refused = await read(viewer.cookie, `/v1/staff/account?account_id=${uuidv7()}`).expect(
        400,
      );
      expect(errorOf(refused.body).details?.fields).toEqual([
        expect.objectContaining({ pointer: '/query/account_id', code: 'invalid' }),
      ]);
      const siteStaff = await staff.member(accountId, ['site_staff'], { siteIds: [uuidv7()] });
      const denied = await read(siteStaff.cookie, '/v1/staff/account').expect(403);
      expect(errorOf(denied.body).code).toBe('forbidden');
    });
  });

  describe('getAccountSettings', () => {
    it('reads the defaults for an account that set nothing', async () => {
      const accountId = await insertAccount(owner);
      const dispatcher = await staff.member(accountId, ['dispatcher']);
      const response = await read(dispatcher.cookie, '/v1/staff/account/settings').expect(200);
      expect(getSettings.responses['200'].parse(response.body)).toEqual({
        intake_rule: 'receive_as_pending',
        max_attempts: 3,
        proof_policy: { delivery: [], cod: [] },
        reason_codes: [],
        auto_dispatch: { enabled: false },
        second_factor_required: false,
        allowed_cod_methods: ['cash'],
        embed_origins: [],
        offline_window_hours: 12,
      });
    });
  });

  describe('updateAccountSettings', () => {
    it('merges the sent fields only, audits the changed keys and moves the version', async () => {
      const accountId = await insertAccount(owner);
      const admin = await staff.member(accountId, ['admin']);
      const first = await patch(admin.cookie, { intake_rule: 'auto_accept', max_attempts: 5 });
      expect(first.status).toBe(200);
      expect(updateSettings.responses['200'].parse(first.body)).toMatchObject({
        intake_rule: 'auto_accept',
        max_attempts: 5,
        offline_window_hours: 12,
      });
      const [firstAudit, ...more] = await auditRowsOf(owner, first.headers['x-request-id'] ?? '');
      expect(more).toEqual([]);
      expect(firstAudit).toMatchObject({
        actorType: 'user',
        actorId: admin.userId,
        accountId,
        targetType: 'account',
        targetId: accountId,
        action: 'core.account.settings_updated',
        before: { intake_rule: 'receive_as_pending', max_attempts: 3 },
        after: { intake_rule: 'auto_accept', max_attempts: 5 },
      });

      // The contract's schema fills max_attempts with 3 when absent; the stored 5 must stay.
      const second = await patch(admin.cookie, {
        offline_window_hours: 24,
        reason_codes: [{ code: 'no_answer', label_ar: 'لم يرد', label_en: 'No answer' }],
      });
      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({ max_attempts: 5, offline_window_hours: 24 });
      const [secondAudit] = await auditRowsOf(owner, second.headers['x-request-id'] ?? '');
      expect(secondAudit?.before).toEqual({ offline_window_hours: 12, reason_codes: [] });
      const [stored] = await owner<{ settings: unknown; version: number }[]>`
        SELECT settings, version FROM core_accounts WHERE id = ${accountId}`;
      expect(stored).toEqual({
        settings: {
          intake_rule: 'auto_accept',
          max_attempts: 5,
          offline_window_hours: 24,
          reason_codes: [{ code: 'no_answer', label_ar: 'لم يرد', label_en: 'No answer' }],
        },
        version: 3,
      });
      const reread = await read(admin.cookie, '/v1/staff/account/settings').expect(200);
      expect(reread.body).toEqual(second.body);
    });

    it('replays a retried key without a second write and refuses the key with another body', async () => {
      const accountId = await insertAccount(owner);
      const owning = await staff.member(accountId, ['owner']);
      const key = nextKey();
      const first = await patch(owning.cookie, { max_attempts: 4 }, key).expect(200);
      const replay = await patch(owning.cookie, { max_attempts: 4 }, key).expect(200);
      expect(replay.body).toEqual(first.body);
      expect(await auditRowsOf(owner, replay.headers['x-request-id'] ?? '')).toEqual([]);
      const [row] = await owner<{ version: number }[]>`
        SELECT version FROM core_accounts WHERE id = ${accountId}`;
      expect(row?.version).toBe(2);
      const reused = await patch(owning.cookie, { max_attempts: 6 }, key).expect(422);
      expect(errorOf(reused.body).code).toBe('idempotency_key_reused');
    });

    it('writes nothing for a patch that changes nothing', async () => {
      const accountId = await insertAccount(owner);
      const owning = await staff.member(accountId, ['owner']);
      const response = await patch(owning.cookie, { max_attempts: 3 }).expect(200);
      expect(await auditRowsOf(owner, response.headers['x-request-id'] ?? '')).toEqual([]);
      const [row] = await owner<{ version: number; settings: unknown }[]>`
        SELECT version, settings FROM core_accounts WHERE id = ${accountId}`;
      expect(row).toEqual({ version: 1, settings: {} });
    });

    it('refuses null, the reason-code rules and a digital COD method, writing nothing', async () => {
      const accountId = await insertAccount(owner);
      const owning = await staff.member(accountId, ['owner']);
      const fieldsOf = async (body: unknown) => {
        const response = await patch(owning.cookie, body).expect(400);
        const error = errorOf(response.body);
        expect(error.code).toBe('validation_failed');
        return (error.details?.fields as { pointer: string; code: string }[]).map(
          ({ pointer, code }) => ({ pointer, code }),
        );
      };
      expect(await fieldsOf({ max_attempts: null })).toEqual([
        { pointer: '/body/max_attempts', code: 'invalid' },
      ]);
      expect(
        await fieldsOf({
          reason_codes: [
            { code: 'late', label_ar: 'متأخر', label_en: 'Late' },
            { code: 'late', label_ar: '', label_en: 'Late again' },
          ],
        }),
      ).toEqual([
        { pointer: '/body/reason_codes/1/code', code: 'invalid' },
        { pointer: '/body/reason_codes/1/label_ar', code: 'too_short' },
      ]);
      const gate = await patch(owning.cookie, { allowed_cod_methods: ['cash', 'card'] }).expect(
        400,
      );
      expect(errorOf(gate.body).details?.fields).toEqual([
        {
          pointer: '/body/allowed_cod_methods',
          code: 'owner_gate',
          message: 'This option is not available yet.',
        },
      ]);
      const [row] = await owner<{ version: number }[]>`
        SELECT version FROM core_accounts WHERE id = ${accountId}`;
      expect(row?.version).toBe(1);
    });

    it('answers 403 to a role without core.account.manage', async () => {
      const accountId = await insertAccount(owner);
      const dispatcher = await staff.member(accountId, ['dispatcher']);
      const denied = await patch(dispatcher.cookie, { max_attempts: 4 }).expect(403);
      expect(errorOf(denied.body).code).toBe('forbidden');
    });

    it('asks for the second factor at the next sign-in once second_factor_required is set', async () => {
      const accountId = await insertAccount(owner);
      const owning = await staff.member(accountId, ['owner']);
      const colleague = await staff.member(accountId, ['dispatcher']);
      const before = await staff.login(colleague.email);
      expect(before.body).toMatchObject({ enrolment_required: false });
      expect(before.body).toHaveProperty('me.user');
      await patch(owning.cookie, { second_factor_required: true }).expect(200);
      // No factor enrolled: the login answers with the enrolment step and starts no session.
      const next = await staff.login(colleague.email);
      expect(next.status).toBe(200);
      expect(next.body).toMatchObject({ enrolment_required: true, me: null });
      expect(next.headers['set-cookie']).toBeUndefined();
    });
  });
});
