import type { IncomingHttpHeaders } from 'node:http';
import { ApiException } from '../errors/api-exception.js';
import type { AccessTokenVerifier } from './access-token.js';
import type { Surface } from './surfaces.js';

// Who calls (PLAT-6 plan 2.4; identity and tenancy §1, §4). One resolver, one strategy per surface:
// staff and platform carry their access token in a host-only cookie of their own (ADR-0032,
// ADR-0038), the driver as a bearer token. Recipient tokens and API keys answer 401 until their
// orders add the verifiers. Nothing here reads a path, query or body: the account is the token's.

export const staffCookie = 'el_staff_at';
export const platformCookie = 'el_platform_at';

interface TokenFacts {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly scopes: string;
  readonly sites: readonly string[];
  /** `ver`: PLAT-11 compares it with the user's `token_version` on sensitive actions. */
  readonly tokenVersion: number;
}

export interface StaffPrincipal extends TokenFacts {
  readonly kind: 'staff';
  readonly accountId: string;
  readonly membershipId: string;
}

export interface DriverPrincipal extends TokenFacts {
  readonly kind: 'driver';
  readonly accountId: string;
  readonly membershipId: string;
  readonly deviceId: string;
}

/** Platform staff: no account; cross-tenant work only through `@CrossTenant()`. */
export interface PlatformPrincipal extends TokenFacts {
  readonly kind: 'platform';
}

export type Principal = StaffPrincipal | DriverPrincipal | PlatformPrincipal;

/**
 * The value of cookie `name` in a `Cookie` header (RFC 6265 §5.4). A name sent more than once is
 * no credential at all (adversary L-2): a sibling subdomain can plant a second cookie of the same
 * name, and the browser's order between the two is not a trust decision. The `__Host-` prefix that
 * stops the planting is a contract change ruled for PLAT-11.
 */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined || header.length > 16_384) return undefined;
  let found: string | undefined;
  let seen = 0;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    seen += 1;
    found = pair.slice(separator + 1).trim();
  }
  if (seen !== 1 || found === '') return undefined;
  return found;
}

/** The token of an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = header === undefined ? null : /^Bearer ([A-Za-z0-9._~+/=-]+)$/.exec(header);
  return match?.[1];
}

const unauthenticated = () => new ApiException('unauthenticated');

export class PrincipalResolver {
  readonly #verifier: AccessTokenVerifier;

  constructor(verifier: AccessTokenVerifier) {
    this.#verifier = verifier;
  }

  /** The principal of a request to `surface`; throws `401` when there is none. */
  async resolve(surface: Surface, headers: IncomingHttpHeaders): Promise<Principal> {
    switch (surface) {
      case 'staff': {
        const token = cookieValue(headers.cookie, staffCookie);
        if (token === undefined) throw unauthenticated();
        const claims = await this.#verifier.verify(token, 'staff');
        return Object.freeze({
          kind: 'staff',
          ...facts(claims),
          accountId: claims.acc,
          membershipId: claims.mem,
        });
      }
      case 'driver': {
        const token = bearerToken(headers.authorization);
        if (token === undefined) throw unauthenticated();
        const claims = await this.#verifier.verify(token, 'driver');
        return Object.freeze({
          kind: 'driver',
          ...facts(claims),
          accountId: claims.acc,
          membershipId: claims.mem,
          deviceId: claims.dev,
        });
      }
      case 'platform': {
        const token = cookieValue(headers.cookie, platformCookie);
        if (token === undefined) throw unauthenticated();
        const claims = await this.#verifier.verify(token, 'platform');
        return Object.freeze({ kind: 'platform', ...facts(claims) });
      }
      // Recipient tokens (X-Recipient-Token) and API keys (X-API-Key) get their verifiers in
      // their own orders (plan 2.4); until then every call on those surfaces is refused.
      case 'recipient':
      case 'public':
        throw unauthenticated();
    }
  }
}

function facts(claims: {
  sub: string;
  roles: string[];
  scopes: string;
  sites: string[];
  ver: number;
}): TokenFacts {
  return {
    userId: claims.sub,
    roles: Object.freeze([...claims.roles]),
    scopes: claims.scopes,
    sites: Object.freeze([...claims.sites]),
    tokenVersion: claims.ver,
  };
}
