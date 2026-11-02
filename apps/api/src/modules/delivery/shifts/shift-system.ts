import type { Locale } from '@eeasy-logistics/i18n/push';
import type { AuditSink, OutboxWriter } from '../../kernel/public/index.js';
import type { LocationFanout } from '../locations/location-fanout.js';
import { ShiftsService } from './shifts.service.js';

// The sweeper's shift writes (DEL-5 plan 2.5, 2.8) over one account, in a tenant unit of work on
// elx_app that the worker opens for the account (leg 1 ruling on 8.2 #1), through `ShiftsService`,
// so the arrows, the driver row locks, the events and the audit rows are the doors' own.

export interface SystemShiftDependencies {
  readonly audit: AuditSink;
  readonly outbox: Pick<OutboxWriter, 'enqueue'>;
  /** Deletes an ended shift's latest-position key after the commit; none without Redis. */
  readonly fanout?: Pick<LocationFanout, 'forget'> | null;
}

export interface ShiftSweep {
  readonly noShows: number;
  readonly ended: number;
  readonly stale: number;
}

/**
 * One account's sweep at `now` (plan 2.5, 2.8): the no-shows, the live shifts 60 minutes past
 * their planned end (adversary round 1, finding 1), then the stale alerts (`locales`:
 * each driver's language for the push). The caller's unit of work is the account's.
 */
export async function sweepAccountShifts(
  deps: SystemShiftDependencies,
  options: {
    readonly now: Date;
    readonly runId: string;
    readonly locales: ReadonlyMap<string, Locale>;
  },
): Promise<ShiftSweep> {
  const service = new ShiftsService({ ...deps, now: () => options.now });
  const noShows = await service.markNoShows(options.runId);
  const ended = await service.endOverdue(options.runId);
  const stale = await service.alertStale(options.locales);
  return { noShows, ended, stale };
}
