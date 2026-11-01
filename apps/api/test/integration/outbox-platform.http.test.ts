import { randomBytes, randomUUID } from 'node:crypto';
import type { OutboxRow } from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool, withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { platformCookie, staffCookie } from '../../src/modules/kernel/auth/principal.js';
import { nextOutboxId } from '../../src/modules/kernel/outbox/outbox-id.js';
import { replayBulk } from '../../src/modules/kernel/outbox/outbox-replay.js';
import {
  OUTBOX_QUEUES,
  OutboxQueues,
  outboxQueueName,
} from '../../src/modules/kernel/outbox/queues.js';
import {
  PlatformOutbox,
  platformReplayStore,
} from '../../src/modules/kernel/platform/outbox.repository.js';
import type { OutboxKind } from '../../src/modules/kernel/schema/outbox.js';
import { pruneOutbox, runOutboxPrune } from '../../src/worker/system/outbox-prune.js';
import { signAccessToken, testSigningKey } from '../support/access-tokens.js';
import { webClientHeaders } from '../support/web-client.js';
import { auditRowsOf } from './audit-rows.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-8 item G on the real database and Redis: the five platform outbox operations through the
// whole request frame (every answer parsed with the operation's generated response schema, A-17),
// the replay rules and audit rows, then the pruning job (last: it deletes old rows across accounts,
// and only this file plants old rows). Kinds `webhook` and `channel_publish` are written by no
// other suite; `internal_event` rows here use fresh aggregates. Redis keys of this run live under
// their own prefix and are deleted afterwards.

const listOp = operationSchemas.platformListOutbox;
const getOp = operationSchemas.platformGetOutboxRow;
const replayOp = operationSchemas.platformReplayOutboxRow;
const bulkOp = operationSchemas.platformReplayDeadOutbox;
const consumersOp = operationSchemas.platformListConsumers;
const kernelConsumer = 'kernel.account_suspended_log';

const letters = (n: number) =>
  Array.from(randomBytes(n), (byte) => String.fromCharCode(97 + (byte % 26))).join('');

interface Plant {
  readonly account: string | null;
  readonly status?: string;
  readonly kind?: OutboxKind;
  readonly type?: string;
  readonly aggregateId?: string;
  readonly sequence?: number;
  readonly ageDays?: number;
  readonly ageSeconds?: number;
  readonly supersedeKey?: string | null;
  readonly lastError?: string | null;
  readonly attempts?: number;
  readonly parkedConsumers?: string[] | null;
}

interface Stored {
  status: string;
  attempts: number;
  next_attempt_at: Date;
  enqueued_at: Date | null;
  last_error: string | null;
}

describe('platform outbox operations (PLAT-8 item G)', () => {
  const signing = testSigningKey();
  const config = integrationConfig({
    AUTH_SIGNING_KEY_ID: signing.keyId,
    AUTH_SIGNING_KEY: signing.key,
  });
  const run = letters(8);
  const prefix = `elx-test-${randomBytes(4).toString('hex')}`;
  const accountA = uuidv7();
  const accountB = uuidv7();
  const platformUser = uuidv7();
  const secret = `payload-secret-${run}`;
  const bulkType = `test.outbox_${run}.replayed`;
  const reason = 'Ticket 42: replay after the fix';
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;
  let redis: Redis;
  let queues: OutboxQueues;
  let app: INestApplication<App>;

  const plant = async (o: Plant): Promise<string> => {
    const id = nextOutboxId();
    const age = `${o.ageDays ?? 0} days ${o.ageSeconds ?? 0} seconds`;
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind, status, attempts, last_error,
                               supersede_key, created_at, enqueued_at, parked_consumers)
      VALUES (${id}, ${o.type ?? 'core.account.suspended'}, 1, ${o.account}, 'account',
              ${o.aggregateId ?? uuidv7()}, ${o.sequence ?? 1}, ${owner.json({ note: secret })},
              ${o.kind ?? 'webhook'}, ${o.status ?? 'dead'}, ${o.attempts ?? 5},
              ${o.lastError === undefined ? '500 endpoint failed' : o.lastError},
              ${o.supersedeKey ?? null}, now() - ${age}::interval, now() - ${age}::interval,
              ${o.parkedConsumers === undefined || o.parkedConsumers === null ? null : owner.array(o.parkedConsumers)})`;
    return id;
  };
  const stored = async (id: string) =>
    (
      await owner<Stored[]>`
        SELECT status, attempts, next_attempt_at, enqueued_at, last_error
        FROM core_outbox WHERE id = ${id}`
    )[0];
  let platform = '';
  const http = () => request(app.getHttpServer());
  const get = (path: string, headers: Record<string, string> = { 'X-Support-Reason': reason }) =>
    http().get(path).set('Cookie', platform).set(headers);
  const post = (
    path: string,
    body: object,
    headers: Record<string, string> = {},
    key: string = randomUUID(),
  ) =>
    http()
      .post(path)
      .set('Cookie', platform)
      .set(webClientHeaders(config, 'platform'))
      .set('Idempotency-Key', key)
      .set(headers)
      .send(body);
  const pageOf = (body: unknown) => {
    const page = listOp.responses['200'].parse(body);
    return { data: page.data as OutboxRow[], next_cursor: page.next_cursor };
  };
  const rowsOf = (body: unknown) => pageOf(body).data;
  const errorOf = (body: unknown) => listOp.responses['4XX'].parse(body);
  const requestIdOf = (response: request.Response) => String(response.headers['x-request-id']);
  /** The audit rows of a request by action (rows of one transaction share `occurred_at`). */
  const auditOf = async (response: request.Response) =>
    (await auditRowsOf(owner, requestIdOf(response))).sort((a, b) =>
      a.action.localeCompare(b.action),
    );

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'outbox-platform-test');
    const token = await signAccessToken(signing, 'platform', { claims: { sub: platformUser } });
    platform = `${platformCookie}=${token}`;
    await owner`INSERT INTO core_accounts (id, name) VALUES
      (${accountA}, 'Outbox A'), (${accountB}, 'Outbox B')`;
    const url = config.redis.url?.reveal();
    if (url === undefined) throw new Error('REDIS_URL is needed for this suite');
    redis = new Redis(url, { maxRetriesPerRequest: null });
    queues = new OutboxQueues(redis, prefix);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    })
      .overrideProvider(OUTBOX_QUEUES)
      .useValue(queues)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await owner`DELETE FROM core_outbox WHERE account_id IN (${accountA}, ${accountB})
                 OR type = ${bulkType} OR payload->>'note' = ${secret}`;
    await owner`DELETE FROM core_consumer_dead_letters WHERE account_id IN (${accountA}, ${accountB})`;
    await owner`DELETE FROM core_consumer_receipts WHERE account_id IN (${accountA}, ${accountB})`;
    // The accounts keep their audit rows (FK, K-7): they are left, like the audit suites do.
    await queues?.close();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}:*`, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
    redis?.disconnect();
    await Promise.all([owner?.end(), pool?.close()]);
  });

  describe('platformListOutbox', () => {
    const aggregate = uuidv7();
    let rowA = '';
    let rowB = '';
    let rowPlatform = '';

    beforeAll(async () => {
      rowA = await plant({
        account: accountA,
        aggregateId: aggregate,
        sequence: 1,
        supersedeKey: 'k-a',
      });
      rowB = await plant({ account: accountB, aggregateId: aggregate, sequence: 2 });
      rowPlatform = await plant({
        account: null,
        aggregateId: aggregate,
        sequence: 3,
        kind: 'storage_lifecycle',
      });
    });

    it('without account_id: rows of every account, metadata only, no payload, no door', async () => {
      const response = await get(`/v1/platform/outbox?aggregate_id=${aggregate}`).expect(200);
      const page = pageOf(response.body);
      expect(page.data.map((row) => row.id)).toEqual([rowPlatform, rowB, rowA]);
      expect(page.data.map((row) => row.account_id)).toEqual([null, accountB, accountA]);
      for (const row of page.data) {
        expect(row).not.toHaveProperty('envelope');
        expect(row).not.toHaveProperty('last_error');
        expect(row).not.toHaveProperty('supersede_key');
        expect(row).toMatchObject({ status: 'dead', attempts: 5 });
      }
      expect(JSON.stringify(response.body)).not.toContain(secret);
      expect(page.next_cursor).toBeNull();
      expect(await auditOf(response)).toEqual([]);
    });

    it('with account_id: that account only, through the door, payload included, audited', async () => {
      const response = await get(
        `/v1/platform/outbox?aggregate_id=${aggregate}&account_id=${accountA}`,
      ).expect(200);
      const page = pageOf(response.body);
      expect(page.data.map((row) => row.id)).toEqual([rowA]);
      expect(page.data[0]?.envelope).toMatchObject({
        id: rowA,
        account_id: accountA,
        aggregate_id: aggregate,
        sequence: 1,
        payload: { note: secret },
      });
      expect(page.data[0]).toMatchObject({
        last_error: '500 endpoint failed',
        supersede_key: 'k-a',
      });
      const audit = await auditOf(response);
      expect(audit.map((row) => [row.action, row.accountId, row.reason])).toEqual([
        ['platform.cross_tenant.accessed', accountA, reason],
      ]);
    });

    it('refuses the door without X-Support-Reason (400 reason_required, audited)', async () => {
      const response = await get(`/v1/platform/outbox?account_id=${accountA}`, {}).expect(400);
      expect(response.body).toMatchObject({ code: 'reason_required' });
    });

    it('pages with a cursor bound to the filters; checks status and sort', async () => {
      const first = await get(`/v1/platform/outbox?aggregate_id=${aggregate}&limit=2`).expect(200);
      const page1 = pageOf(first.body);
      expect(page1.data.map((row) => row.id)).toEqual([rowPlatform, rowB]);
      const cursor = page1.next_cursor ?? '';
      expect(cursor).not.toBe('');
      const second = await get(
        `/v1/platform/outbox?aggregate_id=${aggregate}&limit=2&cursor=${encodeURIComponent(cursor)}`,
      ).expect(200);
      const page2 = pageOf(second.body);
      expect(page2.data.map((row) => row.id)).toEqual([rowA]);
      expect(page2.next_cursor).toBeNull();
      const ascending = await get(
        `/v1/platform/outbox?aggregate_id=${aggregate}&sort=created_at`,
      ).expect(200);
      expect(rowsOf(ascending.body).map((row) => row.id)).toEqual([rowA, rowB, rowPlatform]);
      // A cursor never continues another filter.
      const rebound = await get(
        `/v1/platform/outbox?aggregate_id=${aggregate}&limit=2&status=dead&cursor=${encodeURIComponent(cursor)}`,
      ).expect(400);
      expect(errorOf(rebound.body).details?.fields).toEqual([
        expect.objectContaining({ pointer: '/query/cursor' }),
      ]);
      const badStatus = await get(`/v1/platform/outbox?status=dead,lost`).expect(400);
      expect(errorOf(badStatus.body).details?.fields).toEqual([
        expect.objectContaining({ pointer: '/query/status' }),
      ]);
      // A bad filter with a cursor answers on the filter, not on the cursor (lead review round 3).
      const badStatusWithCursor = await get(
        `/v1/platform/outbox?aggregate_id=${aggregate}&limit=2&status=dead,lost&cursor=${encodeURIComponent(cursor)}`,
      ).expect(400);
      expect(errorOf(badStatusWithCursor.body).details?.fields).toEqual([
        expect.objectContaining({ pointer: '/query/status' }),
      ]);
      const badSort = await get(`/v1/platform/outbox?sort=-attempts`).expect(400);
      expect(errorOf(badSort.body).details?.fields).toEqual([
        expect.objectContaining({ pointer: '/query/sort' }),
      ]);
      const doneOnly = await get(
        `/v1/platform/outbox?aggregate_id=${aggregate}&status=done,pending`,
      ).expect(200);
      expect(rowsOf(doneOnly.body)).toEqual([]);
    });

    it('a tenant token cannot reach any platform outbox route', async () => {
      const staff = `${staffCookie}=${await signAccessToken(signing, 'staff', { claims: { acc: accountA } })}`;
      // Built one at a time: each supertest request starts its own listener.
      const routes = [
        () => http().get('/v1/platform/outbox').set('X-Support-Reason', reason),
        () => http().get(`/v1/platform/outbox/${rowA}`).set('X-Support-Reason', reason),
        () => http().get('/v1/platform/consumers'),
        () =>
          http()
            .post(`/v1/platform/outbox/${rowA}/replay`)
            .set(webClientHeaders(config, 'staff'))
            .set('Idempotency-Key', randomUUID())
            .send({ reason }),
        () =>
          http()
            .post('/v1/platform/outbox/replay-dead')
            .set(webClientHeaders(config, 'staff'))
            .set('Idempotency-Key', randomUUID())
            .set('X-Support-Reason', reason)
            .send({ kind: 'webhook', reason }),
      ];
      for (const route of routes) {
        const response = await route().set('Cookie', staff);
        expect([401, 403]).toContain(response.status);
        expect(listOp.responses['4XX'].parse(response.body).code).toMatch(
          /unauthenticated|forbidden/,
        );
      }
      expect((await stored(rowA))?.status).toBe('dead');
    });
  });

  describe('platformGetOutboxRow', () => {
    it('through the door of the row account: the envelope, one audit row', async () => {
      const id = await plant({ account: accountB });
      const response = await get(`/v1/platform/outbox/${id}`).expect(200);
      const row = getOp.responses['200'].parse(response.body);
      expect(row.envelope).toMatchObject({ id, account_id: accountB, payload: { note: secret } });
      const audit = await auditOf(response);
      expect(audit.map((r) => [r.action, r.accountId, r.targetId])).toEqual([
        ['platform.cross_tenant.accessed', accountB, accountB],
      ]);
    });

    it('a platform-only row: metadata only, no door', async () => {
      const id = await plant({ account: null, kind: 'storage_lifecycle' });
      const response = await get(`/v1/platform/outbox/${id}`).expect(200);
      const row = getOp.responses['200'].parse(response.body);
      expect(row).toMatchObject({ id, account_id: null });
      expect(row).not.toHaveProperty('envelope');
      expect(JSON.stringify(response.body)).not.toContain(secret);
      expect(await auditOf(response)).toEqual([]);
    });

    it('an unknown row is 404 and its refusal is audited; no reason is 400', async () => {
      const unknown = uuidv7();
      const response = await get(`/v1/platform/outbox/${unknown}`).expect(404);
      const audit = await auditOf(response);
      expect(audit.map((r) => [r.action, r.accountId, r.targetType, r.targetId])).toEqual([
        ['platform.cross_tenant.refused', null, 'outbox_row', unknown],
      ]);
      const id = await plant({ account: accountA });
      const missing = await get(`/v1/platform/outbox/${id}`, {}).expect(400);
      expect(missing.body).toMatchObject({ code: 'reason_required' });
    });
  });

  describe('platformReplayOutboxRow', () => {
    it('dead → pending: attempts reset, job removed, dead letters replayed, audited, idempotent', async () => {
      const id = await plant({ account: accountA, kind: 'internal_event' });
      await owner`
        INSERT INTO core_consumer_dead_letters (id, consumer, event_id, account_id, attempts, last_error)
        VALUES (${uuidv7()}, ${kernelConsumer}, ${id}, ${accountA}, 10, 'consumer failed')`;
      const queue = new Queue(outboxQueueName('internal_event'), { connection: redis, prefix });
      await queue.add('internal_event', { outboxId: id }, { jobId: id });
      expect(await queues.hasJob('internal_event', id)).toBe(true);

      const key = randomUUID();
      const response = await post(`/v1/platform/outbox/${id}/replay`, { reason }, {}, key).expect(
        200,
      );
      const row = replayOp.responses['200'].parse(response.body);
      expect(row).toMatchObject({ id, status: 'pending', attempts: 0, enqueued_at: null });
      expect(row.envelope).toMatchObject({ id, account_id: accountA });
      const after = await stored(id);
      expect(after).toMatchObject({ status: 'pending', attempts: 0, enqueued_at: null });
      expect(Math.abs((after?.next_attempt_at.getTime() ?? 0) - Date.now())).toBeLessThan(5_000);
      expect(await queues.hasJob('internal_event', id)).toBe(false);
      const [letter] = await owner<{ replayed_at: Date | null }[]>`
        SELECT replayed_at FROM core_consumer_dead_letters WHERE event_id = ${id}`;
      expect(letter?.replayed_at).not.toBeNull();
      const audit = await auditOf(response);
      expect(audit.map((r) => [r.action, r.accountId, r.targetType, r.targetId, r.reason])).toEqual(
        [
          ['platform.cross_tenant.accessed', accountA, 'account', accountA, reason],
          ['platform.outbox_row.replayed', accountA, 'outbox_row', id, reason],
        ],
      );
      expect(audit[1]?.before).toEqual({ status: 'dead', attempts: 5 });
      expect(audit[1]?.after).toMatchObject({ status: 'pending', attempts: 0 });

      // The same key answers the stored response and replays nothing again.
      const again = await post(`/v1/platform/outbox/${id}/replay`, { reason }, {}, key).expect(200);
      expect(again.headers['idempotency-replayed']).toBe('true');
      expect(again.body).toEqual(response.body);
      const replays = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_audit_log
        WHERE action = 'platform.outbox_row.replayed' AND target_id = ${id}`;
      expect(replays[0]?.n).toBe(1);
      await queue.close();
    });

    it('refuses a row that is not dead (409 replay_not_allowed), nothing changes', async () => {
      const id = await plant({ account: accountA, status: 'done' });
      const response = await post(`/v1/platform/outbox/${id}/replay`, { reason }).expect(409);
      expect(replayOp.responses['409'].parse(response.body)).toMatchObject({
        code: 'replay_not_allowed',
        details: { current_status: 'done', reason: 'not_dead' },
      });
      expect(await stored(id)).toMatchObject({ status: 'done', attempts: 5 });
      const audit = await auditOf(response);
      expect(audit.map((r) => [r.action, (r.after as { outcome: string }).outcome])).toEqual([
        ['platform.cross_tenant.accessed', 'failed'],
      ]);
    });

    it('refuses a dead row older than the 35-day receipt window', async () => {
      const id = await plant({ account: accountA, ageDays: 35, ageSeconds: 60 });
      await queues.add('webhook', [id]);
      const response = await post(`/v1/platform/outbox/${id}/replay`, { reason }).expect(409);
      expect(errorOf(response.body).details).toEqual({
        current_status: 'dead',
        reason: 'outside_receipt_window',
      });
      expect((await stored(id))?.status).toBe('dead');
      // A refused replay keeps the row's job (lead review round 3).
      expect(await queues.hasJob('webhook', id)).toBe(true);
      // Gone again, so the running-job test's worker never picks it up.
      await queues.removeJobs('webhook', [id]);
      // Just inside the window it replays.
      const inside = await plant({ account: accountA, ageDays: 34 });
      await post(`/v1/platform/outbox/${inside}/replay`, { reason }).expect(200);
    });

    it('refuses a dead row whose supersede key is held by a pending row of its account', async () => {
      const key = `order:${uuidv7()}`;
      const dead = await plant({ account: accountA, supersedeKey: key });
      await queues.add('webhook', [dead]);
      await plant({ account: accountA, status: 'pending', supersedeKey: key });
      const response = await post(`/v1/platform/outbox/${dead}/replay`, { reason }).expect(409);
      expect(errorOf(response.body).details).toEqual({
        current_status: 'dead',
        reason: 'supersede_pending',
      });
      // Refused by the guarded update: the job is kept (lead review round 3).
      expect(await queues.hasJob('webhook', dead)).toBe(true);
      await queues.removeJobs('webhook', [dead]);
      // The same key pending in another account does not hold it.
      const otherKey = `order:${uuidv7()}`;
      const deadA = await plant({ account: accountA, supersedeKey: otherKey });
      await plant({ account: accountB, status: 'pending', supersedeKey: otherKey });
      await post(`/v1/platform/outbox/${deadA}/replay`, { reason }).expect(200);
    });

    it('refuses a row whose job is still running', async () => {
      const id = await plant({ account: accountA });
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started: () => void = () => undefined;
      const running = new Promise<void>((resolve) => {
        started = resolve;
      });
      const connection = new Redis(config.redis.url?.reveal() ?? '', {
        maxRetriesPerRequest: null,
      });
      const worker = new Worker(
        outboxQueueName('webhook'),
        async () => {
          started();
          await held;
        },
        { connection, prefix },
      );
      await queues.add('webhook', [id]);
      await running;
      const response = await post(`/v1/platform/outbox/${id}/replay`, { reason }).expect(409);
      expect(errorOf(response.body).details).toEqual({
        current_status: 'dead',
        reason: 'job_active',
      });
      expect((await stored(id))?.status).toBe('dead');
      release();
      await worker.close();
      connection.disconnect();
    });

    it('takes the reason from the body: without it 400 reason_required', async () => {
      const id = await plant({ account: accountA });
      const response = await post(`/v1/platform/outbox/${id}/replay`, {}).expect(400);
      expect(response.body).toMatchObject({ code: 'reason_required' });
      expect((await stored(id))?.status).toBe('dead');
    });

    it('a platform-only row replays without a door, audited with no account', async () => {
      const id = await plant({ account: null, kind: 'storage_lifecycle' });
      const response = await post(`/v1/platform/outbox/${id}/replay`, { reason }).expect(200);
      const row = replayOp.responses['200'].parse(response.body);
      expect(row).toMatchObject({ id, account_id: null, status: 'pending' });
      expect(row).not.toHaveProperty('envelope');
      const audit = await auditOf(response);
      expect(audit.map((r) => [r.action, r.accountId, r.targetId])).toEqual([
        ['platform.outbox_row.replayed', null, id],
      ]);
      // Back to dead so the relay of a built worker never finds a test row pending.
      await owner`UPDATE core_outbox SET status = 'dead' WHERE id = ${id}`;
    });
  });

  describe('platformReplayDeadOutbox', () => {
    it('with account_id: that account only, through the door, one audit row with the counts', async () => {
      const a1 = await plant({ account: accountA, kind: 'channel_publish', type: bulkType });
      const a2 = await plant({ account: accountA, kind: 'channel_publish', type: bulkType });
      const aOld = await plant({
        account: accountA,
        kind: 'channel_publish',
        type: bulkType,
        ageDays: 40,
      });
      const aDone = await plant({
        account: accountA,
        kind: 'channel_publish',
        type: bulkType,
        status: 'done',
      });
      const b1 = await plant({ account: accountB, kind: 'channel_publish', type: bulkType });
      const response = await post(
        '/v1/platform/outbox/replay-dead',
        { account_id: accountA, kind: 'channel_publish', type: bulkType, reason },
        { 'X-Support-Reason': reason },
      ).expect(202);
      expect(bulkOp.responses['202'].parse(response.body)).toEqual({ matched: 3, replayed: 2 });
      expect((await stored(a1))?.status).toBe('pending');
      expect((await stored(a2))?.status).toBe('pending');
      expect((await stored(aOld))?.status).toBe('dead');
      expect((await stored(aDone))?.status).toBe('done');
      expect((await stored(b1))?.status).toBe('dead');
      const audit = await auditOf(response);
      expect(audit.map((r) => [r.action, r.accountId, r.targetType, r.targetId])).toEqual([
        ['platform.cross_tenant.accessed', accountA, 'account', accountA],
        ['platform.outbox_rows.replayed', accountA, 'outbox_kind', 'channel_publish'],
      ]);
      expect(audit[1]?.after).toMatchObject({
        matched: 3,
        replayed: 2,
        account_id: accountA,
        type: bulkType,
      });
    });

    it('without account_id: across accounts, no door, audited with no account', async () => {
      const response = await post(
        '/v1/platform/outbox/replay-dead',
        { kind: 'channel_publish', type: bulkType, reason },
        { 'X-Support-Reason': reason },
      ).expect(202);
      // Account A's 40-day row stays dead; account B's row replays.
      expect(bulkOp.responses['202'].parse(response.body)).toEqual({ matched: 2, replayed: 1 });
      const audit = await auditOf(response);
      expect(audit.map((r) => [r.action, r.accountId])).toEqual([
        ['platform.outbox_rows.replayed', null],
      ]);
      await owner`UPDATE core_outbox SET status = 'dead' WHERE type = ${bulkType} AND status = 'pending'`;
    });

    it('requires kind (400) and the support reason', async () => {
      const noKind = await post(
        '/v1/platform/outbox/replay-dead',
        { reason },
        { 'X-Support-Reason': reason },
      ).expect(400);
      expect(errorOf(noKind.body).code).toBe('validation_failed');
      const noReason = await post('/v1/platform/outbox/replay-dead', {
        account_id: accountA,
        kind: 'channel_publish',
        reason,
      }).expect(400);
      expect(errorOf(noReason.body).code).toBe('reason_required');
    });

    it('replays in batches, one row per supersede key', async () => {
      const type = `test.outbox_${run}.batched`;
      const key = `channel:${uuidv7()}`;
      const ids = [
        await plant({ account: accountA, kind: 'channel_publish', type }),
        await plant({ account: accountA, kind: 'channel_publish', type, supersedeKey: key }),
        await plant({ account: accountB, kind: 'channel_publish', type }),
        await plant({ account: accountA, kind: 'channel_publish', type, supersedeKey: key }),
        await plant({ account: null, kind: 'channel_publish', type }),
      ];
      const counts = await withPlatformUnitOfWork(pool.db, (uow) =>
        replayBulk(
          platformReplayStore(new PlatformOutbox(uow), 'all'),
          queues,
          {
            kind: 'channel_publish',
            type,
          },
          2,
        ),
      );
      expect(counts).toEqual({ matched: 5, replayed: 4 });
      const statuses = await owner<{ id: string; status: string }[]>`
        SELECT id, status FROM core_outbox WHERE type = ${type} ORDER BY id`;
      expect(statuses.map((r) => r.status)).toEqual([
        'pending',
        'dead',
        'pending',
        'pending',
        'pending',
      ]);
      expect(statuses.map((r) => r.id)).toEqual(ids);
      await owner`DELETE FROM core_outbox WHERE type = ${type}`;
    });
  });

  describe('platformListConsumers', () => {
    it('per consumer: lag, parked (delayed in BullMQ) and live dead letters', async () => {
      // An open event of its type for two hours without its receipt.
      await plant({
        account: accountA,
        kind: 'internal_event',
        status: 'pending',
        ageDays: 0,
        ageSeconds: 7_200,
      });
      const dead = await plant({ account: accountA, kind: 'internal_event' });
      await owner`
        INSERT INTO core_consumer_dead_letters (id, consumer, event_id, account_id, attempts, last_error)
        VALUES (${uuidv7()}, ${kernelConsumer}, ${dead}, ${accountA}, 3, 'parked past 15 min')`;
      const parked = await plant({
        account: accountA,
        kind: 'internal_event',
        status: 'enqueued',
        lastError: 'parked: sequence gap',
        parkedConsumers: [kernelConsumer],
      });
      // Parked in the database, but its job is not delayed: not counted.
      await plant({
        account: accountA,
        kind: 'internal_event',
        status: 'enqueued',
        lastError: 'parked: sequence gap',
        parkedConsumers: [kernelConsumer],
      });
      // Delayed with a message naming the consumer but no `parked_consumers`: the names come from
      // the column only, never from `last_error` (lead review round 3).
      const retrying = await plant({
        account: accountA,
        kind: 'internal_event',
        status: 'enqueued',
        lastError: `parked: sequence gap for ${kernelConsumer}`,
      });
      const queue = new Queue(outboxQueueName('internal_event'), { connection: redis, prefix });
      await queue.add('internal_event', { outboxId: parked }, { jobId: parked, delay: 60_000 });
      await queue.add('internal_event', { outboxId: retrying }, { jobId: retrying, delay: 60_000 });

      const response = await get('/v1/platform/consumers', {}).expect(200);
      const list = consumersOp.responses['200'].parse(response.body);
      const kernel = list.data?.find((entry) => entry.consumer === kernelConsumer);
      expect(kernel?.parked).toBe(1);
      expect(kernel?.dead).toBeGreaterThanOrEqual(1);
      expect(kernel?.lag_seconds).toBeGreaterThanOrEqual(7_200);
      expect(kernel?.lag_seconds).toBeLessThan(7_200 + 120);
      await queue.close();
      await owner`UPDATE core_outbox SET status = 'dead'
                  WHERE account_id = ${accountA} AND kind = 'internal_event' AND status <> 'dead'`;
    });
  });

  describe('pruning (plan 2.8)', () => {
    it('deletes only what the windows say, in batches; never pending or enqueued rows', async () => {
      const row = (status: string, ageDays: number) =>
        plant({ account: accountB, kind: 'webhook', status, ageDays, ageSeconds: 60 });
      const gone = [
        await row('done', 7),
        await row('superseded', 7),
        await row('dead', 30),
        await row('done', 8),
      ];
      const kept = [
        await row('done', 6),
        await row('superseded', 6),
        await row('dead', 29),
        await row('pending', 100),
        await row('enqueued', 100),
      ];
      const receipt = (days: number) => {
        const event = uuidv7();
        return owner`
          INSERT INTO core_consumer_receipts (consumer, event_id, account_id, processed_at)
          VALUES (${kernelConsumer}, ${event}, ${accountB}, now() - make_interval(days => ${days}))`.then(
          () => event,
        );
      };
      const oldReceipt = await receipt(36);
      const newReceipt = await receipt(34);
      const letter = (days: number) => {
        const id = uuidv7();
        return owner`
          INSERT INTO core_consumer_dead_letters (id, consumer, event_id, account_id, created_at)
          VALUES (${id}, ${kernelConsumer}, ${uuidv7()}, ${accountB},
                  now() - make_interval(days => ${days}))`.then(() => id);
      };
      const oldLetter = await letter(31);
      const newLetter = await letter(29);

      const counts = await pruneOutbox(pool.db, 2);
      expect(counts.finished).toBeGreaterThanOrEqual(3);
      expect(counts.dead).toBeGreaterThanOrEqual(1);
      expect(counts.receipts).toBeGreaterThanOrEqual(1);
      expect(counts.deadLetters).toBeGreaterThanOrEqual(1);
      const left = await owner<{ id: string }[]>`
        SELECT id FROM core_outbox WHERE id IN ${owner([...gone, ...kept])}`;
      expect(left.map((r) => r.id).sort()).toEqual([...kept].sort());
      const receipts = await owner<{ event_id: string }[]>`
        SELECT event_id FROM core_consumer_receipts WHERE event_id IN ${owner([oldReceipt, newReceipt])}`;
      expect(receipts.map((r) => r.event_id)).toEqual([newReceipt]);
      const lettersLeft = await owner<{ id: string }[]>`
        SELECT id FROM core_consumer_dead_letters WHERE id IN ${owner([oldLetter, newLetter])}`;
      expect(lettersLeft.map((r) => r.id)).toEqual([newLetter]);
    });

    it('runs once per lock: a second run in the window skips', async () => {
      const lockKey = `${prefix}:lock:outbox-prune`;
      expect((await runOutboxPrune(pool.db, redis, lockKey)).ran).toBe(true);
      expect(await runOutboxPrune(pool.db, redis, lockKey)).toEqual({ ran: false });
      expect(await redis.pttl(lockKey)).toBeGreaterThan(22 * 60 * 60 * 1000);
    });
  });
});
