import { randomUUID } from 'node:crypto';
import type { PlatformDatabase } from '@eeasy-logistics/db/platform';
import { withPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type { AuditSink } from '../../modules/kernel/audit/audit-sink.js';
import { GeocodeCacheRepository } from '../../modules/kernel/platform/geocode-cache.repository.js';

// The geocode cache's retention (INT-2 plan 2.4), a statement set of the hourly OTP purge (same
// job, same lock `elx:lock:otp-prune`, otp-purge.ts): expired `core_geocode_cache` rows deleted in
// one platform transaction, with one audit row of the count (`core.geocode_cache.purged`) when a
// run deleted any (INT-4's push-ticket purge does the same, so an idle hour writes nothing).

export const geocodeCachePurgeAuditAction = 'core.geocode_cache.purged';

export async function purgeGeocodeCache(
  db: PlatformDatabase,
  audit: Pick<AuditSink, 'record'>,
  runId: string = randomUUID(),
): Promise<number> {
  return withPlatformUnitOfWork(db, async (uow) => {
    const rows = await new GeocodeCacheRepository(uow).purgeExpired();
    if (rows > 0) {
      await audit.record({
        actorType: 'system',
        actorId: null,
        accountId: null,
        targetType: 'geocode_cache_purge',
        targetId: runId,
        action: geocodeCachePurgeAuditAction,
        after: { rows },
        requestId: runId,
      });
    }
    return rows;
  });
}
