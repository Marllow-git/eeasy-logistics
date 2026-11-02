// The kernel's public surface: the only path other contexts may import from (ADR-0026).
export { ApiException, type FieldProblem } from '../errors/api-exception.js';
export type { ErrorCode } from '../errors/error-codes.js';
export { Public } from '../tenancy/frame.js';
export { CrossTenant } from '../tenancy/cross-tenant.js';
export { AUDIT_SINK, type AuditEvent, type AuditSink } from '../audit/audit-sink.js';
export { Idempotent } from '../idempotency/idempotency.interceptor.js';
export type { IdempotentOptions } from '../idempotency/idempotency.js';
export {
  Input,
  Operation,
  type ContractInput,
  type OperationSchemas,
} from '../contract/contract-pipe.js';
// Authorization (PLAT-10): site scoping for handlers and repositories, the separation-of-duties
// checks for membership writes (PLAT-12) and approvals (WMS), and the role bundles they read.
export { SiteScoped, siteFilter, type SiteScopedSource } from '../authz/site-scope.js';
export {
  assertRoleCombination,
  assertSeparation,
  type ApprovalParties,
} from '../authz/separation.js';
export {
  PERMISSION_RESOLVER,
  type PermissionResolver,
  type RoleBundle,
} from '../authz/permission-resolver.js';
export { OutboxWriter, type OutboxEntry } from '../outbox/outbox-writer.js';
export type { DomainEvent, DomainEventType, EventPayload } from '../outbox/domain-event.js';
export type { OutboxKind } from '../schema/outbox.js';
// Telemetry (PLAT-14): one span per provider call for every adapter, and the metric catalogue.
export { withPortSpan, type PortCall, type PortSpan } from '../telemetry/port-span.js';
export { getMetrics, type MetricName } from '../telemetry/metrics.js';
// Sessions (PLAT-11 plan 2.5): the cookie names, for the web middleware's documentation.
export { sessionCookieNames } from '../auth/cookies.js';
// Invitations (PLAT-11 plan 2.10): PLAT-12's member doors and PLAT-13's platform staff doors. They
// answer ids only; the accept link goes by mail (adversary M-3), so no door can echo it.
export {
  Invitations,
  type CreatedInvitation,
  type PlatformInvitation,
  type StaffInvitation,
} from '../auth/invitations.js';
// Second-factor resets (PLAT-11 plan 2.8): PLAT-12's `resetMemberSecondFactor`.
export {
  SecondFactorResets,
  type IssuedLink,
  type SecondFactorLinkRequest,
} from '../auth/second-factor-resets.js';
