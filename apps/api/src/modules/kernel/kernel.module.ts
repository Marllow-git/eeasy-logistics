import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, DiscoveryModule } from '@nestjs/core';
import { AUDIT_SINK } from './audit/audit-sink.js';
import { AccountController } from './accounts/account.controller.js';
import { AuditLogController } from './audit/audit-log.controller.js';
import { AuditWriter } from './audit/audit-writer.js';
import { DenialAuditThrottle } from './authz/denial-throttle.js';
import { FeatureGate } from './features/feature-gate.js';
import { PlatformFeaturesController } from './features/platform-features.controller.js';
import { OperationRoutesCheck } from './authz/operation-routes.check.js';
import { PermissionGuard } from './authz/permission.guard.js';
import { PlatformAuditLogController } from './audit/platform-audit-log.controller.js';
import { ContractPipe } from './contract/contract-pipe.js';
import type { GeocoderSetup } from './geocoding/geocoders.js';
import { GEOCODER_SETUP } from './geocoding/geocoders.js';
import { GEOCODER, GeocoderService } from './geocoding/geocoder.service.js';
import { IdempotentRoutesCheck } from './idempotency/idempotency.interceptor.js';
import { ApiExceptionFilter } from './errors/exception.filter.js';
import { OutboxWriter } from './outbox/outbox-writer.js';
import { PlatformOutboxController } from './outbox/platform-outbox.controller.js';
import { RequestIdMiddleware } from './request/request-id.js';
import { SiteUseChecks } from './sites/site-use.js';
import { SitesController } from './sites/sites.controller.js';
import { ContentTypeGuard } from './request/content-type.guard.js';
import { WebClientGuard } from './request/web-client.guard.js';
import { RequestTelemetryInterceptor } from './telemetry/request-telemetry.interceptor.js';
import { TenancyGuard } from './tenancy/tenancy.guard.js';
import { UnitOfWorkInterceptor } from './tenancy/unit-of-work.interceptor.js';

/**
 * Shared kernel context (`core_` tables). Imports no other context (ADR-0026). It owns the request
 * frame every handler runs in (PLAT-6): the request id middleware first in the chain, the global
 * tenancy guard (with the rate limits), the web client marker guard, the per-request unit of work (the first interceptor, so route interceptors run
 * inside its transaction) and the one global exception filter. Their configured parts (signing
 * key, pools) come from `RequestFrameModule.forRoot` and `DatabaseModule.forRoot`; without them
 * every non-public request is refused.
 */
@Module({
  imports: [DiscoveryModule],
  // The audit log reads (PLAT-7): listAuditLog, platformListAccountAudit, platformListAudit; the
  // platform outbox operations (PLAT-8): list, read and replay rows, list the consumers.
  // PLAT-12: the staff surface's account doors (getAccount, getAccountSettings,
  // updateAccountSettings) and site doors (listSites, createSite, getSite, updateSite,
  // deactivateSite, activateSite). PLAT-13: the rollout modes and an account's feature flags.
  controllers: [
    AuditLogController,
    PlatformAuditLogController,
    PlatformOutboxController,
    AccountController,
    SitesController,
    PlatformFeaturesController,
  ],
  providers: [
    IdempotentRoutesCheck,
    // PLAT-10: every non-public route binds a generated operation of its surface, or no boot.
    OperationRoutesCheck,
    { provide: DenialAuditThrottle, useFactory: () => new DenialAuditThrottle() },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    // Guards run in this order: the principal (and its rate-limit charge), the web client marker on
    // staff and platform writes, JSON bodies only, then the operation's permission (PLAT-10;
    // adversary A-5: a cross-site or form write is refused before any denial audit row), all
    // before any interceptor opens a transaction.
    { provide: APP_GUARD, useClass: TenancyGuard },
    { provide: APP_GUARD, useClass: WebClientGuard },
    // JSON bodies only (adversary H-1): a form post is refused before any interceptor.
    { provide: APP_GUARD, useClass: ContentTypeGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    // PLAT-13 plan 2.5: K-6 for a `@Feature()` route, after its permission (a caller without the
    // permission is `403 forbidden` whatever the feature's state).
    { provide: APP_GUARD, useClass: FeatureGate },
    // PLAT-14: the operation id on the request span; opens nothing, so the unit of work stays the
    // first interceptor that does.
    { provide: APP_INTERCEPTOR, useClass: RequestTelemetryInterceptor },
    { provide: APP_INTERCEPTOR, useClass: UnitOfWorkInterceptor },
    // Every `@Input()` parsed with its operation's generated strict schemas (A-17).
    { provide: APP_PIPE, useClass: ContractPipe },
    // core_audit_log (PLAT-7): in the unit of work, or committed on its own for refusals.
    { provide: AUDIT_SINK, useClass: AuditWriter },
    // core_outbox (PLAT-8): every side effect leaves the business transaction as a row.
    OutboxWriter,
    // PLAT-12 plan 2.6: the site in-use checks DEL and WMS register at module init (none in wave 0).
    { provide: SiteUseChecks, useValue: new SiteUseChecks() },
    // INT-2 plan 2.6: the geocoder port on the parts `RequestFrameModule.forRoot` builds; without
    // them every lookup answers `unavailable` (`no_source`).
    {
      provide: GEOCODER,
      inject: [{ token: GEOCODER_SETUP, optional: true }],
      useFactory: (setup?: GeocoderSetup) => new GeocoderService(setup?.parts),
    },
  ],
  exports: [AUDIT_SINK, OutboxWriter, SiteUseChecks, GEOCODER],
})
export class KernelModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
