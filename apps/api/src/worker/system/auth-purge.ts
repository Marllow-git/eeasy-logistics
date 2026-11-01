import { randomUUID } from 'node:crypto';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type { AuditSink } from '../../modules/kernel/audit/audit-sink.js';
import type { AuthPurgeCounts } from '../../modules/kernel/platform/identity.repository.js';
import { IdentityPurgeRepository } from '../../modules/kernel/platform/identity.repository.js';

// The identity rows' retention (PLAT-11 plan 2.13; data §10), the second statement set of the
// hourly OTP purge (same job, same lock `elx:lock:otp-prune`, otp-purge.ts): refresh, invitation,
// password-reset and challenge rows 7 days after the latest of expiry, use, acceptance,
// consumption or revocation; a refresh row's kept successor an hour after its use. One platform
// transaction and one audit row with the counts (`core.auth_rows.purged`).

export const authPurgeAuditAction = 'core.auth_rows.purged';

export async function purgeAuthRows(
  db: PlatformDatabase,
  audit: Pick<AuditSink, 'record'>,
  runId: string = randomUUID(),
): Promise<AuthPurgeCounts> {
  return withPlatformUnitOfWork(db, async (uow) => {
    const counts = await new IdentityPurgeRepository(uow).purge();
    await audit.record({
      actorType: 'system',
      actorId: null,
      accountId: null,
      targetType: 'auth_purge',
      targetId: runId,
      action: authPurgeAuditAction,
      after: {
        successors_cleared: counts.successorsCleared,
        refresh_rows: counts.refreshTokens,
        invitations: counts.invitations,
        reset_rows: counts.passwordResets,
        challenges: counts.challenges,
      },
      requestId: runId,
    });
    return counts;
  });
}
