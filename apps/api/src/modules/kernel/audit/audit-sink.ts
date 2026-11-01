import { Injectable, Logger } from '@nestjs/common';

/**
 * One cross-tenant call by platform staff (PLAT-6 plan 2.7; identity and tenancy §5, §7): who, on
 * which account, through which operation, why, in which request, and whether the door let it
 * through. Every attempt is recorded, refusals included (review round 1).
 */
export interface AuditEvent {
  readonly kind: 'cross_tenant_access';
  /** The platform user id. */
  readonly actor: string;
  /** The target account id; null when the path value was not a well-formed id. */
  readonly accountId: string | null;
  /** `<Controller>.<handler>` until operation ids come from the contracts (PLAT-15). */
  readonly operation: string;
  /** The `X-Support-Reason` text, 1 to 200 characters; null when missing or refused. */
  readonly reason: string | null;
  /** `ok`: the handler ran; otherwise the door refused the call before any tenant row was read. */
  readonly outcome: 'ok' | 'not_found' | 'reason_missing' | 'reason_invalid';
  /** The id the server minted for the request (adversary L-4). */
  readonly requestId: string;
  /** The caller's own `X-Request-Id` (a UUID) when it sent one; never used as the request id. */
  readonly clientRequestId: string | null;
  readonly at: string;
}

/**
 * Where audit events go. An `ok` event is recorded inside the door's transaction, before the
 * handler; a refusal after the door refused (no transaction is left). PLAT-7 replaces the log
 * implementation with the `core_audit_log` writer, which must persist refusals on its own.
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
