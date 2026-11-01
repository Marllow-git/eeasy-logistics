import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiException } from '../errors/api-exception.js';

// JSON only (contracts README §3; adversary H-1). Nest's urlencoded and text parsers are off
// (`httpAppOptions`), and a request that carries a body must declare `application/json` (or a
// `+json` type): an HTML form (`application/x-www-form-urlencoded`, `multipart/form-data`,
// `text/plain`), the classic cross-site request a browser sends without a preflight, is refused
// with `400 validation_failed` before any handler or interceptor runs.

const jsonType = /^application\/(?:[\w.+-]+\+)?json(?:\s*;.*)?$/i;

/** Whether the request carries a body (a length above zero or a chunked transfer). */
function hasBody(request: Pick<Request, 'headers'>): boolean {
  const length = request.headers['content-length'];
  if (length !== undefined) return length !== '0';
  return request.headers['transfer-encoding'] !== undefined;
}

export function acceptsContentType(request: Pick<Request, 'headers'>): boolean {
  if (!hasBody(request)) return true;
  const type = request.headers['content-type'];
  return typeof type === 'string' && jsonType.test(type.trim());
}

@Injectable()
export class ContentTypeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!acceptsContentType(context.switchToHttp().getRequest<Request>())) {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/header/content-type', code: 'invalid' }],
      });
    }
    return true;
  }
}
