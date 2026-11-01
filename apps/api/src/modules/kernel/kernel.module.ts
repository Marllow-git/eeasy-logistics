import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AUDIT_SINK, LogAuditSink } from './audit/audit-sink.js';
import { ApiExceptionFilter } from './errors/exception.filter.js';
import { RequestIdMiddleware } from './request/request-id.js';
import { TenancyGuard } from './tenancy/tenancy.guard.js';
import { UnitOfWorkInterceptor } from './tenancy/unit-of-work.interceptor.js';

/**
 * Shared kernel context (`core_` tables). Imports no other context (ADR-0026). It owns the request
 * frame every handler runs in (PLAT-6): the request id middleware first in the chain, the global
 * tenancy guard, the per-request unit of work (the first interceptor, so route interceptors run
 * inside its transaction) and the one global exception filter. Their configured parts (signing
 * key, pools) come from `RequestFrameModule.forRoot` and `DatabaseModule.forRoot`; without them
 * every non-public request is refused.
 */
@Module({
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    { provide: APP_GUARD, useClass: TenancyGuard },
    { provide: APP_INTERCEPTOR, useClass: UnitOfWorkInterceptor },
    // The wave 0 audit sink writes a log line; PLAT-7 binds the core_audit_log writer here.
    { provide: AUDIT_SINK, useClass: LogAuditSink },
  ],
  exports: [AUDIT_SINK],
})
export class KernelModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
