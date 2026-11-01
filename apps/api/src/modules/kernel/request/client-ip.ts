import type { ExecutionContext } from '@nestjs/common';
// eslint-disable-next-line no-restricted-imports -- the client address only, never request input; the kernel owns it (PLAT-9)
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The client address of the request (`request.ip`, which Express derives from `X-Forwarded-For`
 * through `TRUST_PROXY_HOPS`, PLAT-6 review round 2), for the handlers that charge a per-address
 * budget or record it (the OTP doors, PLAT-9). Controllers outside the kernel may not read the raw
 * request, so this is the one way a handler receives it.
 */
export const ClientIp = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    context.switchToHttp().getRequest<Request>().ip,
);
