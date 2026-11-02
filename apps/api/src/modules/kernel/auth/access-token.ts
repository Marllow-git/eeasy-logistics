import type { Secret } from '@eeasy-logistics/config';
import { isUuid } from '@eeasy-logistics/db';
import type { JWTHeaderParameters } from 'jose';
import { SignJWT, decodeJwt, errors, jwtVerify } from 'jose';
import { z } from 'zod';
import { ApiException } from '../errors/api-exception.js';
import type { TokenSurface } from './surfaces.js';

// Access tokens (PLAT-6 plan 2.3; identity and tenancy §4): JWTs signed HS256 with
// `config.auth.signingKey`, header `kid = config.auth.signingKeyId`, verified locally by signature.
// `AccessTokenIssuer` (PLAT-11 plan 2.4) signs them for sessions; `ver` is carried for the
// revocation checks on refresh and sensitive actions, not checked here. `amr` (optional, PLAT-11)
// names the methods the session was started with: `pwd`, `otp`, `totp`.

/** The `iss` of every access token this API issues and accepts. */
export const accessTokenIssuer = 'eeasy-logistics';
export const accessTokenAlgorithm = 'HS256';
/** The JWT `typ` header of an access token (RFC 9068); any other `typ` is refused (adversary L-1). */
export const accessTokenType = 'at+jwt';
/** Clock skew allowed between the issuing and the verifying instance, in seconds. */
export const clockSkewSeconds = 60;

const uuid = z.string().refine(isUuid, 'not a UUID');

/** Authentication methods a session records (RFC 8176 names): password, phone OTP, TOTP. */
export const authenticationMethods = ['pwd', 'otp', 'totp'] as const;
export type AuthenticationMethod = (typeof authenticationMethods)[number];

const common = {
  iss: z.literal(accessTokenIssuer),
  sub: uuid,
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
  roles: z.array(z.string().min(1).max(64)).max(32),
  scopes: z.string().max(128),
  sites: z.array(uuid).max(1000),
  ver: z.number().int().nonnegative(),
  amr: z.array(z.enum(authenticationMethods)).max(authenticationMethods.length).optional(),
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
  /** The access-token lifetime (`AUTH_ACCESS_TOKEN_TTL_SECONDS`); bounds `iat` (default 900). */
  readonly accessTokenTtlSeconds?: number;
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
  readonly #maxAgeSeconds: number;

  constructor(settings: SigningSettings) {
    this.#keyId = settings.signingKeyId;
    this.#maxAgeSeconds = settings.accessTokenTtlSeconds ?? 900;
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
        {
          algorithms: [accessTokenAlgorithm],
          issuer: accessTokenIssuer,
          audience: surface,
          typ: accessTokenType,
        },
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
    // `iat` bounds (adversary L-1): never issued in the future beyond the skew, and never older
    // than one lifetime, whatever `exp` says (a token minted with a long `exp` is still refused).
    const now = Math.floor(Date.now() / 1000);
    if (claims.data.iat > now + clockSkewSeconds) throw unauthenticated();
    if (now - claims.data.iat > this.#maxAgeSeconds + clockSkewSeconds) {
      throw new ApiException('token_expired');
    }
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

/** The claims of a session's access token (identity and tenancy §4 "Claims"; plan 2.4). */
export type SessionClaims =
  | {
      readonly surface: 'staff';
      readonly userId: string;
      readonly accountId: string;
      readonly membershipId: string;
      readonly roles: readonly string[];
      readonly sites: readonly string[];
      readonly tokenVersion: number;
      readonly amr: readonly AuthenticationMethod[];
    }
  | {
      readonly surface: 'platform';
      readonly userId: string;
      readonly roles: readonly string[];
      readonly tokenVersion: number;
      readonly amr: readonly AuthenticationMethod[];
    }
  | {
      /** A driver (DEL-4 plan 2.7): the membership's account and the device row (`dev`). */
      readonly surface: 'driver';
      readonly userId: string;
      readonly accountId: string;
      readonly membershipId: string;
      readonly deviceId: string;
      readonly roles: readonly string[];
      readonly sites: readonly string[];
      readonly tokenVersion: number;
      readonly amr: readonly AuthenticationMethod[];
    };

/**
 * Signs session access tokens with the key the verifier checks (PLAT-11 plan 2.4): the PLAT-6
 * claim shape, `scopes` empty for sessions (API keys are wave 4), `iat` now and `exp` one access
 * lifetime later. Without a configured key it refuses to sign (`500`), as the verifier refuses
 * every token.
 */
export class AccessTokenIssuer {
  readonly #keyId: string | undefined;
  readonly #key: Uint8Array | undefined;
  readonly ttlSeconds: number;

  constructor(settings: SigningSettings) {
    this.#keyId = settings.signingKeyId;
    this.ttlSeconds = settings.accessTokenTtlSeconds ?? 900;
    this.#key =
      settings.signingKey === undefined
        ? undefined
        : new TextEncoder().encode(settings.signingKey.reveal());
  }

  get configured(): boolean {
    return this.#key !== undefined && this.#keyId !== undefined;
  }

  async sign(claims: SessionClaims, now: number = Date.now()): Promise<string> {
    const key = this.#key;
    const keyId = this.#keyId;
    if (key === undefined || keyId === undefined) throw new ApiException('internal_error');
    const issuedAt = Math.floor(now / 1000);
    const tenant =
      claims.surface === 'staff'
        ? { acc: claims.accountId, mem: claims.membershipId, sites: [...claims.sites] }
        : claims.surface === 'driver'
          ? {
              acc: claims.accountId,
              mem: claims.membershipId,
              dev: claims.deviceId,
              sites: [...claims.sites],
            }
          : { acc: null, mem: null, sites: [] };
    return new SignJWT({
      sub: claims.userId,
      ...tenant,
      roles: [...claims.roles],
      scopes: '',
      ver: claims.tokenVersion,
      amr: [...claims.amr],
    })
      .setProtectedHeader({ alg: accessTokenAlgorithm, kid: keyId, typ: accessTokenType })
      .setIssuer(accessTokenIssuer)
      .setAudience(claims.surface)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + this.ttlSeconds)
      .sign(key);
  }
}
