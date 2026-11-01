import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { operationOf } from '../contract/contract-pipe.js';
import { annotateRequest } from './spans.js';

/**
 * Names the contract operation a request reached on its span (PLAT-14 plan 2.2): the generated
 * `operationId` the handler binds with `@Operation()`, never anything from the request itself.
 */
@Injectable()
export class RequestTelemetryInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const operationId = operationOf(context.getHandler())?.operationId;
      if (operationId !== undefined) {
        annotateRequest(context.switchToHttp().getRequest<object>(), {
          'elx.operation_id': operationId,
        });
      }
    }
    return next.handle();
  }
}
