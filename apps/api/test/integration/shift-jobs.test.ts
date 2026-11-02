import { randomBytes } from 'node:crypto';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import { createAppPool, uuidv7, withUnitOfWork } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import { Redis } from 'ioredis';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SuspendedAccountShiftsConsumer } from '../../src/modules/delivery/public/index.js';
import { AuditWriter } from '../../src/modules/kernel/audit/audit-writer.js';
import type { DomainEvent } from '../../src/modules/kernel/outbox/domain-event.js';
import { subscribedTypes } from '../../src/modules/kernel/outbox/domain-event-consumers.js';
import { OutboxWriter } from '../../src/modules/kernel/outbox/outbox-writer.js';
import { pushPayload } from '../../src/modules/kernel/push/push.handler.js';
import { runShiftSweeper } from '../../src/worker/system/shift-sweeper.js';
import { runTelemetryRetention } from '../../src/worker/system/telemetry-retention.js';
import { systemContext } from '../../src/worker/system/tenant-runs.js';
import { runTrailAppender } from '../../src/worker/system/trail-appender.js';
import type { PlantedDriver } from './driver-fixtures.js';
import { plantDriver } from './driver-fixtures.js';
import { connectAs, integrationConfig } from './support.js';

// DEL-5 item D (plan 2.5, 2.8, 2.10): the trail appender (seq advanced, the line's points and M
// values, nothing re-appended on a second run, the midnight split), the telemetry retention with a
// clock (90 days, archived drivers' ring and head rows, only in the 03:00 hour, once a day), and the
// shift sweeper with a clock (a no-show at the grace with its audit row; a stale alert with one
// `push` row and one event, none within 15 minutes, none for a paused or a fresh shift). Every run
// is scoped to this file's accounts and takes a lock key of its own: the suites share one database.

const config = integrationConfig();
const prefix = `elx-test-${randomBytes(6).toString('hex')}`;
const quiet = { warn: () => undefined };

describe('the DEL-5 worker jobs (item D)', () => {
  let owner: postgres.Sql;
  let platform: Pool<PlatformDatabase>;
  let app: Pool<AppDatabase>;
  let redis: Redis;
  let lockSequence = 0;
  const lockKey = () => `${prefix}:lock:${++lockSequence}`;

  beforeAll(() => {
    owner = connectAs('owner', config);
    platform = createPlatformPool(config.db, 'shift-jobs-test');
    app = createAppPool(config.db, 'shift-jobs-test');
    redis = new Redis(config.redis.url?.reveal() ?? '');
  });

  afterAll(async () => {
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
    await Promise.all([platform.close(), app.close()]);
    await owner.end();
  });

  async function insertShift(
    driver: PlantedDriver,
    status: 'planned' | 'active' | 'paused' | 'ended',
    fields: { plannedStart?: Date; startedAt?: Date } = {},
  ): Promise<string> {
    const id = uuidv7();
    const start = fields.plannedStart ?? new Date(Date.now() - 60 * 60_000);
    const started = status === 'planned' ? null : (fields.startedAt ?? start);
    await owner`
      INSERT INTO del_driver_shifts
        (id, account_id, driver_id, site_id, planned_start, planned_end, started_at, ended_at, status)
      VALUES (${id}, ${driver.accountId}, ${driver.driverId}, ${driver.siteId}, ${start},
              ${new Date(start.getTime() + 8 * 60 * 60_000)}, ${started},
              ${status === 'ended' ? new Date() : null}, ${status})`;
    return id;
  }

  /** Ring rows `fromSeq..toSeq` of the shift, one second apart from `firstAt` along a meridian. */
  async function plantRing(
    driver: PlantedDriver,
    shiftId: string,
    fromSeq: number,
    toSeq: number,
    firstAt: Date,
    lastServerTs: Date = new Date(),
  ): Promise<void> {
    for (let seq = fromSeq; seq <= toSeq; seq++) {
      const at = new Date(firstAt.getTime() + (seq - fromSeq) * 1000);
      await owner`
        INSERT INTO del_driver_locations
          (account_id, driver_id, slot, seq, shift_id, point, client_ts, server_ts)
        VALUES (${driver.accountId}, ${driver.driverId}, ${seq % 240}, ${seq}, ${shiftId},
                ST_SetSRID(ST_MakePoint(46.6, ${24.7 + seq / 10_000}), 4326), ${at}, ${at})
        ON CONFLICT (driver_id, slot) DO UPDATE
        SET seq = excluded.seq, point = excluded.point, client_ts = excluded.client_ts`;
    }
    await owner`
      INSERT INTO del_driver_location_heads
        (driver_id, account_id, last_seq, last_point, last_client_ts, last_server_ts)
      VALUES (${driver.driverId}, ${driver.accountId}, ${toSeq},
              ST_SetSRID(ST_MakePoint(46.6, 24.7), 4326), ${firstAt}, ${lastServerTs})
      ON CONFLICT (driver_id) DO UPDATE
      SET last_seq = excluded.last_seq, last_server_ts = excluded.last_server_ts`;
  }

  const trailsOf = (driverId: string) =>
    owner<
      {
        business_date: string;
        point_count: number;
        vertices: number;
        first_m: number;
        last_m: number;
        updated_at: Date;
      }[]
    >`
      SELECT business_date::text, point_count, ST_NPoints(path) AS vertices,
             ST_M(ST_StartPoint(path)) AS first_m, ST_M(ST_EndPoint(path)) AS last_m, updated_at
      FROM del_driver_trails WHERE driver_id = ${driverId} ORDER BY business_date`;
  const trailSeqOf = async (driverId: string) =>
    (
      await owner<{ trail_seq: number }[]>`
        SELECT trail_seq::int FROM del_driver_location_heads WHERE driver_id = ${driverId}`
    )[0]?.trail_seq;

  const appender = (accounts: readonly string[]) =>
    runTrailAppender({
      db: platform.db,
      app: app.db,
      redis,
      logger: quiet,
      lockKey: lockKey(),
      accounts,
    });

  describe('trail appender', () => {
    it('appends the new points once, simplified, with M as Unix seconds', async () => {
      const driver = await plantDriver(owner);
      const shiftId = await insertShift(driver, 'active');
      const firstAt = new Date('2026-10-20T08:00:00Z');
      await plantRing(driver, shiftId, 1, 20, firstAt);

      const first = await appender([driver.accountId]);
      expect(first).toEqual({ ran: true, counts: { drivers: 1, points: 20, failed: 0 } });
      const [day] = await trailsOf(driver.driverId);
      // Twenty points on one straight line simplify to its two ends.
      expect(day).toMatchObject({ business_date: '2026-10-20', point_count: 20, vertices: 2 });
      expect(day?.first_m).toBe(firstAt.getTime() / 1000);
      expect(day?.last_m).toBe(firstAt.getTime() / 1000 + 19);
      expect(await trailSeqOf(driver.driverId)).toBe(20);

      // A second run without new points writes nothing.
      const again = await appender([driver.accountId]);
      expect(again).toEqual({ ran: true, counts: { drivers: 0, points: 0, failed: 0 } });
      expect(await trailsOf(driver.driverId)).toEqual([day]);

      // Five new points are appended to the same day's line.
      await plantRing(driver, shiftId, 21, 25, new Date(firstAt.getTime() + 20_000));
      expect((await appender([driver.accountId])).ran).toBe(true);
      const [grown] = await trailsOf(driver.driverId);
      expect(grown).toMatchObject({ point_count: 25, vertices: 4 });
      expect(grown?.last_m).toBe(firstAt.getTime() / 1000 + 24);
      expect(await trailSeqOf(driver.driverId)).toBe(25);
    });

    it('splits a segment crossing midnight in Riyadh into two days', async () => {
      const driver = await plantDriver(owner);
      const shiftId = await insertShift(driver, 'active');
      // 20:58:00Z to 21:01:59Z: midnight in Riyadh is 21:00:00Z.
      await plantRing(driver, shiftId, 1, 240, new Date('2026-10-20T20:58:00Z'));
      await appender([driver.accountId]);
      const days = await trailsOf(driver.driverId);
      expect(days.map((d) => [d.business_date, d.point_count])).toEqual([
        ['2026-10-20', 120],
        ['2026-10-21', 120],
      ]);
    });

    it('answers ran: false while another worker holds the lock', async () => {
      const key = lockKey();
      await redis.set(key, 'other', 'PX', 60_000);
      const run = await runTrailAppender({
        db: platform.db,
        app: app.db,
        redis,
        logger: quiet,
        lockKey: key,
        accounts: [],
      });
      expect(run).toEqual({ ran: false });
    });
  });

  describe('telemetry retention', () => {
    // 00:10Z is 03:10 in Riyadh; the cutoff is 2026-11-02 minus 90 days.
    const atThree = new Date('2026-11-02T00:10:00Z');
    const cutoff = '2026-08-04';

    const plantTrail = async (driver: PlantedDriver, businessDate: string) => {
      await owner`
        INSERT INTO del_driver_trails
          (id, account_id, driver_id, business_date, path, point_count, first_ts, last_ts)
        VALUES (${uuidv7()}, ${driver.accountId}, ${driver.driverId}, ${businessDate},
                ST_GeomFromEWKT('SRID=4326;LINESTRINGM(46.6 24.7 1, 46.61 24.71 2)'), 2,
                now(), now())`;
    };

    it('deletes trails older than 90 days and the archived drivers’ ring and head rows', async () => {
      const kept = await plantDriver(owner);
      const keptShift = await insertShift(kept, 'active');
      await plantRing(kept, keptShift, 1, 3, new Date('2026-10-20T08:00:00Z'));
      await plantTrail(kept, cutoff);
      await plantTrail(kept, '2026-08-03');
      const archived = await plantDriver(owner, {
        accountId: kept.accountId,
        driverStatus: 'archived',
      });
      const archivedShift = await insertShift(archived, 'ended');
      await plantRing(archived, archivedShift, 1, 3, new Date('2026-10-20T08:00:00Z'));
      const scope = { db: platform.db, app: app.db, redis, logger: quiet };

      // Outside the 03:00 hour nothing runs.
      expect(
        await runTelemetryRetention({
          ...scope,
          now: () => new Date('2026-11-02T01:10:00Z'),
          lockKey: lockKey(),
          accounts: [kept.accountId],
        }),
      ).toEqual({ ran: false });

      const key = lockKey();
      const run = await runTelemetryRetention({
        ...scope,
        now: () => atThree,
        lockKey: key,
        accounts: [kept.accountId],
      });
      expect(run).toEqual({
        ran: true,
        counts: { accounts: 1, trails: 1, ringRows: 3, heads: 1, failed: 0 },
      });
      expect((await trailsOf(kept.driverId)).map((d) => d.business_date)).toEqual([cutoff]);
      const ring = await owner<{ driver_id: string; n: number }[]>`
        SELECT driver_id, count(*)::int AS n FROM del_driver_locations
        WHERE driver_id IN (${kept.driverId}, ${archived.driverId}) GROUP BY driver_id`;
      expect(ring).toEqual([{ driver_id: kept.driverId, n: 3 }]);
      expect(await trailSeqOf(archived.driverId)).toBeUndefined();
      expect(await trailSeqOf(kept.driverId)).toBe(0);

      // The 23-hour lock: a second tick in the same hour does not run.
      expect(
        await runTelemetryRetention({
          ...scope,
          now: () => atThree,
          lockKey: key,
          accounts: [kept.accountId],
        }),
      ).toEqual({ ran: false });
    });
  });

  describe('shift sweeper', () => {
    const minute = 60_000;

    const sweep = (accounts: readonly string[], now: Date) =>
      runShiftSweeper({
        db: platform.db,
        app: app.db,
        redis,
        logger: quiet,
        lockKey: lockKey(),
        now: () => now,
        accounts,
      });

    const shiftOf = async (id: string) =>
      (
        await owner<{ status: string; stale_alerted_at: Date | null; version: number }[]>`
          SELECT status, stale_alerted_at, version FROM del_driver_shifts WHERE id = ${id}`
      )[0];
    const outboxOf = (shiftId: string) =>
      owner<{ kind: string; type: string; payload: Record<string, unknown> }[]>`
        SELECT kind, type, payload FROM core_outbox
        WHERE aggregate_id = ${shiftId} ORDER BY created_at, kind`;

    it('marks a planned shift a no-show 30 minutes after its start, with an audit row', async () => {
      const now = new Date();
      const late = await plantDriver(owner);
      const lateShift = await insertShift(late, 'planned', {
        plannedStart: new Date(now.getTime() - 31 * minute),
      });
      const early = await plantDriver(owner, { accountId: late.accountId });
      const earlyShift = await insertShift(early, 'planned', {
        plannedStart: new Date(now.getTime() - 29 * minute),
      });

      const run = await sweep([late.accountId], now);
      expect(run).toEqual({
        ran: true,
        counts: { accounts: 1, noShows: 1, stale: 0, failed: 0 },
      });
      expect((await shiftOf(lateShift))?.status).toBe('no_show');
      expect((await shiftOf(earlyShift))?.status).toBe('planned');
      const audit = await owner<{ actor_type: string; actor_id: string | null; action: string }[]>`
        SELECT actor_type, actor_id, action FROM core_audit_log WHERE target_id = ${lateShift}`;
      expect(audit).toEqual([
        { actor_type: 'system', actor_id: null, action: 'delivery.shift.no_show' },
      ]);
      expect(await outboxOf(lateShift)).toEqual([]);
    });

    it('alerts a silent active shift once per 15 minutes, never a paused or a fresh one', async () => {
      const now = new Date();
      const silent = await plantDriver(owner);
      const silentShift = await insertShift(silent, 'active', {
        startedAt: new Date(now.getTime() - 30 * minute),
      });
      await plantRing(
        silent,
        silentShift,
        1,
        1,
        new Date(now.getTime() - 7 * minute),
        new Date(now.getTime() - 6 * minute),
      );
      await owner`
        INSERT INTO del_driver_devices
          (id, account_id, driver_id, device_id, platform, app_version, push_token)
        VALUES (${uuidv7()}, ${silent.accountId}, ${silent.driverId}, ${`app-${uuidv7()}`},
                'android', '1.0.0', 'ExponentPushToken[stale-test]')`;
      const paused = await plantDriver(owner, { accountId: silent.accountId });
      const pausedShift = await insertShift(paused, 'paused', {
        startedAt: new Date(now.getTime() - 30 * minute),
      });
      const fresh = await plantDriver(owner, { accountId: silent.accountId });
      const freshShift = await insertShift(fresh, 'active', {
        startedAt: new Date(now.getTime() - 30 * minute),
      });
      await plantRing(
        fresh,
        freshShift,
        1,
        1,
        new Date(now.getTime() - minute),
        new Date(now.getTime() - minute),
      );

      const run = await sweep([silent.accountId], now);
      expect(run).toEqual({ ran: true, counts: { accounts: 1, noShows: 0, stale: 1, failed: 0 } });
      const shift = await shiftOf(silentShift);
      expect(shift?.stale_alerted_at?.getTime()).toBe(now.getTime());
      expect(shift?.version).toBe(2);
      const rows = await outboxOf(silentShift);
      expect(rows.map((r) => [r.kind, r.type])).toEqual([
        ['internal_event', 'delivery.shift.tracking_stale'],
        ['push', 'delivery.shift.tracking_stale'],
      ]);
      const push = rows.find((r) => r.kind === 'push')?.payload;
      expect(push).toMatchObject({
        driver_id: silent.driverId,
        template: 'stale_tracking',
        locale: 'en',
        data: { kind: 'sync', route: 'eeasydriver://sync' },
        devices: [{ push_token: 'ExponentPushToken[stale-test]' }],
      });
      // The push handler's own schema takes the row (INT-4 plan 2.3).
      expect(pushPayload.safeParse(push).success).toBe(true);
      const event = rows.find((r) => r.kind === 'internal_event')?.payload;
      expect(event).toEqual({
        shift_id: silentShift,
        driver_id: silent.driverId,
        site_id: silent.siteId,
        last_point_at: new Date(now.getTime() - 6 * minute).toISOString(),
        alerted_at: now.toISOString(),
      });
      // Ids and times only: no position in either payload.
      expect(JSON.stringify(rows)).not.toMatch(/"(lat|lng|point)"/);
      expect(await outboxOf(pausedShift)).toEqual([]);
      expect(await outboxOf(freshShift)).toEqual([]);

      // Within 15 minutes of the alert: none; at 15 minutes: the next one.
      await sweep([silent.accountId], new Date(now.getTime() + 10 * minute));
      expect(await outboxOf(silentShift)).toHaveLength(2);
      await sweep([silent.accountId], new Date(now.getTime() + 15 * minute));
      expect(await outboxOf(silentShift)).toHaveLength(4);
      expect(await outboxOf(pausedShift)).toEqual([]);
      // The push rows are this suite's only: none is left for the push suite's relay.
      await owner`DELETE FROM core_outbox WHERE kind = 'push' AND account_id = ${silent.accountId}`;
    });
  });

  describe('the core.account.suspended consumer (item E)', () => {
    const suspended = (accountId: string): DomainEvent => ({
      id: uuidv7(),
      type: 'core.account.suspended',
      version: 1,
      occurredAt: new Date(),
      accountId,
      aggregateType: 'account',
      aggregateId: accountId,
      sequence: 2,
      causationId: null,
      correlationId: null,
      payload: { reason: 'billing' },
    });
    const consumer = new SuspendedAccountShiftsConsumer({
      audit: new AuditWriter(),
      outbox: new OutboxWriter(),
    });
    const deliver = (event: DomainEvent) =>
      withUnitOfWork(app.db, systemContext(event.accountId ?? ''), (uow) =>
        consumer.handle(event, uow),
      );
    const statusOf = async (id: string) =>
      (await owner<{ status: string }[]>`SELECT status FROM del_driver_shifts WHERE id = ${id}`)[0]
        ?.status;

    it('ends the account’s active and paused shifts by the system, nothing else', async () => {
      const active = await plantDriver(owner);
      const activeShift = await insertShift(active, 'active');
      const paused = await plantDriver(owner, { accountId: active.accountId });
      const pausedShift = await insertShift(paused, 'paused');
      const planned = await plantDriver(owner, { accountId: active.accountId });
      const plannedShift = await insertShift(planned, 'planned', {
        plannedStart: new Date(Date.now() + 60 * 60_000),
      });
      const other = await plantDriver(owner);
      const otherShift = await insertShift(other, 'active');
      const event = suspended(active.accountId);

      await deliver(event);
      expect(await statusOf(activeShift)).toBe('ended');
      expect(await statusOf(pausedShift)).toBe('ended');
      expect(await statusOf(plannedShift)).toBe('planned');
      expect(await statusOf(otherShift)).toBe('active');
      const events = await owner<{ aggregate_id: string; payload: Record<string, unknown> }[]>`
        SELECT aggregate_id, payload FROM core_outbox
        WHERE type = 'delivery.shift.ended' AND aggregate_id IN (${activeShift}, ${pausedShift})
        ORDER BY aggregate_id`;
      expect(events).toHaveLength(2);
      for (const row of events) {
        expect(row.payload).toMatchObject({ ended_by: 'system', reason: 'account_suspended' });
      }
      const audit = await owner<{ actor_type: string; action: string; reason: string | null }[]>`
        SELECT actor_type, action, reason FROM core_audit_log
        WHERE target_id IN (${activeShift}, ${pausedShift})`;
      expect(audit).toEqual([
        { actor_type: 'system', action: 'delivery.shift.ended', reason: 'account_suspended' },
        { actor_type: 'system', action: 'delivery.shift.ended', reason: 'account_suspended' },
      ]);

      // A redelivery finds nothing live: no second event.
      await deliver(event);
      const again = await owner<{ n: number }[]>`
        SELECT count(*)::int AS n FROM core_outbox
        WHERE type = 'delivery.shift.ended' AND aggregate_id = ${activeShift}`;
      expect(again[0]?.n).toBe(1);
    });

    it('is subscribed to core.account.suspended under a stable name', () => {
      expect(subscribedTypes(consumer)).toEqual(['core.account.suspended']);
      expect(consumer.consumer).toBe('delivery.account_suspended_shifts');
    });
  });
});
