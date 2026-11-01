import type {
  PlatformListAccountAudit200,
  PlatformListAudit200,
  AuditLogEntry as PlatformAuditLogEntry,
} from '@eeasy-logistics/contracts/platform/schemas';
import type { AuditLogEntry, ListAuditLog200 } from '@eeasy-logistics/contracts/staff/schemas';
import type { AuditRow } from './audit-log.query.js';

// Rows of core_audit_log to the contract's `AuditLogEntry` pages (PLAT-7 plan 2.6, 2.7; A-17: one
// of the two places contract types appear). Nullable columns the contract types as plain strings
// (`actor_id`, `ip`, `user_agent`) are omitted when empty.

const postgresTimestamp =
  /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?([+-]\d{2})(?::?(\d{2}))?$/;

/**
 * PostgreSQL's text form of a timestamptz as ISO 8601 in UTC, microseconds kept (an offset moves
 * whole minutes, so the fraction is unchanged).
 */
export function isoFromPostgres(text: string): string {
  const match = postgresTimestamp.exec(text);
  if (match === null) return new Date(text).toISOString();
  const [, date, time, fraction, hours, minutes] = match;
  const whole = new Date(`${date}T${time}${hours}:${minutes ?? '00'}`).toISOString().slice(0, 19);
  return `${whole}${fraction === undefined ? '' : `.${fraction}`}Z`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
}

export interface PresentOptions {
  /**
   * The staff surface: a platform staff member's address and browser are platform data, so a
   * merchant sees that platform staff acted, why and when, but not from where.
   */
  readonly hidePlatformNetwork: boolean;
}

export function presentAuditEntry(row: AuditRow, options: PresentOptions): AuditLogEntry {
  const hideNetwork = options.hidePlatformNetwork && row.actorType === 'platform_user';
  return {
    id: row.id,
    occurred_at: isoFromPostgres(row.occurredAt),
    actor_type: row.actorType,
    ...(row.actorId === null ? {} : { actor_id: row.actorId }),
    account_id: row.accountId,
    target_type: row.targetType,
    target_id: row.targetId,
    action: row.action,
    before: asObject(row.before),
    after: asObject(row.after),
    request_id: row.requestId,
    ...(row.ip === null || hideNetwork ? {} : { ip: row.ip }),
    ...(row.userAgent === null || hideNetwork ? {} : { user_agent: row.userAgent }),
    reason: row.reason,
  };
}

export interface AuditPage {
  readonly rows: readonly AuditRow[];
  readonly nextCursor: string | null;
}

export function presentStaffAuditPage(page: AuditPage): ListAuditLog200 {
  return {
    data: page.rows.map((row) => presentAuditEntry(row, { hidePlatformNetwork: true })),
    next_cursor: page.nextCursor,
  };
}

export function presentPlatformAuditPage(
  page: AuditPage,
): PlatformListAudit200 & PlatformListAccountAudit200 {
  const data: PlatformAuditLogEntry[] = page.rows.map((row) =>
    presentAuditEntry(row, { hidePlatformNetwork: false }),
  );
  return { data, next_cursor: page.nextCursor };
}
