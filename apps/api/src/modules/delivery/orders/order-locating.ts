import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import { withUnitOfWork } from '@eeasy-logistics/db';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Inject, Injectable, Optional } from '@nestjs/common';
// eslint-disable-next-line no-restricted-imports -- `@PreLocated()` hands over the geocoder answer `OrderLocating` computed from the body the operation's own generated schema parsed, never raw input (DEL-2 adversary round 1)
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { APP_POOL } from '../../../database/database.module.js';
import type { GeocoderService } from '../../kernel/public/index.js';
import { GEOCODER, ifMatchVersion, requestTenantContext } from '../../kernel/public/index.js';
import type { Located } from './intake.js';
import { intakeGeocodeDeadlineMs, locate } from './intake.js';
import { newOrderFields, orderPatchFields } from './order-input.js';
import { relocationFor } from './order-updates.js';
import { OrdersRepository } from './orders.repository.js';

// The order doors' address lookup, before the request's transaction (DEL-2 adversary round 1,
// lead ruling 1). The geocoder is provider I/O of up to `intakeGeocodeDeadlineMs`; run inside the
// unit of work it held an app connection for that long, so a slow provider starved the pool for
// every tenant. This route guard runs after the global guards (principal, permission, feature
// gate) and before every interceptor, so before the unit of work and the idempotency reservation:
// it parses the body with the operation's generated schema, locates the address, and leaves the
// answer on the request for the handler (`@PreLocated()`), which applies it inside the transaction
// after its own checks. `updateOrder` first reads the order on a short transaction of its own
// (the trusted pin and the unchanged address decide whether to ask at all), released before the
// lookup. A body the contract refuses is left to the pipe; a failure is kept and raised by the
// handler at the point the inline lookup used to raise it.

/** What the guard found for the request's address. */
export type Prelocated =
  /** Asked: the point, or undefined when nothing reliable came back (`needs_location`). */
  | { readonly kind: 'located'; readonly located: Located | undefined }
  /** Not asked: the order keeps its point (no address sent, a trusted pin, nothing changed). */
  | { readonly kind: 'kept' }
  /** The lookup or the read failed; the handler raises it. */
  | { readonly kind: 'failed'; readonly error: unknown };

const answers = new WeakMap<Request, Prelocated>();

/** The guard's answer for the handler: undefined when the body never reached a lookup. */
export const PreLocated = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Prelocated | undefined =>
    answers.get(context.switchToHttp().getRequest<Request>()),
);

/**
 * The located address, raising the guard's failure. A handler that reaches this without an answer
 * has a body the guard did not parse as the pipe did: a programming error, never a lookup in the
 * transaction.
 */
export function settlePrelocated(
  pre: Prelocated | undefined,
): Exclude<Prelocated, { kind: 'failed' }> {
  if (pre === undefined) throw new Error('OrderLocating left no answer for this request');
  if (pre.kind === 'failed') throw pre.error;
  return pre;
}

const createOp = operationSchemas.createOrder;
const updateOp = operationSchemas.updateOrder;

@Injectable()
export class OrderLocating implements CanActivate {
  constructor(
    @Inject(GEOCODER) private readonly geocoder: GeocoderService,
    @Optional() @Inject(APP_POOL) private readonly app?: Pool<AppDatabase> | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    let answer: Prelocated | undefined;
    try {
      answer =
        request.method === 'POST'
          ? await this.forCreate(request)
          : request.method === 'PATCH'
            ? await this.forUpdate(request)
            : undefined;
    } catch (error) {
      answer = { kind: 'failed', error };
    }
    if (answer !== undefined) answers.set(request, answer);
    return true;
  }

  private async forCreate(request: Request): Promise<Prelocated | undefined> {
    const parsed = createOp.body.safeParse(request.body);
    if (!parsed.success) return undefined;
    const fields = newOrderFields(parsed.data);
    const located = await locate(this.geocoder, fields.address, fields.recipient.language ?? 'ar', {
      deadlineMs: intakeGeocodeDeadlineMs,
    });
    return { kind: 'located', located };
  }

  private async forUpdate(request: Request): Promise<Prelocated | undefined> {
    const body = updateOp.body.safeParse(request.body);
    const params = updateOp.params.safeParse(request.params);
    if (!body.success || !params.success) return undefined;
    const sent = Object.keys(request.body as object);
    if (!sent.includes('address')) return { kind: 'kept' };
    const tenant = requestTenantContext(request);
    const db = this.app?.db;
    if (tenant === undefined || db === undefined) return undefined;
    const seen = await withUnitOfWork(db, tenant, (uow) =>
      new OrdersRepository(uow).find(params.data.order_id),
    );
    if (seen === undefined) return undefined;
    // A stale `If-Match` is refused by the handler before the answer is used: ask nothing.
    const header = request.headers['if-match'];
    if (typeof header === 'string' && ifMatchVersion(header) !== seen.version) {
      return { kind: 'kept' };
    }
    const patch = orderPatchFields(body.data, sent, seen.kind);
    return await relocationFor(this.geocoder, seen, patch);
  }
}
