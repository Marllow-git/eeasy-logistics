// The kernel's public surface: the only path other contexts may import from (ADR-0026).
export { ApiException, type FieldProblem } from '../errors/api-exception.js';
export type { ErrorCode } from '../errors/error-codes.js';
export { CommittedRefusal, NoUnitOfWork, Public } from '../tenancy/frame.js';
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
export { requestSurface } from '../auth/surfaces.js';
// Invitations (PLAT-11 plan 2.10): PLAT-12's member doors and PLAT-13's platform staff doors. They
// answer ids only; the accept link goes by mail (adversary M-3), so no door can echo it.
export {
  Invitations,
  type CreatedInvitation,
  type PlatformInvitation,
  type StaffInvitation,
} from '../auth/invitations.js';
// Push (INT-4 plan 2.1, 2.3, 2.5): the port, the `push` row payload the Delivery producers write,
// and the token invalidation registry DEL-4 fills with "clear `push_token` on that device row".
export type { PushPayload } from '../push/push.handler.js';
export type { PushTemplateKey } from '../push/push-templates.js';
export type {
  PushChannel,
  PushMessage,
  PushReceipt,
  PushSender,
  PushTicket,
} from '../push/push-sender.js';
export {
  PushTokenInvalidations,
  type PushTokenInvalidation,
  type PushTokenInvalidationHandler,
} from '../push/invalidations.js';
// Second-factor resets (PLAT-11 plan 2.8): PLAT-12's `resetMemberSecondFactor`.
export {
  SecondFactorResets,
  type IssuedLink,
  type SecondFactorLinkRequest,
} from '../auth/second-factor-resets.js';
// Sites (PLAT-12 plan 2.6): DEL-2, DEL-8 and WMS-2 register what keeps a site in use.
export { SiteUseChecks, type SiteRole, type SiteUseCheck } from '../sites/site-use.js';
// Drivers (DEL-4 plan 2.1 to 2.6): the module Delivery's driver doors import (the audit sink, the
// outbox writer), the driver tables (kernel-owned schema files), the driver's person and membership
// (`DriverIdentities`), the request facts of the audit rows, the list-page helpers, the text and
// phone rules, and the template check of the WhatsApp app invitation.
export { KernelModule } from '../kernel.module.js';
export {
  defaultDriverCapacity,
  delDriverDevices,
  delDrivers,
  delVehicles,
  devicePlatforms,
  driverStatuses,
  maxActiveDevices,
  vehicleKinds,
  type DevicePlatform,
  type DriverStatus,
  type VehicleKind,
} from '../schema/drivers.js';
export {
  DriverIdentities,
  driverIdentitiesProvider,
  type DriverAccount,
  type DriverPerson,
  type DriverSite,
} from '../auth/driver-identities.js';
export { AuthRequest, type RequestFacts } from '../auth/request-facts.js';
// The driver's sign-in (DEL-4 plan 2.7, 2.8): the kernel checks the code and issues the tokens on the
// device row Delivery binds.
export { DriverSignIn, driverSignInProvider, type SignedInDriver } from '../auth/driver-sign-in.js';
export type { IssuedSession } from '../auth/cookies.js';
// The cash PIN (DEL-4 plan 2.9): hashed and verified with PLAT-11's Argon2id parameters.
export { PasswordHasher } from '../auth/passwords.js';
export {
  CURSOR_CODEC,
  CursorCodec,
  enumListFilter,
  keysetAfter,
  keysetOrder,
  keysetSlice,
  planListPage,
  presentPage,
  textQuery,
  type ListPage,
  type ListPagePlan,
  type ListSorts,
  type PageKey,
} from '../contract/list-page.js';
export { oneLineTextProblem } from '../contract/text-rules.js';
export { normalisePhone, phoneTail } from '../messaging/phone.js';
export { templateParamsProblem } from '../messaging/templates.js';
// Geocoding (INT-2 plan 2.1, 2.6): DEL-2's intake and the site geocode step inject `GEOCODER`.
export { GEOCODER, GeocoderService, type GeocodeOptions } from '../geocoding/geocoder.service.js';
export {
  GeocoderInputError,
  normaliseShortCode,
  type GeoPoint,
  type GeocodeLocale,
  type GeocodeQuery,
  type GeocodeResult,
  type GeocoderProviderName,
  type NotFound,
  type ReverseResult,
  type ShortCodeResult,
  type Unavailable,
} from '../geocoding/geocoder.js';
// Feature gate (PLAT-13 plan 2.5): DEL and WMS routes carry `@Feature('delivery' | 'wms')`.
export { Feature, FeatureGate } from '../features/feature-gate.js';
export { featureKeys, type FeatureKey } from '../features/feature-keys.js';
// Zones and coverage (DEL-1 plan 2.1, 2.4, 2.6): the tables (kernel-owned schema files), the kind
// and status of the sites a coverage door names, the provisioning doors' account check and door.
export { delCoverage, delZones, zoneSources, type ZoneSource } from '../schema/zones.js';
// DEL-5: driver shifts and location telemetry (plan 2.1), Delivery's tables in the kernel's folder.
export {
  delDriverShifts,
  liveShiftStatuses,
  shiftStatuses,
  type ShiftStatus,
} from '../schema/shifts.js';
export {
  delDriverLocationHeads,
  delDriverLocations,
  delDriverTrails,
  locationRingSize,
} from '../schema/locations.js';
export { siteSummaries, type SiteSummary } from '../sites/sites.repository.js';
// DEL-5 plan 2.6: the named `driver_locations` budget the location ingest charges per driver.
export { RATE_LIMITER, type RateLimiter } from '../rate-limit/rate-limiter.js';
export { assertProvisionable } from '../provisioning/provisioning-door.js';
export { optionalReason } from '../tenancy/cross-tenant.js';
