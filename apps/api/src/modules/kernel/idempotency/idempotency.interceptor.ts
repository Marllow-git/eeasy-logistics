import { getUnitOfWork, isUuid } from '@eeasy-logistics/db';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import {
  Inject,
  Injectable,
  Optional,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { from, lastValueFrom } from 'rxjs';
import { z } from 'zod';
import { ApiException } from '../errors/api-exception.js';
import { currentPlatformIdempotencyStore } from '../platform/idempotency.repository.js';
import { principalOf } from '../tenancy/frame.js';
import type {
  IdempotencyStore,
  IdempotentOptions,
  ResolvedIdempotentOptions,
} from './idempotency.js';
import {
  IDEMPOTENT,
  idempotencyKeyHeader,
  principalKey,
  replayedHeader,
  reserve,
  resolveOptions,
} from './idempotency.js';
import { TenantIdempotencyStore } from './idempotency.repository.js';
import { requestHash, stripSecrets } from './request-hash.js';

/** The HMAC key for removed secrets (HKDF of the signing key), from `RequestFrameModule`. */
export const IDEMPOTENCY_HMAC_KEY = Symbol('IDEMPOTENCY_HMAC_KEY');

/** `Idempotency-Key`: one UUID, any case (README §3); anything else is `idempotency_key_required`. */
const keySchema = z
  .string()
  .transform((value) => value.toLowerCase())
  .refine(isUuid);

/** The store of the current unit of work: the account's, or the platform's (account NULL). */
function currentStore(): IdempotencyStore {
  try {
    return new TenantIdempotencyStore(getUnitOfWork());
  } catch {
    const platform = currentPlatformIdempotencyStore();
    if (platform === undefined) throw new Error('@Idempotent() runs inside a unit of work');
    return platform;
  }
}

/** The id a secret-bearing response names, for `details.resource_id`. */
function resourceIdOf(body: unknown): string | undefined {
  const id = (body as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Idempotent writes (PLAT-6 plan 2.8). Runs inside the per-request unit of work (the global
 * interceptor opened it), so the reserve, the handler's writes and the stored response commit or
 * roll back together. A replay answers the stored status and body with `Idempotency-Replayed:
 * true`; the same key still running is `409 idempotency_in_progress` with `Retry-After: 2`; the
 * same key with another request is `422 idempotency_key_reused`.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(IDEMPOTENCY_HMAC_KEY) private readonly hmacKey?: Buffer,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const options =
      this.reflector.get<ResolvedIdempotentOptions | undefined>(IDEMPOTENT, context.getHandler()) ??
      resolveOptions();
    const principal = principalOf(request);
    if (principal === undefined || this.hmacKey === undefined) {
      throw new Error('@Idempotent() needs an authenticated route and the signing key');
    }
    const key = keySchema.safeParse(request.headers[idempotencyKeyHeader]);
    if (!key.success) throw new ApiException('idempotency_key_required');
    const routePath = (request.route as { path?: unknown } | undefined)?.path;
    const claim = {
      ...principalKey(principal),
      key: key.data,
      route: `${request.method} ${typeof routePath === 'string' ? routePath : request.path}`,
      requestHash: requestHash({
        method: request.method,
        path: request.originalUrl,
        body: request.body as unknown,
        secretFields: options.secretFields,
        hmacKey: this.hmacKey,
      }),
    };

    const run = async (): Promise<unknown> => {
      const store = currentStore();
      const outcome = await reserve(store, claim);
      switch (outcome.kind) {
        case 'in_progress':
          throw new ApiException('idempotency_in_progress', { headers: { 'Retry-After': '2' } });
        case 'reused':
          throw new ApiException('idempotency_key_reused');
        case 'replay': {
          if (options.secretResponse) {
            const resourceId = resourceIdOf(outcome.body);
            throw new ApiException('secret_already_issued', {
              details: resourceId === undefined ? {} : { resource_id: resourceId },
            });
          }
          response.status(outcome.status);
          response.setHeader(replayedHeader, 'true');
          return outcome.body;
        }
        case 'reserved': {
          const value: unknown = await lastValueFrom(next.handle(), { defaultValue: undefined });
          const stored = options.secretResponse
            ? stripSecrets(value, options.secretFields).value
            : value;
          await store.complete(outcome.id, response.statusCode, stored ?? null);
          return value;
        }
      }
    };
    return from(run());
  }
}

/**
 * Marks a retryable write (contracts README §3): `Idempotency-Key` required, replays answered from
 * the stored response for 24 h per principal. Secret-bearing operations pass `secretResponse`.
 */
export const Idempotent = (options: IdempotentOptions = {}): MethodDecorator =>
  applyDecorators(
    SetMetadata(IDEMPOTENT, resolveOptions(options)),
    UseInterceptors(IdempotencyInterceptor),
  );
