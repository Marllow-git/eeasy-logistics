import { isIP } from 'node:net';
import { findContext, getUnitOfWork } from '@eeasy-logistics/db';
import type { PlatformDatabase, PlatformUnitOfWork, Pool } from '@eeasy-logistics/db/committed';
import { withCommittedSideEffect } from '@eeasy-logistics/db/committed';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { PlatformAuditLog, currentPlatformAuditLog } from '../platform/audit-log.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import type { AuditInsert } from './audit-log.repository.js';
import { AuditLogRepository } from './audit-log.repository.js';
import type { AuditEvent, AuditSink } from './audit-sink.js';
import type { AuditJson } from './redaction.js';
import { redactForAudit, redactText } from './redaction.js';

export const maxUserAgentLength = 512;

/** The row of `event`, redacted (plan 2.5): nothing unredacted ever reaches the table. */
export function auditRow(event: AuditEvent): AuditInsert {
  let after: AuditJson = redactForAudit(event.after);
  if (event.clientRequestId !== undefined && event.clientRequestId !== null) {
    // Folded in after redaction (a UUID the request-id middleware accepted, never a secret).
    const base =
      after !== null && typeof after === 'object' && !Array.isArray(after)
        ? after
        : after === null
          ? {}
          : { value: after };
    after = { ...base, client_request_id: event.clientRequestId };
  }
  return {
    actorType: event.actorType,
    actorId: event.actorId,
    accountId: event.accountId,
    targetType: event.targetType,
    targetId: event.targetId,
    action: event.action,
    before: redactForAudit(event.before),
    after,
    reason: redactText(event.reason),
    requestId: event.requestId,
    // `inet` refuses anything else; a forged forwarded value is stored as unknown (adversary L-2).
    ip: event.ip !== undefined && event.ip !== null && isIP(event.ip) !== 0 ? event.ip : null,
    userAgent:
      event.userAgent === undefined || event.userAgent === null
        ? null
        : Array.from(event.userAgent).slice(0, maxUserAgentLength).join(''),
  };
}

/**
 * The `core_audit_log` writer behind `AUDIT_SINK` (PLAT-7 plan 2.4), replacing the wave 0 log sink.
 */
@Injectable()
export class AuditWriter implements AuditSink {
  constructor(
    @Optional() @Inject(PLATFORM_POOL) private readonly pool?: Pool<PlatformDatabase> | null,
  ) {}

  /**
   * In the current unit of work: a tenant one (staff, driver, the cross-tenant door) appends for
   * its own account, which must be the event's; a platform one appends the event's account as
   * given. The row commits or rolls back with the action. Throws outside a unit of work.
   */
  async record(event: AuditEvent): Promise<void> {
    const row = auditRow(event);
    const context = findContext();
    if (context !== undefined) {
      if (event.accountId !== context.accountId) {
        throw new Error('An audit event in a tenant unit of work belongs to its account');
      }
      await new AuditLogRepository(getUnitOfWork()).append(row);
      return;
    }
    await currentPlatformAuditLog().append(row);
  }

  /**
   * In the platform unit of work `uow`, whatever the ambient frame is: a tenant request that writes
   * a platform table (the account settings) audits the change in the transaction that makes it, so
   * the two commit or roll back together, independently of the request's own app transaction
   * (PLAT-12 adversary M-1, K-7). The event's account is stored as given.
   */
  async recordIn(uow: PlatformUnitOfWork, event: AuditEvent): Promise<void> {
    await new PlatformAuditLog(uow).append(auditRow(event));
  }

  /**
   * On a transaction of its own on the platform pool, committed whatever the request's transaction
   * does (PLAT-6 rulings M-5, L-4). Without the platform pool (outside production only) it throws,
   * so a refusal is never answered unaudited.
   */
  async recordCommitted(event: AuditEvent): Promise<void> {
    const pool = this.pool;
    if (pool === undefined || pool === null) {
      throw new Error('The committed audit writer needs DATABASE_URL_PLATFORM');
    }
    const row = auditRow(event);
    await withCommittedSideEffect(pool, (uow) => new PlatformAuditLog(uow).append(row));
  }
}
