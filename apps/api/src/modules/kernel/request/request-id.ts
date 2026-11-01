import { AsyncLocalStorage } from 'node:async_hooks';
import { isUuid, uuidv7 } from '@eeasy-logistics/db';
import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getMetrics } from '../telemetry/metrics.js';
import { annotateRequest, routeTemplateOf } from '../telemetry/spans.js';

// Request ids (PLAT-6 plan 2.1; contracts README §3 "Request ids"). The middleware runs first in
// the chain: it keeps an incoming `X-Request-Id` only when it is a UUID, else mints a UUIDv7, sets
// it on the response, and runs the rest of the request inside a scope that log lines read.

export const requestIdHeader = 'X-Request-Id';

const serverIds = new WeakMap<Request, string>();
const scope = new AsyncLocalStorage<{ readonly server: string; readonly client: string | null }>();

/** An incoming id is kept only when it is one UUID (any version); case is normalised. */
export function acceptRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  return isUuid(lower) ? lower : undefined;
}

/**
 * The id this server minted for `request` (adversary L-4): always a fresh UUIDv7, whatever the
 * client sent, so log lines, the request context and audit events carry an id no caller chose.
 */
export function serverRequestIdOf(request: Request): string {
  let id = serverIds.get(request);
  if (id === undefined) {
    id = uuidv7();
    serverIds.set(request, id);
  }
  return id;
}

/** The client's own `X-Request-Id` when it is a UUID, else null; carried, never trusted. */
export function clientRequestIdOf(request: Request): string | null {
  return acceptRequestId(request.headers['x-request-id']) ?? null;
}

/**
 * The id the response names (`X-Request-Id`, the `Error` body's `request_id`): the client's UUID
 * echoed for its own correlation, else the server's id.
 */
export function requestIdOf(request: Request): string {
  return clientRequestIdOf(request) ?? serverRequestIdOf(request);
}

/** The server's id of the request the current code serves, for log lines; undefined outside one. */
export function currentRequestId(): string | undefined {
  return scope.getStore()?.server;
}

/** The client's own UUID for the request the current code serves, when it sent one. */
export function currentClientRequestId(): string | undefined {
  return scope.getStore()?.client ?? undefined;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    response.setHeader(requestIdHeader, requestIdOf(request));
    const server = serverRequestIdOf(request);
    const client = clientRequestIdOf(request);
    // The request span carries the server's id (PLAT-14 plan 2.2), never the client's.
    annotateRequest(request, { 'elx.request_id': server });
    // `http_request_duration_ms` by route template, method and status (plan 2.3); a request no
    // route matched counts as `unmatched`, never under its path.
    const started = performance.now();
    response.once('finish', () => {
      getMetrics().record('http_request_duration_ms', performance.now() - started, {
        route: routeTemplateOf(request) ?? 'unmatched',
        method: request.method,
        status: response.statusCode,
      });
    });
    // Log lines name the server's id, and the client's next to it when it sent one (PLAT-14: the
    // JSON logger's `request_id` and `client_request_id`).
    scope.run({ server, client: client === server ? null : client }, next);
  }
}
