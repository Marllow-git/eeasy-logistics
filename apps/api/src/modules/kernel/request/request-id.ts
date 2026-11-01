import { AsyncLocalStorage } from 'node:async_hooks';
import { isUuid, uuidv7 } from '@eeasy-logistics/db';
import type { NestMiddleware } from '@nestjs/common';
import { ConsoleLogger, Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

// Request ids (PLAT-6 plan 2.1; contracts README §3 "Request ids"). The middleware runs first in
// the chain: it keeps an incoming `X-Request-Id` only when it is a UUID, else mints a UUIDv7, sets
// it on the response, and runs the rest of the request inside a scope that log lines read.

export const requestIdHeader = 'X-Request-Id';

const ids = new WeakMap<Request, string>();
const scope = new AsyncLocalStorage<string>();

/** An incoming id is kept only when it is one UUID (any version); case is normalised. */
export function acceptRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  return isUuid(lower) ? lower : undefined;
}

/** The id of `request`, minting and recording one when the middleware did not run (a 404). */
export function requestIdOf(request: Request): string {
  let id = ids.get(request);
  if (id === undefined) {
    id = acceptRequestId(request.headers['x-request-id']) ?? uuidv7();
    ids.set(request, id);
  }
  return id;
}

/** The id of the request the current code serves, for log lines; undefined outside one. */
export function currentRequestId(): string | undefined {
  return scope.getStore();
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const id = requestIdOf(request);
    response.setHeader(requestIdHeader, id);
    scope.run(id, next);
  }
}

/** The application logger: every line written while serving a request names its id. */
export class RequestLogger extends ConsoleLogger {
  protected override formatContext(context: string): string {
    const id = currentRequestId();
    const base = super.formatContext(context);
    return id === undefined ? base : `${base}[request ${id}] `;
  }
}
