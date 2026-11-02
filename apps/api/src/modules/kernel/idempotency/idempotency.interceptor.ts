import { getUnitOfWork, isUuid } from '@eeasy-logistics/db';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  Inject,
  Injectable,
  Optional,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { from, lastValueFrom } from 'rxjs';
import { z } from 'zod';
import { ApiException } from '../errors/api-exception.js';
import { currentPlatformIdempotencyStore } from '../platform/idempotency.repository.js';
import { CommittedRefusal, principalOf } from '../tenancy/frame.js';
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

/**
 * The value as the client receives it (re-check N-2): `toJSON` applied (a `Date` becomes its ISO
 * string) before the secret fields are dropped, so a replay is byte-identical to the first answer.
 */
function asJson(value: unknown): unknown {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
}

/** What a secret-bearing response stores: `{ id }` when it names one, else nothing. */
function storedSecretResponse(body: unknown): { id: string } | null {
  const id = resourceIdOf(body);
  return id === undefined ? null : { id };
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
          let value: unknown;
          try {
            value = await lastValueFrom(next.handle(), { defaultValue: undefined });
          } catch (error) {
            // A refusal that commits (DEL-4 H-1) must not leave the key reserved.
            if (error instanceof CommittedRefusal) await store.release(outcome.id);
            throw error;
          }
          // A secret-bearing answer keeps only its id: the replay needs `resource_id` alone, and a
          // secret under any field name (`link`, `token`) is never stored (adversary M-3). Other
          // answers drop the secret fields at any depth.
          const stored = options.secretResponse
            ? storedSecretResponse(value)
            : stripSecrets(asJson(value), options.secretFields).value;
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
 *
 * The handler must declare its success status with `@HttpCode()`: the interceptor stores
 * `response.statusCode` as it stands when the handler returns, before Nest applies a default, so a
 * handler without it would replay `200` for a `201`. `IdempotentRoutesCheck` refuses to start an
 * application with an `@Idempotent()` handler that lacks `@HttpCode()`.
 */
export const Idempotent = (options: IdempotentOptions = {}): MethodDecorator =>
  applyDecorators(
    SetMetadata(IDEMPOTENT, resolveOptions(options)),
    UseInterceptors(IdempotencyInterceptor),
  );

/** Method names along the prototype chain (re-check N-3: inherited handlers count too). */
function methodNames(prototype: object): Set<string> {
  const names = new Set<string>();
  for (
    let current: object | null = prototype;
    current !== null && current !== Object.prototype;
    current = Object.getPrototypeOf(current) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== 'constructor') names.add(name);
    }
  }
  return names;
}

/**
 * Boot check (review round 2): every `@Idempotent()` handler declares `@HttpCode()`, so the status
 * stored for a replay is the one the first answer had. Registered in `KernelModule`; a missing one
 * fails application start naming the handler.
 */
@Injectable()
export class IdempotentRoutesCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const missing: string[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const type = wrapper.metatype as (new (...args: never[]) => unknown) | null | undefined;
      if (typeof type !== 'function') continue;
      const prototype = type.prototype as Record<string, unknown>;
      for (const name of methodNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function') continue;
        if (this.reflector.get(IDEMPOTENT, handler) === undefined) continue;
        if (this.reflector.get(HTTP_CODE_METADATA, handler) === undefined) {
          missing.push(`${type.name}.${name}`);
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(`@Idempotent() handlers need @HttpCode(): ${missing.join(', ')}`);
    }
  }
}
