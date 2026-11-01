import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { AUDIT_SINK, LogAuditSink } from './audit/audit-sink.js';
import { ContractPipe } from './contract/contract-pipe.js';
import { ApiExceptionFilter } from './errors/exception.filter.js';
import { RequestIdMiddleware } from './request/request-id.js';
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
  providers: [
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
    // Guards run in this order: the principal (and its rate-limit charge), then the web client
    // marker on staff and platform writes, both before any interceptor opens a transaction.
    { provide: APP_GUARD, useClass: TenancyGuard },
    { provide: APP_GUARD, useClass: WebClientGuard },
    { provide: APP_INTERCEPTOR, useClass: UnitOfWorkInterceptor },
    // Every `@Input()` parsed with its operation's generated strict schemas (A-17).
    { provide: APP_PIPE, useClass: ContractPipe },
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
