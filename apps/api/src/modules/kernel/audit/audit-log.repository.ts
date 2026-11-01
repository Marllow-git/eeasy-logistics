import type { UnitOfWork } from '@eeasy-logistics/db';
import { ScopedRepository } from '@eeasy-logistics/db';
import { coreAuditLog } from '../schema/audit-log.js';
import type { AuditPageQuery, AuditRow } from './audit-log.query.js';
import { auditPageCondition, auditPageOrder } from './audit-log.query.js';

/** A row as the writer stores it; `id` and `occurred_at` come from the database defaults. */
export type AuditInsert = Omit<typeof coreAuditLog.$inferInsert, 'id' | 'occurredAt'>;

/**
 * The tenant side of `core_audit_log` (ADR-0025): every statement carries the context's account.
 * Appends and keyset pages (PLAT-7 plan 2.6); the table refuses anything else (data §3.1). Under
 * the cross-tenant door the context's account is the door's target.
 */
export class AuditLogRepository extends ScopedRepository<typeof coreAuditLog> {
  constructor(uow: UnitOfWork) {
    super(uow, coreAuditLog);
  }

  /** Appends one row for the context's account (the account of `row` is ignored). */
  async append(row: AuditInsert): Promise<void> {
    const tenantRow: Partial<AuditInsert> = { ...row };
    delete tenantRow.accountId; // the base sets it from the context
    await this.insertMany([tenantRow as Omit<AuditInsert, 'accountId'>]);
  }

  /** One page of the context account's rows (`listAuditLog`, the door operations). */
  page(query: AuditPageQuery): Promise<AuditRow[]> {
    return this.findMany(auditPageCondition(query), {
      orderBy: auditPageOrder(query.sort),
      limit: query.limit,
    });
  }
}
