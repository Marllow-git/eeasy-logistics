import { randomBytes } from 'node:crypto';
import type { AuditLogEntry } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas as platformOperations } from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas as staffOperations } from '@eeasy-logistics/contracts/staff/schemas';
import { uuidv7 } from '@eeasy-logistics/db';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { CursorCodec, cursorHmacKey } from '../../src/modules/kernel/audit/cursor.js';
import { platformCookie, staffCookie } from '../../src/modules/kernel/auth/principal.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import { auditRowsOf } from './audit-rows.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-7 item C on the real database: the three audit list operations through the whole request
// frame, every answer parsed with the operation's generated response schema (A-17). Rows are
// planted by the owner inside the current month's partition with known times (two share a time,
// so the id tie-breaker shows), for two accounts and the platform.

const staffList = staffOperations.listAuditLog;
const accountList = platformOperations.platformListAccountAudit;
const platformList = platformOperations.platformListAudit;

describe('audit log reads (PLAT-7 item C)', () => {
  const signing = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
  });
  const accountA = uuidv7();
  const accountB = uuidv7();
  const platformUser = uuidv7();
  // A verb of this run only, so the platform rows of other test files never mix in.
  const run = Array.from(randomBytes(6), (byte) => String.fromCharCode(97 + (byte % 26))).join('');
  const platformAction = `platform.audit_test.${run}`;
  let owner: postgres.Sql;
  let app: INestApplication<App>;
  /** Planted ids of account A, newest first by (occurred_at, id). */
  let rowsA: string[] = [];
  let monthStart = '';

  const staff = (account: string) =>
    signAccessToken(signing, 'staff', { claims: { acc: account } }).then(
      (token) => `${staffCookie}=${token}`,
    );
  const platform = () =>
    signAccessToken(signing, 'platform', { claims: { sub: platformUser } }).then(
      (token) => `${platformCookie}=${token}`,
    );
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    owner = connectAs('owner', config);
    await owner`INSERT INTO core_accounts (id, name) VALUES
      (${accountA}, 'Audit A'), (${accountB}, 'Audit B')`;
    const [month] = await owner<{ start: string }[]>`
      SELECT date_trunc('month', now() AT TIME ZONE 'UTC')::text AS start`;
    monthStart = month?.start ?? '';
    const plant = async (
      account: string | null,
      seconds: string,
      action: string,
      extra: {
        actorType?: string;
        ip?: string;
        userAgent?: string;
        reason?: string;
        after?: Record<string, string>;
      } = {},
    ) => {
      const id = uuidv7();
      await owner`
        INSERT INTO core_audit_log (id, occurred_at, actor_type, actor_id, account_id, target_type,
                                    target_id, action, after, request_id, ip, user_agent, reason)
        VALUES (${id}, (${monthStart}::text::timestamp + ${seconds}::interval) AT TIME ZONE 'UTC',
                ${extra.actorType ?? 'user'}, ${uuidv7()}, ${account}, 'site', ${`site-${seconds}`},
                ${action}, ${owner.json(extra.after ?? { n: seconds })}, ${uuidv7()},
                ${extra.ip ?? null}, ${extra.userAgent ?? null}, ${extra.reason ?? null})`;
      return id;
    };
    // Account A: five rows; two share 2 days 00:00:10.123456.
    const a1 = await plant(accountA, '2 days 00:00:01', 'core.site.created');
    const a2 = await plant(accountA, '2 days 00:00:05', 'core.site.updated');
    const a3 = await plant(accountA, '2 days 00:00:10.123456', 'core.site.updated');
    const a4 = await plant(accountA, '2 days 00:00:10.123456', 'core.site.updated');
    const a5 = await plant(accountA, '2 days 00:00:20', 'platform.cross_tenant.accessed', {
      actorType: 'platform_user',
      ip: '203.0.113.7',
      userAgent: 'support-console',
      reason: 'Ticket 1: driver run missing',
      after: {
        operation: 'PlatformAuditLogController.listAccount',
        outcome: 'ok',
        client_request_id: '01927f6e-7a2b-7c3d-8e4f-5a6b7c8d9e0f',
      },
    });
    const tied = [a3, a4].sort().reverse();
    rowsA = [a5, ...tied, a2, a1];
    await plant(accountB, '2 days 00:00:03', 'core.site.created');
    await plant(accountB, '2 days 00:00:04', 'core.site.created');
    await plant(null, '2 days 00:00:06', platformAction, { actorType: 'platform_user' });
    await plant(null, '2 days 00:00:07', platformAction, { actorType: 'platform_user' });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner?.end();
  });

  const listStaff = async (account: string, query: string, status = 200) => {
    const response = await http()
      .get(`/v1/staff/audit-log${query}`)
      .set('Cookie', await staff(account))
      .expect(status);
    return response;
  };
  const idsOf = (body: unknown): string[] =>
    (staffList.responses['200'].parse(body).data as AuditLogEntry[]).map((entry) => entry.id ?? '');

  it('lists the token account only, newest first, with the id as tie-breaker', async () => {
    const response = await listStaff(accountA, '');
    const page = staffList.responses['200'].parse(response.body);
    expect(idsOf(response.body)).toEqual(rowsA);
    expect(page.next_cursor).toBeNull();
    const ofB = await listStaff(accountB, '');
    expect(idsOf(ofB.body)).toHaveLength(2);
    expect(idsOf(ofB.body)).not.toEqual(expect.arrayContaining([rowsA[0]]));
  });

  it('keeps microseconds in occurred_at and hides platform staff detail from merchants (L-3)', async () => {
    const response = await listStaff(accountA, '');
    const entries = staffList.responses['200'].parse(response.body).data as AuditLogEntry[];
    const tied = entries.find((entry) => entry.id === rowsA[1]);
    expect(tied?.occurred_at).toMatch(/T00:00:10\.123456Z$/);
    const platformRow = entries[0];
    expect(platformRow).toMatchObject({ actor_type: 'platform_user', account_id: accountA });
    expect(platformRow).not.toHaveProperty('ip');
    expect(platformRow).not.toHaveProperty('user_agent');
    // Ruling L-3: merchants never see support reasons nor the platform's internals.
    expect(platformRow?.reason).toBeNull();
    expect(platformRow?.after).toEqual({ outcome: 'ok' });
    expect(platformRow?.actor_id).toEqual(expect.any(String));
  });

  it('refuses a cursor replayed by another account (adversary I-1)', async () => {
    const first = await listStaff(accountA, '?limit=1');
    const cursor = staffList.responses['200'].parse(first.body).next_cursor ?? '';
    expect(cursor).not.toBe('');
    const replay = await listStaff(accountB, `?limit=1&cursor=${cursor}`, 400);
    expect(staffList.responses['4XX'].parse(replay.body).details?.fields).toEqual([
      expect.objectContaining({ pointer: '/query/cursor', code: 'invalid' }),
    ]);
  });

  it('pages through the rows with stable cursors in both directions', async () => {
    for (const [sort, expected] of [
      ['-occurred_at', rowsA],
      ['occurred_at', [...rowsA].reverse()],
    ] as const) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query: string = `?limit=2&sort=${sort}${cursor === null ? '' : `&cursor=${cursor}`}`;
        const response = await listStaff(accountA, query);
        const page = staffList.responses['200'].parse(response.body);
        seen.push(...idsOf(response.body));
        cursor = page.next_cursor;
        pages += 1;
      } while (cursor !== null && pages < 10);
      expect(seen).toEqual(expected);
      expect(pages).toBe(3);
    }
  });

  it('refuses a cursor with other filters or another sort, and a tampered or expired one', async () => {
    const first = await listStaff(accountA, '?limit=2&target_type=site');
    const cursor = staffList.responses['200'].parse(first.body).next_cursor ?? '';
    expect(cursor).not.toBe('');
    const expectInvalid = async (query: string) => {
      const response = await listStaff(accountA, query, 400);
      const error = staffList.responses['4XX'].parse(response.body);
      expect(error.code).toBe('validation_failed');
      expect(error.details?.fields).toEqual([
        expect.objectContaining({ pointer: '/query/cursor', code: 'invalid' }),
      ]);
    };
    await expectInvalid(`?limit=2&target_type=depot&cursor=${cursor}`);
    await expectInvalid(`?limit=2&cursor=${cursor}`);
    await expectInvalid(`?limit=2&target_type=site&sort=occurred_at&cursor=${cursor}`);
    const [text, signature] = cursor.split('.');
    await expectInvalid(`?limit=2&target_type=site&cursor=${text}.${signature?.slice(1)}A`);
    const expired = new CursorCodec(
      cursorHmacKey(signing.key),
      () => Math.floor(Date.now() / 1000) - 25 * 60 * 60,
    ).encode(
      { occurredAt: '2026-11-03 00:00:05+00', id: rowsA[2] ?? '' },
      {
        operation: 'listAuditLog',
        principal: `account:${accountA}`,
        filters: { target_type: 'site' },
        sort: '-occurred_at',
      },
    );
    await expectInvalid(`?limit=2&target_type=site&cursor=${expired}`);
    // The same cursor with only the limit changed continues.
    const next = await listStaff(accountA, `?limit=3&target_type=site&cursor=${cursor}`);
    expect(idsOf(next.body)).toEqual(rowsA.slice(2, 5));
  });

  it('refuses a sort outside the documented list', async () => {
    const response = await listStaff(accountA, '?sort=-created_at', 400);
    expect(staffList.responses['4XX'].parse(response.body).details?.fields).toEqual([
      expect.objectContaining({ pointer: '/query/sort', code: 'invalid' }),
    ]);
  });

  it('filters on target, actor and the created_from / created_to window', async () => {
    const byTarget = await listStaff(
      accountA,
      `?target_id=${encodeURIComponent('site-2 days 00:00:05')}`,
    );
    expect(idsOf(byTarget.body)).toEqual([rowsA[3]]);
    const start = Date.parse(`${monthStart.replace(' ', 'T')}Z`) + 2 * 86_400_000;
    const from = encodeURIComponent(new Date(start + 5_000).toISOString());
    const to = encodeURIComponent(new Date(start + 20_000).toISOString());
    const window = await listStaff(accountA, `?created_from=${from}&created_to=${to}`);
    expect(idsOf(window.body)).toEqual(rowsA.slice(1, 4));
  });

  it('platformListAccountAudit reads one account through the door and audits each call', async () => {
    const response = await http()
      .get(`/v1/platform/accounts/${accountB}/audit-log`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', 'Ticket 9001')
      .expect(200);
    const page = accountList.responses['200'].parse(response.body);
    expect(page.data).toHaveLength(2);
    const rows = await auditRowsOf(owner, response.headers['x-request-id'] ?? '');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'platform.cross_tenant.accessed',
      accountId: accountB,
      actorId: platformUser,
      reason: 'Ticket 9001',
      after: { operation: 'PlatformAuditLogController.listAccount', outcome: 'ok', status: 200 },
    });
  });

  it('platformListAccountAudit shows platform staff network data to the platform', async () => {
    const response = await http()
      .get(`/v1/platform/accounts/${accountA}/audit-log?limit=1`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', 'Ticket 9002')
      .expect(200);
    const [entry] = accountList.responses['200'].parse(response.body).data as AuditLogEntry[];
    expect(entry).toMatchObject({
      id: rowsA[0],
      ip: '203.0.113.7',
      user_agent: 'support-console',
      reason: 'Ticket 1: driver run missing',
      after: { operation: 'PlatformAuditLogController.listAccount' },
    });
  });

  it('platformListAudit without account_id returns platform rows only, with no door row', async () => {
    const response = await http()
      .get(`/v1/platform/audit-log?action=${platformAction}`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', 'Weekly review')
      .expect(200);
    const entries = platformList.responses['200'].parse(response.body).data as AuditLogEntry[];
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.account_id === null)).toBe(true);
    const all = await http()
      .get('/v1/platform/audit-log?limit=200')
      .set('Cookie', await platform())
      .set('X-Support-Reason', 'Weekly review')
      .expect(200);
    const allEntries = platformList.responses['200'].parse(all.body).data as AuditLogEntry[];
    expect(allEntries.every((entry) => entry.account_id === null)).toBe(true);
    expect(await auditRowsOf(owner, response.headers['x-request-id'] ?? '')).toEqual([]);
  });

  it('platformListAudit with account_id is a door call on that account, audited', async () => {
    const response = await http()
      .get(`/v1/platform/audit-log?account_id=${accountB}`)
      .set('Cookie', await platform())
      .set('X-Support-Reason', 'Ticket 9003')
      .expect(200);
    const entries = platformList.responses['200'].parse(response.body).data as AuditLogEntry[];
    // B's two planted rows, plus the committed rows of earlier door calls on B.
    expect(entries.filter((entry) => entry.action === 'core.site.created')).toHaveLength(2);
    expect(entries.every((entry) => entry.account_id === accountB)).toBe(true);
    const rows = await auditRowsOf(owner, response.headers['x-request-id'] ?? '');
    expect(rows).toMatchObject([
      { action: 'platform.cross_tenant.accessed', accountId: accountB, reason: 'Ticket 9003' },
    ]);
  });

  it('platformListAudit with account_id and no reason is refused and audited', async () => {
    const response = await http()
      .get(`/v1/platform/audit-log?account_id=${accountB}`)
      .set('Cookie', await platform())
      .expect(400);
    expect(platformList.responses['400'].parse(response.body).code).toBe('reason_required');
    const rows = await auditRowsOf(owner, response.headers['x-request-id'] ?? '');
    expect(rows).toMatchObject([
      {
        action: 'platform.cross_tenant.refused',
        accountId: null,
        targetId: accountB,
        after: { outcome: 'reason_missing', status: 400 },
      },
    ]);
  });

  it('never takes an account from a staff request', async () => {
    const response = await listStaff(accountA, `?account_id=${accountB}`, 400);
    expect(staffList.responses['4XX'].parse(response.body).details?.fields).toEqual([
      expect.objectContaining({ pointer: '/query/account_id' }),
    ]);
  });
});
