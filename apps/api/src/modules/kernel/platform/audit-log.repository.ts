import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, getPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
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
}

/** The platform audit log of the current platform unit of work; throws outside one. */
export function currentPlatformAuditLog(): PlatformAuditLog {
  return new PlatformAuditLog(getPlatformUnitOfWork());
}
