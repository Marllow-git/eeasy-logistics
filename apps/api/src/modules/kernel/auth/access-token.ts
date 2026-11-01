import type { Secret } from '@eeasy-logistics/config';
import { isUuid } from '@eeasy-logistics/db';
import type { JWTHeaderParameters } from 'jose';
import { decodeJwt, errors, jwtVerify } from 'jose';
import { z } from 'zod';
import { ApiException } from '../errors/api-exception.js';
import type { TokenSurface } from './surfaces.js';

// Access tokens (PLAT-6 plan 2.3; identity and tenancy §4): JWTs signed HS256 with
// `config.auth.signingKey`, header `kid = config.auth.signingKeyId`, verified locally by signature.
// Issuing them is PLAT-11's; `ver` is carried for PLAT-11's revocation checks, not checked here.

/** The `iss` of every access token this API issues and accepts. */
export const accessTokenIssuer = 'eeasy-logistics';
export const accessTokenAlgorithm = 'HS256';

const uuid = z.string().refine(isUuid, 'not a UUID');
const common = {
  iss: z.literal(accessTokenIssuer),
  sub: uuid,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  roles: z.array(z.string().min(1).max(64)).max(32),
  scopes: z.string().max(128),
  sites: z.array(uuid).max(1000),
  ver: z.number().int().nonnegative(),
};

/** The claims of each surface: who may carry an account, a membership and a device. */
const claimSchemas = {
  staff: z.object({
    ...common,
    aud: z.literal('staff'),
    acc: uuid,
    mem: uuid,
    dev: z.null().optional(),
  }),
  driver: z.object({ ...common, aud: z.literal('driver'), acc: uuid, mem: uuid, dev: uuid }),
  platform: z.object({
    ...common,
    aud: z.literal('platform'),
    acc: z.null(),
    mem: z.null().optional(),
    dev: z.null().optional(),
  }),
} as const;

export type StaffClaims = z.infer<(typeof claimSchemas)['staff']>;
export type DriverClaims = z.infer<(typeof claimSchemas)['driver']>;
export type PlatformClaims = z.infer<(typeof claimSchemas)['platform']>;
export type AccessClaims<S extends TokenSurface> = z.infer<(typeof claimSchemas)[S]>;

/** The part of `Config['auth']` verification needs. */
export interface SigningSettings {
  readonly signingKeyId: string | undefined;
  readonly signingKey: Secret | undefined;
}

const unauthenticated = () => new ApiException('unauthenticated');

/**
 * Verifies an access token for one surface. Anything wrong is `401 unauthenticated` (bad or
 * missing signature, another `kid` or algorithm, another surface's `aud`, a malformed or missing
 * claim); only a token that is genuine, for this surface and past `exp` is `401 token_expired`, so
 * the client knows a refresh can help. Without a configured key every token is refused.
 */
export class AccessTokenVerifier {
  readonly #keyId: string | undefined;
  readonly #key: Uint8Array | undefined;

  constructor(settings: SigningSettings) {
    this.#keyId = settings.signingKeyId;
    this.#key =
      settings.signingKey === undefined
        ? undefined
        : new TextEncoder().encode(settings.signingKey.reveal());
  }

  /** Whether a signing key is configured; without one no request authenticates. */
  get configured(): boolean {
    return this.#key !== undefined && this.#keyId !== undefined;
  }

  async verify<S extends TokenSurface>(token: string, surface: S): Promise<AccessClaims<S>> {
    const key = this.#key;
    const keyId = this.#keyId;
    if (key === undefined || keyId === undefined || token.length > 8192) throw unauthenticated();
    let payload: unknown;
    try {
      ({ payload } = await jwtVerify(
        token,
        (header: JWTHeaderParameters) => {
          if (header.kid !== keyId) throw new errors.JWSInvalid('unknown key id');
          return key;
        },
        { algorithms: [accessTokenAlgorithm], issuer: accessTokenIssuer, audience: surface },
      ));
    } catch (error) {
      // jose checks the signature before any claim, so an expired token here is genuine.
      if (error instanceof errors.JWTExpired && audienceOf(token) === surface) {
        throw new ApiException('token_expired');
      }
      throw unauthenticated();
    }
    const claims = claimSchemas[surface].safeParse(payload);
    if (!claims.success) throw unauthenticated();
    return claims.data as AccessClaims<S>;
  }
}

function audienceOf(token: string): unknown {
  try {
    return decodeJwt(token).aud;
  } catch {
    return undefined;
  }
}
