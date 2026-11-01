import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE, DiscoveryModule } from '@nestjs/core';
import { AUDIT_SINK } from './audit/audit-sink.js';
import { AuditLogController } from './audit/audit-log.controller.js';
import { AuditWriter } from './audit/audit-writer.js';
import { PlatformAuditLogController } from './audit/platform-audit-log.controller.js';
import { ContractPipe } from './contract/contract-pipe.js';
import { IdempotentRoutesCheck } from './idempotency/idempotency.interceptor.js';
import { ApiExceptionFilter } from './errors/exception.filter.js';
import { OutboxWriter } from './outbox/outbox-writer.js';
import { RequestIdMiddleware } from './request/request-id.js';
import { ContentTypeGuard } from './request/content-type.guard.js';
import { WebClientGuard } from './request/web-client.guard.js';
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
  // The audit log reads (PLAT-7): listAuditLog, platformListAccountAudit, platformListAudit.
  controllers: [AuditLogController, PlatformAuditLogController],
  providers: [
    IdempotentRoutesCheck,
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    // Guards run in this order: the principal (and its rate-limit charge), then the web client
    // marker on staff and platform writes, both before any interceptor opens a transaction.
    { provide: APP_GUARD, useClass: TenancyGuard },
    { provide: APP_GUARD, useClass: WebClientGuard },
    // JSON bodies only (adversary H-1): a form post is refused before any interceptor.
    { provide: APP_GUARD, useClass: ContentTypeGuard },
    { provide: APP_INTERCEPTOR, useClass: UnitOfWorkInterceptor },
    // Every `@Input()` parsed with its operation's generated strict schemas (A-17).
    { provide: APP_PIPE, useClass: ContractPipe },
    // core_audit_log (PLAT-7): in the unit of work, or committed on its own for refusals.
    { provide: AUDIT_SINK, useClass: AuditWriter },
    // core_outbox (PLAT-8): every side effect leaves the business transaction as a row.
    OutboxWriter,
  ],
  exports: [AUDIT_SINK, OutboxWriter],
})
export class KernelModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
