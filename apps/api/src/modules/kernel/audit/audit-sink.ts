import type { AuditActorType } from '../schema/audit-log.js';

/**
 * One audited action (PLAT-7 plan 2.4; identity and tenancy §7; data §2.1 `core_audit_log`): who
 * (`actorType`, `actorId`), on which account, on what (`targetType`, `targetId`), what
 * (`action`, `<module>.<object>.<verb>` in the past tense, e.g. `platform.cross_tenant.accessed`),
 * the state before and after (redacted before storage), why (`reason`) and in which request.
 */
export interface AuditEvent {
  readonly actorType: AuditActorType;
  /** The user, key, driver or platform user; null only for `system`. */
  readonly actorId: string | null;
  /** The acting account; null for platform actions with no account. */
  readonly accountId: string | null;
  readonly targetType: string;
  readonly targetId: string;
  readonly action: string;
  readonly before?: unknown;
  readonly after?: unknown;
  /** `X-Support-Reason` on cross-tenant calls; free text otherwise. */
  readonly reason?: string | null;
  /** The id the server minted for the request (PLAT-6 adversary L-4), or the job run's id. */
  readonly requestId: string;
  /** The caller's own `X-Request-Id`, folded into `after.client_request_id`; never trusted. */
  readonly clientRequestId?: string | null;
  /** The client address as Express resolves it behind the trusted proxies (`request.ip`). */
  readonly ip?: string | null;
  /** Stored truncated to 512 characters. */
  readonly userAgent?: string | null;
}

/**
 * Where audit events go: `core_audit_log` (the kernel binds `AuditWriter` to `AUDIT_SINK`).
 *
 * - `record` writes in the current unit of work (tenant or platform), so the row commits or rolls
 *   back with the action it describes; it throws outside a unit of work.
 * - `recordCommitted` writes on a transaction of its own, committed whatever the request does
 *   (refusals, and the outcome of a cross-tenant call; PLAT-6 rulings M-5 and L-4).
 */
export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
  recordCommitted(event: AuditEvent): Promise<void>;
}

export const AUDIT_SINK = Symbol('AUDIT_SINK');
