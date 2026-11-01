import type postgres from 'postgres';

// Reading core_audit_log back in the integration tests (PLAT-7), as the owner (no policy applies).

export interface AuditRow {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly accountId: string | null;
  readonly targetType: string;
  readonly targetId: string;
  readonly action: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly requestId: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly reason: string | null;
}

const columns = (sql: postgres.Sql) => sql`
  id, occurred_at::text AS "occurredAt", actor_type AS "actorType", actor_id AS "actorId",
  account_id AS "accountId", target_type AS "targetType", target_id AS "targetId", action, before,
  after, request_id AS "requestId", host(ip) AS ip, user_agent AS "userAgent", reason`;

/** Every row a request wrote, by the server-minted request id, oldest first. */
export function auditRowsOf(sql: postgres.Sql, requestId: string): Promise<AuditRow[]> {
  return sql<AuditRow[]>`
    SELECT ${columns(sql)} FROM core_audit_log WHERE request_id = ${requestId}
    ORDER BY occurred_at, id`;
}

/** Every row of a request that sent `X-Request-Id: <clientId>`. */
export function auditRowsByClientId(sql: postgres.Sql, clientId: string): Promise<AuditRow[]> {
  return sql<AuditRow[]>`
    SELECT ${columns(sql)} FROM core_audit_log WHERE after->>'client_request_id' = ${clientId}
    ORDER BY occurred_at, id`;
}
