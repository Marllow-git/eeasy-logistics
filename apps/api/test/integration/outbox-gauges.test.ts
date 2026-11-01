import type { Pool } from '@eeasy-logistics/db';
import { uuidv7 } from '@eeasy-logistics/db';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { createPlatformPool } from '@eeasy-logistics/db/platform';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextOutboxId } from '../../src/modules/kernel/outbox/outbox-id.js';
import { runOutboxGauges } from '../../src/worker/system/outbox-gauges.js';
import { testMetrics } from '../support/metrics.js';
import { connectAs, integrationConfig } from './support.js';

// PLAT-14 item C on the real database (plan 2.3, 2.9): the 30 s gauge job reads core_outbox in
// one query and the observed gauges report the oldest due row's age and the dead rows. Other
// suites write rows at the same time, so the assertions are lower bounds on this run's rows:
// `internal_event` rows on fresh aggregates of an account of this file (no relay in the suite
// handles them), deleted afterwards.

const config = integrationConfig();
const quiet = { warn: () => undefined };

describe('outbox gauges (PLAT-14 item C)', () => {
  const account = uuidv7();
  const suspended = uuidv7();
  const planted: string[] = [];
  let owner: postgres.Sql;
  let pool: Pool<PlatformDatabase>;

  const plant = async (row: {
    account: string;
    status: 'pending' | 'dead';
    dueAgo: string;
  }): Promise<void> => {
    const id = nextOutboxId();
    planted.push(id);
    await owner`
      INSERT INTO core_outbox (id, type, event_version, account_id, aggregate_type, aggregate_id,
                               sequence, payload, kind, status, next_attempt_at)
      VALUES (${id}, 'core.account.suspended', 1, ${row.account}, 'account', ${uuidv7()}, 1,
              '{}', 'internal_event', ${row.status}, now() - ${row.dueAgo}::interval)`;
  };

  beforeAll(async () => {
    owner = connectAs('owner', config);
    pool = createPlatformPool(config.db, 'elx-test-gauges');
    await owner`INSERT INTO core_accounts (id, name) VALUES (${account}, 'Gauges')`;
    await owner`INSERT INTO core_accounts (id, name, status)
                VALUES (${suspended}, 'Gauges suspended', 'suspended')`;
  });

  afterAll(async () => {
    if (planted.length > 0) await owner`DELETE FROM core_outbox WHERE id IN ${owner(planted)}`;
    await pool?.close();
    await owner?.end();
  });

  it('observes a planted due row and a planted dead row', async () => {
    await plant({ account, status: 'pending', dueAgo: '10 minutes' });
    await plant({ account, status: 'dead', dueAgo: '1 day' });
    const { metrics, collect } = testMetrics();
    await runOutboxGauges(pool.db, metrics, quiet);
    const points = await collect();
    const point = (name: string, attributes: Record<string, string>) =>
      points.find(
        (p) =>
          p.name === name &&
          Object.entries(attributes).every(([key, value]) => p.attributes[key] === value),
      );
    const oldest = point('outbox_due_oldest_age_seconds', { kind: 'internal_event' });
    expect(Number(oldest?.value)).toBeGreaterThanOrEqual(600);
    expect(
      Number(point('outbox_rows', { kind: 'internal_event', status: 'dead' })?.value),
    ).toBeGreaterThanOrEqual(1);
    expect(
      Number(point('outbox_rows', { kind: 'internal_event', status: 'pending' })?.value),
    ).toBeGreaterThanOrEqual(1);
    // Every kind is reported, zeros included, so an alert rule always has a series.
    const kinds = points
      .filter((p) => p.name === 'outbox_due_oldest_age_seconds')
      .map((p) => p.attributes.kind);
    expect(kinds).toHaveLength(7);
  });

  it('keeps the previous values and logs when the read fails', async () => {
    const { metrics, collect } = testMetrics();
    metrics.set('outbox_rows', 3, { kind: 'push', status: 'pending' });
    const warnings: string[] = [];
    const broken = {
      execute: () => Promise.reject(new Error('down')),
    } as unknown as PlatformDatabase;
    await runOutboxGauges(broken, metrics, { warn: (line) => warnings.push(line) });
    expect(warnings).toEqual(['Outbox gauges skipped: Error']);
    expect((await collect())[0]?.value).toBe(3);
  });
});
