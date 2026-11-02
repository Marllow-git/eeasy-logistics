import type { ExecutionContext } from '@nestjs/common';
// eslint-disable-next-line no-restricted-imports -- request metadata only (address, agent, cookies, ids), never contract input; the kernel owns it (PLAT-11)
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { clientRequestIdOf, serverRequestIdOf } from '../request/request-id.js';
import { principalOf } from '../tenancy/frame.js';
import type { Principal } from './principal.js';

/**
 * What the sign-in doors need of a request besides its contract input (PLAT-11 plan 2.4 to 2.11):
 * the client address and user agent (budgets, audit rows, the refresh grace's agent check), the
 * `Cookie` header (the refresh cookie is no contract parameter), the request ids for the audit rows
 * and, on an authenticated door, the principal the tenancy guard resolved.
 */
export interface RequestFacts {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly cookieHeader: string | undefined;
  readonly requestId: string;
  readonly clientRequestId: string | null;
  readonly principal: Principal | undefined;
}

export function requestFactsOf(request: Request): RequestFacts {
  const userAgent = request.headers['user-agent'];
  const cookie = request.headers.cookie;
  return {
    ip: request.ip === undefined || request.ip === '' ? null : request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    cookieHeader: typeof cookie === 'string' ? cookie : undefined,
    requestId: serverRequestIdOf(request),
    clientRequestId: clientRequestIdOf(request),
    principal: principalOf(request),
  };
}

/** The `RequestFacts` of the current request, for the kernel's auth controllers. */
export const AuthRequest = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestFacts =>
    requestFactsOf(context.switchToHttp().getRequest<Request>()),
);
