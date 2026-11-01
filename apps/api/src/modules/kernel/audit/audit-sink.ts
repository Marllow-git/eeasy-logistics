import { Injectable, Logger } from '@nestjs/common';

/**
 * One cross-tenant access by platform staff (PLAT-6 plan 2.7; identity and tenancy §5, §7):
 * who, on which account, through which operation, why, in which request.
 */
export interface AuditEvent {
  readonly kind: 'cross_tenant_access';
  /** The platform user id. */
  readonly actor: string;
  /** The target account id. */
  readonly accountId: string;
  /** `<Controller>.<handler>` until operation ids come from the contracts (PLAT-15). */
  readonly operation: string;
  /** The `X-Support-Reason` text, 1 to 200 characters. */
  readonly reason: string;
  readonly requestId: string;
  readonly at: string;
}

/**
 * Where audit events go. Called inside the request's transaction, before the handler: PLAT-7
 * replaces the log implementation with the `core_audit_log` writer in the same transaction.
 */
export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

export const AUDIT_SINK = Symbol('AUDIT_SINK');

/** The wave 0 sink: one structured JSON log line per event (JSON escapes any control text). */
@Injectable()
export class LogAuditSink implements AuditSink {
  private readonly logger = new Logger('Audit');

  record(event: AuditEvent): Promise<void> {
    this.logger.log(JSON.stringify(event));
    return Promise.resolve();
  }
}
