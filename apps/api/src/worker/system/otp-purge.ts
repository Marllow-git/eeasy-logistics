import { randomUUID } from 'node:crypto';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type { Redis } from 'ioredis';
import type { AuditSink } from '../../modules/kernel/audit/audit-sink.js';
import type { OtpPurgeCounts } from '../../modules/kernel/platform/messaging.repository.js';
import { MessagingRepository } from '../../modules/kernel/platform/messaging.repository.js';

// The OTP purge (PLAT-9 plan 2.6, 2A.6; data §10; integrations §4.1 row `message`): every hour,
// under the Redis lock `elx:lock:otp-prune`, one platform transaction deletes
// - `message` rows of the `auth_otp` template an hour after they finished (`done_at`, or
//   `created_at` for a row that never finished: superseded, dead or still open), so an encrypted
//   code never outlives the hour, and before the outbox's 7-day prune would reach them;
// - `core_otp_challenges` an hour after `expires_at`;
// - `core_engine_callback_nonces` older than 24 h (engine contract §2.5 retention);
// and writes one audit row with the counts (`core.otp_rows.purged`), in the same transaction.

export const otpPurgeLockKey = 'elx:lock:otp-prune';
/** The lock outlives one run and expires before the next hourly one. */
export const otpPurgeLockTtlMs = 55 * 60 * 1000;
export const otpPurgeIntervalMs = 60 * 60 * 1000;
export const otpPurgeAuditAction = 'core.otp_rows.purged';

export type OtpPurgeRun =
  { readonly ran: true; readonly counts: OtpPurgeCounts } | { readonly ran: false };

/** One purge pass and its audit row, in one platform transaction. */
export async function purgeOtpRows(
  db: PlatformDatabase,
  audit: Pick<AuditSink, 'record'>,
  runId: string = randomUUID(),
): Promise<OtpPurgeCounts> {
  return withPlatformUnitOfWork(db, async (uow) => {
    const counts = await new MessagingRepository(uow).purgeOtpRows();
    await audit.record({
      actorType: 'system',
      actorId: null,
      accountId: null,
      targetType: 'otp_purge',
      targetId: runId,
      action: otpPurgeAuditAction,
      after: counts,
      requestId: runId,
    });
    return counts;
  });
}

/** One scheduled run: takes the lock (`SET NX PX`, 55 min) and purges; a held lock means skip. */
export async function runOtpPurge(
  db: PlatformDatabase,
  redis: Pick<Redis, 'set'>,
  audit: Pick<AuditSink, 'record'>,
  lockKey: string = otpPurgeLockKey,
): Promise<OtpPurgeRun> {
  const acquired = await redis.set(lockKey, randomUUID(), 'PX', otpPurgeLockTtlMs, 'NX');
  if (acquired !== 'OK') return { ran: false };
  return { ran: true, counts: await purgeOtpRows(db, audit) };
}
