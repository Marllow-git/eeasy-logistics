// The kernel's public surface: the only path other contexts may import from (ADR-0026).
export { ApiException, type FieldProblem } from '../errors/api-exception.js';
export type { ErrorCode } from '../errors/error-codes.js';
export { Public } from '../tenancy/frame.js';
export { CrossTenant } from '../tenancy/cross-tenant.js';
export { AUDIT_SINK, type AuditEvent, type AuditSink } from '../audit/audit-sink.js';
export { Idempotent } from '../idempotency/idempotency.interceptor.js';
export type { IdempotentOptions } from '../idempotency/idempotency.js';
