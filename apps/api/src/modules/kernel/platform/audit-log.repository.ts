import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, getPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { and, isNull } from 'drizzle-orm';
import type { AuditPageQuery, AuditRow } from '../audit/audit-log.query.js';
import { auditPageCondition, auditPageOrder } from '../audit/audit-log.query.js';
import type { AuditInsert } from '../audit/audit-log.repository.js';
import { coreAuditLog } from '../schema/audit-log.js';

/**
 * The platform side of `core_audit_log` (elx_platform): rows of platform actions, which carry the
 * account they concern or none (data §2.4), and the committed rows of refusals. Appends only.
 */
export class PlatformAuditLog extends PlatformRepository<typeof coreAuditLog> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, coreAuditLog);
  }

  async append(row: AuditInsert): Promise<void> {
    await this.unscoped().insert(coreAuditLog).values(row);
  }

  /**
   * One page of the platform's own rows, those with no account (`platformListAudit` without
   * `account_id`, PLAT-7 plan 2.7). Account rows are read only through the cross-tenant door.
   */
  platformPage(query: AuditPageQuery): Promise<AuditRow[]> {
    return this.unscoped()
      .select()
      .from(coreAuditLog)
      .where(and(isNull(coreAuditLog.accountId), auditPageCondition(query)))
      .orderBy(...auditPageOrder(query.sort))
      .limit(query.limit);
  }
}

/** The platform audit log of the current platform unit of work; throws outside one. */
export function currentPlatformAuditLog(): PlatformAuditLog {
  return new PlatformAuditLog(getPlatformUnitOfWork());
}
