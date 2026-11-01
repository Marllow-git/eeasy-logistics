import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { sql } from 'drizzle-orm';
import type { OutboxKind } from '../../modules/kernel/schema/outbox.js';
import { outboxKinds } from '../../modules/kernel/schema/outbox.js';
import type { Metrics } from '../../modules/kernel/telemetry/metrics.js';

// The outbox gauges (PLAT-14 plan 2.3; integrations §4.5, §10; ADR-0036): every 30 s the worker
// reads core_outbox once on the platform pool and stores, per kind, the age of the oldest due row
// and the open and dead row counts; the observable gauges report them at the next export. Every
// worker reports (no lock): the values are the same and the alert rules take the maximum.

export const gaugeIntervalMs = 30_000;

/** Statuses counted: open rows (queue depth) and dead rows (ADR-0036 alerts). */
export const countedStatuses = ['pending', 'enqueued', 'dead'] as const;
export type CountedStatus = (typeof countedStatuses)[number];

/**
 * The `template_class` label of `outbox_due_oldest_age_seconds` (lead review round 2;
 * integrations §4.5: OTP messages page at 30 s, other messages at 120 s): `otp` for a `message`
 * row whose payload names the `auth_otp` template, `other` for any other message, `n/a` for
 * the other kinds. Only the template key is read, never the parameters (an OTP row holds the code).
 */
export const templateClasses = ['otp', 'other', 'n/a'] as const;
export type TemplateClass = (typeof templateClasses)[number];

/** The template classes reported for a kind: both message classes, `n/a` otherwise. */
export function templateClassesOf(kind: OutboxKind): readonly TemplateClass[] {
  return kind === 'message' ? ['otp', 'other'] : ['n/a'];
}

export interface OutboxSnapshot {
  /** Seconds since the oldest due, unsent row of each kind became due; 0 when none. */
  readonly oldestDueSeconds: Readonly<Record<OutboxKind, number>>;
  /** The same per kind and template class (`message` split into `otp` and `other`). */
  readonly oldestDueByClass: Readonly<Record<OutboxKind, Partial<Record<TemplateClass, number>>>>;
  readonly rows: Readonly<Record<OutboxKind, Readonly<Record<CountedStatus, number>>>>;
}

interface GaugeRow extends Record<string, unknown> {
  kind: OutboxKind;
  template_class: TemplateClass;
  status: CountedStatus;
  rows: number;
  oldest_due_s: number | null;
}

/**
 * One query (plan 2.3). A row is due when it is `pending` or `enqueued` and its next attempt time
 * has passed; rows the relay holds for an account that is neither provisioned nor active do not
 * count (they are not late, they wait for the account), except `internal_event`, which the relay
 * never holds (A-23). Open rows use the partial indexes of 0007, dead rows the finished index.
 */
export async function readOutboxSnapshot(db: PlatformDatabase): Promise<OutboxSnapshot> {
  const result = await db.execute<GaugeRow>(sql`
    SELECT o.kind,
           CASE WHEN o.kind <> 'message' THEN 'n/a'
                WHEN coalesce(o.payload ->> 'template_key', o.payload ->> 'template') = 'auth_otp'
                  THEN 'otp'
                ELSE 'other' END AS template_class,
           o.status,
           count(*)::int AS rows,
           EXTRACT(EPOCH FROM now() - min(o.next_attempt_at) FILTER (
             WHERE o.status IN ('pending', 'enqueued')
               AND o.next_attempt_at <= now()
               AND (o.account_id IS NULL OR o.kind = 'internal_event'
                    OR a.status IN ('provisioned', 'active'))
           ))::float8 AS oldest_due_s
      FROM core_outbox o
      LEFT JOIN core_accounts a ON a.id = o.account_id
     WHERE o.status IN ('pending', 'enqueued', 'dead')
     GROUP BY 1, 2, 3`);
  const oldestDueSeconds = Object.fromEntries(outboxKinds.map((kind) => [kind, 0])) as Record<
    OutboxKind,
    number
  >;
  const oldestDueByClass = Object.fromEntries(
    outboxKinds.map((kind) => [
      kind,
      Object.fromEntries(templateClassesOf(kind).map((templateClass) => [templateClass, 0])),
    ]),
  ) as Record<OutboxKind, Partial<Record<TemplateClass, number>>>;
  const rows = Object.fromEntries(
    outboxKinds.map((kind) => [kind, { pending: 0, enqueued: 0, dead: 0 }]),
  ) as Record<OutboxKind, Record<CountedStatus, number>>;
  for (const row of result) {
    if (!(row.kind in rows)) continue;
    rows[row.kind][row.status] += Number(row.rows);
    const age = row.oldest_due_s === null ? 0 : Math.max(0, Number(row.oldest_due_s));
    oldestDueSeconds[row.kind] = Math.max(oldestDueSeconds[row.kind], age);
    const byClass = oldestDueByClass[row.kind];
    if (row.template_class in byClass) {
      byClass[row.template_class] = Math.max(byClass[row.template_class] ?? 0, age);
    }
  }
  return { oldestDueSeconds, oldestDueByClass, rows };
}

/** Stores a snapshot in the observed gauges (every kind, zeros included, so alerts evaluate). */
export function observeSnapshot(metrics: Metrics, snapshot: OutboxSnapshot): void {
  for (const kind of outboxKinds) {
    for (const templateClass of templateClassesOf(kind)) {
      metrics.set(
        'outbox_due_oldest_age_seconds',
        snapshot.oldestDueByClass[kind][templateClass] ?? 0,
        { kind, template_class: templateClass },
      );
    }
    for (const status of countedStatuses) {
      metrics.set('outbox_rows', snapshot.rows[kind][status], { kind, status });
    }
  }
}

/** One gauge run: read and store; a failed read keeps the previous values and is logged. */
export async function runOutboxGauges(
  db: PlatformDatabase,
  metrics: Metrics,
  logger: { warn(message: string): void },
): Promise<void> {
  try {
    observeSnapshot(metrics, await readOutboxSnapshot(db));
  } catch (error) {
    logger.warn(`Outbox gauges skipped: ${error instanceof Error ? error.name : 'unknown error'}`);
  }
}
