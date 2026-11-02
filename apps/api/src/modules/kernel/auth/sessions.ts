import { createHash } from 'node:crypto';
import type { CredentialsCipher } from '@eeasy-logistics/config';
import { uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditEvent, AuditSink } from '../audit/audit-sink.js';
import type { ErrorCode } from '../errors/error-codes.js';
import { ApiException } from '../errors/api-exception.js';
import type {
  IdentityStore,
  IdentityTransaction,
  RefreshState,
} from '../platform/identity.repository.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { addressKey } from '../rate-limit/rate-limiter.js';
import type { PlatformStaffRole, SessionSurface } from '../schema/identity.js';
import type { AccessTokenIssuer, AuthenticationMethod, SessionClaims } from './access-token.js';
import { countRefresh, countRevocations } from './auth-metrics.js';
import type { CookieSurface, IssuedSession } from './cookies.js';
import { sessionCookieNames } from './cookies.js';
import { cookieValue } from './principal.js';
import type { RequestFacts } from './request-facts.js';
import { isOpaqueToken, opaqueToken, tokenHash } from './tokens.js';

// Sessions (PLAT-11 plan 2.4 to 2.6; identity and tenancy §4; ADR-0032; Q-23): a session is an
// access JWT (15 min) plus an opaque refresh token in a family. Every refresh rotates the token and
// marks the old row used; the old token presented again within the grace, from the same family and
// user agent, gets the same successor back (two tabs refreshing at once); any other reuse revokes the
// whole family. A moved `token_version` (a password reset), a disabled user, a membership that is no
// longer active or a revoked platform staff row refuse the refresh; a suspended account answers
// `403 account_suspended` (identity and tenancy §6).
//
// Drivers (DEL-4 plan 2.7, 2.8; identity and tenancy §3.2, §4): the same families with a bearer pair
// instead of cookies, a 90-day absolute refresh bound to one device row (`device_id` on the row,
// `dev` in the access token). A driver refresh also needs the device the app names to be the row's,
// the device not revoked (`401 device_revoked`, which revokes the family) and the driver `active`.

export interface SessionSettings {
  readonly staffRefreshTtlSeconds: number;
  readonly platformIdleTtlSeconds: number;
  readonly refreshReuseGraceSeconds: number;
  /** `AUTH_DRIVER_REFRESH_TTL_SECONDS` (90 days unless set; DEL-4 plan 2.8). */
  readonly driverRefreshTtlSeconds?: number;
}

/** The driver refresh lifetime when the settings name none (identity and tenancy §4). */
const defaultDriverRefreshTtlSeconds = 7_776_000;

/** Who a session is for: a staff membership, or a platform staff member. */
export type SessionSubject =
  | {
      readonly surface: 'staff';
      readonly userId: string;
      readonly tokenVersion: number;
      readonly membership: {
        readonly id: string;
        readonly accountId: string;
        readonly roles: readonly string[];
        readonly siteIds: readonly string[];
      };
      readonly amr: readonly AuthenticationMethod[];
    }
  | {
      readonly surface: 'platform';
      readonly userId: string;
      readonly tokenVersion: number;
      readonly role: PlatformStaffRole;
      readonly amr: readonly AuthenticationMethod[];
    }
  | {
      /** A driver membership on one device row (DEL-4 plan 2.7). */
      readonly surface: 'driver';
      readonly userId: string;
      readonly tokenVersion: number;
      readonly membership: {
        readonly id: string;
        readonly accountId: string;
        readonly roles: readonly string[];
        readonly siteIds: readonly string[];
      };
      /** The `del_driver_devices` row id (DEL-4 8.2 #17). */
      readonly deviceId: string;
      readonly amr: readonly AuthenticationMethod[];
    };

/** What a refresh comes to, decided on the row and its subject (plan 2.6). */
export type RefreshVerdict =
  | { readonly kind: 'rotate' }
  | { readonly kind: 'grace' }
  | { readonly kind: 'reuse' }
  /** A driver's device was revoked (DEL-4 plan 2.8): `401 device_revoked`, the family revoked. */
  | { readonly kind: 'device_revoked' }
  | {
      readonly kind: 'refuse';
      readonly code: Extract<ErrorCode, 'token_invalid' | 'token_expired' | 'account_suspended'>;
    };

/** Account states a session may continue in; `suspended` answers 403, anything else 401. */
const liveAccountStatuses = new Set(['provisioned', 'active']);

/**
 * The refresh state machine (plan 2.6, 2.16), pure so it is tested with any clock: `now` is the
 * database's. Order: another surface or a revoked row is invalid; a used row outside the grace (or
 * from another agent) is a reuse, which revokes the family; then the subject (version, disabled,
 * membership, account, platform staff row); a used row inside the grace answers the same successor;
 * an expired row is `token_expired`; else the row rotates.
 *
 * A driver row (DEL-4 plan 2.8) first needs the app's own device id (`request.deviceId`) to be the
 * one of the row's device, else `token_invalid`; a revoked or vanished device is `device_revoked`
 * before the row's own revocation (revoking a device revoked its families too, and the app must
 * learn why); after the subject checks, a driver who is not `active` is `token_invalid`.
 */
export function refreshVerdict(
  row: RefreshState,
  request: {
    readonly surface: SessionSurface;
    readonly userAgentHash: Buffer | null;
    /** The app's device id from the driver refresh body; absent on the cookie surfaces. */
    readonly deviceId?: string;
  },
  graceSeconds: number,
): RefreshVerdict {
  if (row.surface !== request.surface) return { kind: 'refuse', code: 'token_invalid' };
  if (row.surface === 'driver') {
    const device = row.driver?.device ?? null;
    if (device !== null && device.appDeviceId !== request.deviceId) {
      return { kind: 'refuse', code: 'token_invalid' };
    }
    if (device === null || device.revoked) return { kind: 'device_revoked' };
  }
  if (row.revoked) return { kind: 'refuse', code: 'token_invalid' };
  if (row.usedAt !== null) {
    const age = row.now.getTime() - row.usedAt.getTime();
    const sameAgent =
      (row.userAgentHash === null && request.userAgentHash === null) ||
      (row.userAgentHash !== null &&
        request.userAgentHash !== null &&
        row.userAgentHash.equals(request.userAgentHash));
    const inGrace =
      graceSeconds > 0 &&
      age <= graceSeconds * 1000 &&
      sameAgent &&
      row.successorCiphertext !== null;
    if (!inGrace) return { kind: 'reuse' };
  }
  if (row.user.disabled || row.user.tokenVersion !== row.tokenVersion) {
    return { kind: 'refuse', code: 'token_invalid' };
  }
  if (row.surface === 'platform') {
    if (row.platformStaff === null || row.platformStaff.revoked) {
      return { kind: 'refuse', code: 'token_invalid' };
    }
  } else {
    const membership = row.membership;
    if (membership === null || membership.status !== 'active') {
      return { kind: 'refuse', code: 'token_invalid' };
    }
    if (membership.accountStatus === 'suspended')
      return { kind: 'refuse', code: 'account_suspended' };
    if (!liveAccountStatuses.has(membership.accountStatus)) {
      return { kind: 'refuse', code: 'token_invalid' };
    }
    if (row.surface === 'driver' && row.driver?.status !== 'active') {
      return { kind: 'refuse', code: 'token_invalid' };
    }
  }
  if (row.usedAt !== null) return { kind: 'grace' };
  if (row.expiresAt.getTime() <= row.now.getTime())
    return { kind: 'refuse', code: 'token_expired' };
  return { kind: 'rotate' };
}

/** The stored form of a user agent (the grace compares it; data §10: no agent string is kept). */
export function userAgentHash(userAgent: string | null): Buffer | null {
  return userAgent === null ? null : createHash('sha256').update(userAgent, 'utf8').digest();
}

export type RefreshOutcome =
  | { readonly ok: true; readonly session: IssuedSession }
  | {
      readonly ok: false;
      readonly code: Extract<
        ErrorCode,
        'token_invalid' | 'token_expired' | 'account_suspended' | 'device_revoked'
      >;
    };

export interface SessionServiceDependencies {
  readonly issuer: Pick<AccessTokenIssuer, 'sign' | 'ttlSeconds'>;
  /** Null without credentials keys: no successor is kept, so the reuse grace never applies. */
  readonly cipher: CredentialsCipher | null;
  /** Null without `DATABASE_URL_PLATFORM`: every call answers 500. */
  readonly store: IdentityStore | null;
  readonly audit: Pick<AuditSink, 'record'>;
  readonly settings: SessionSettings;
  /** Undefined without `REDIS_URL`: no budget is charged. */
  readonly limiter?: Pick<RateLimiter, 'charge'> | undefined;
  readonly logger?: Pick<Logger, 'log' | 'warn'>;
}

const successorContext = (rowId: string) => `core_refresh_tokens:${rowId}`;

export class SessionService {
  readonly #deps: SessionServiceDependencies;
  readonly #logger: Pick<Logger, 'log' | 'warn'>;

  constructor(deps: SessionServiceDependencies) {
    this.#deps = deps;
    this.#logger = deps.logger ?? new Logger('Sessions');
  }

  /** The identity store, or `500` without the platform pool. */
  get store(): IdentityStore {
    const store = this.#deps.store;
    if (store === null) throw new ApiException('internal_error');
    return store;
  }

  /**
   * Starts a session in the caller's transaction: a new refresh family, the access token, the
   * user's `last_login_at`, and the audit row `core.session.started` (with `amr` and the surface).
   */
  async start(
    tx: IdentityTransaction,
    subject: SessionSubject,
    facts: Pick<RequestFacts, 'ip' | 'userAgent' | 'requestId' | 'clientRequestId'>,
  ): Promise<IssuedSession> {
    const familyId = uuidv7();
    const refreshToken = opaqueToken();
    const ttl =
      subject.surface === 'staff'
        ? this.#deps.settings.staffRefreshTtlSeconds
        : subject.surface === 'driver'
          ? (this.#deps.settings.driverRefreshTtlSeconds ?? defaultDriverRefreshTtlSeconds)
          : this.#deps.settings.platformIdleTtlSeconds;
    const row = await tx.refreshTokens.insert({
      id: uuidv7(),
      surface: subject.surface,
      userId: subject.userId,
      membershipId: subject.surface === 'platform' ? null : subject.membership.id,
      deviceId: subject.surface === 'driver' ? subject.deviceId : null,
      familyId,
      tokenHash: tokenHash(refreshToken),
      tokenVersion: subject.tokenVersion,
      amr: subject.amr,
      userAgentHash: userAgentHash(facts.userAgent),
      expires: { inSeconds: ttl },
    });
    await tx.users.signedIn(subject.userId);
    await this.#deps.audit.record(
      sessionEvent(subject, facts, 'core.session.started', familyId, {
        surface: subject.surface,
        amr: [...subject.amr],
        ...(subject.surface === 'platform' ? {} : { membership_id: subject.membership.id }),
        ...(subject.surface === 'driver' ? { device: subject.deviceId } : {}),
      }),
    );
    this.#logger.log(`session started surface=${subject.surface} user_id=${subject.userId}`);
    return {
      accessToken: await this.#deps.issuer.sign(claimsOf(subject)),
      accessTtlSeconds: this.#deps.issuer.ttlSeconds,
      refreshToken,
      refreshTtlSeconds: row.ttlSeconds,
    };
  }

  /**
   * Rotates the refresh cookie of `surface` (plan 2.6). Refusals come back as a code (the caller
   * clears the cookies and answers it) after their transaction committed, so a reuse's family
   * revocation and its audit row survive the `401`.
   */
  async refresh(surface: CookieSurface, facts: RequestFacts): Promise<RefreshOutcome> {
    await this.#deps.limiter?.charge(
      'session_refresh_ip',
      `ip:${addressKey(facts.ip ?? undefined)}`,
    );
    const presented = cookieValue(facts.cookieHeader, sessionCookieNames[surface].refresh);
    if (presented === undefined || !isOpaqueToken(presented)) {
      countRefresh(surface, 'invalid');
      return { ok: false, code: 'token_invalid' };
    }
    const agent = userAgentHash(facts.userAgent);
    const outcome = await this.#refreshRow(surface, presented, agent, facts);
    countRefresh(surface, outcome.metric);
    return outcome.result;
  }

  /**
   * Rotates a driver's refresh token from the request body (DEL-4 plan 2.8; no cookie): the same
   * state machine with the device verdict. A revoked device answers `device_revoked` after its
   * family's revocation committed.
   */
  async refreshDriver(
    input: { readonly refreshToken: string; readonly deviceId: string },
    facts: RequestFacts,
  ): Promise<RefreshOutcome> {
    await this.#deps.limiter?.charge(
      'session_refresh_ip',
      `ip:${addressKey(facts.ip ?? undefined)}`,
    );
    if (!isOpaqueToken(input.refreshToken)) {
      countRefresh('driver', 'invalid');
      return { ok: false, code: 'token_invalid' };
    }
    const agent = userAgentHash(facts.userAgent);
    const outcome = await this.#refreshRow(
      'driver',
      input.refreshToken,
      agent,
      facts,
      input.deviceId,
    );
    countRefresh('driver', outcome.metric);
    return outcome.result;
  }

  /**
   * Ends a driver's session on this device (`driverLogout`, DEL-4 plan 2.8): every live family of
   * the membership on the token's device row, audited `core.session.ended` when anything was
   * revoked. Always succeeds; returns the families revoked.
   */
  async logoutDevice(
    principal: {
      readonly userId: string;
      readonly accountId: string;
      readonly membershipId: string;
      readonly deviceId: string;
    },
    facts: Pick<RequestFacts, 'ip' | 'userAgent' | 'requestId' | 'clientRequestId'>,
  ): Promise<number> {
    const families = await this.store.run((tx) =>
      tx.refreshTokens.revokeAll(principal.userId, 'logout', {
        surface: 'driver',
        membershipId: principal.membershipId,
        deviceId: principal.deviceId,
      }),
    );
    if (families.length === 0) return 0;
    countRevocations('logout', families.length);
    await this.#deps.audit.record({
      actorType: 'user',
      actorId: principal.userId,
      accountId: principal.accountId,
      targetType: 'user',
      targetId: principal.userId,
      action: 'core.session.ended',
      after: { surface: 'driver', families: families.length, reason: 'logout' },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    return families.length;
  }

  async #refreshRow(
    surface: SessionSurface,
    presented: string,
    agent: Buffer | null,
    facts: RequestFacts,
    deviceId?: string,
  ): Promise<{
    result: RefreshOutcome;
    metric: 'ok' | 'grace' | 'reuse_revoked' | 'invalid' | 'device_revoked';
  }> {
    const invalid = (result: RefreshOutcome) => ({ result, metric: 'invalid' as const });
    return this.store.run(async (tx) => {
      const row = await tx.refreshTokens.lockByHash(tokenHash(presented));
      if (row === undefined) return invalid({ ok: false, code: 'token_invalid' });
      const verdict = refreshVerdict(
        row,
        { surface, userAgentHash: agent, ...(deviceId === undefined ? {} : { deviceId }) },
        this.#deps.settings.refreshReuseGraceSeconds,
      );
      switch (verdict.kind) {
        case 'refuse':
          return invalid({ ok: false, code: verdict.code });
        case 'reuse':
          await this.#revokeFamily(tx, row, facts);
          return { result: { ok: false, code: 'token_invalid' }, metric: 'reuse_revoked' };
        case 'device_revoked':
          await this.#revokeFamily(tx, row, facts, 'revoked');
          return { result: { ok: false, code: 'device_revoked' }, metric: 'device_revoked' };
        case 'grace': {
          const result = await this.#grace(tx, row);
          return result.ok ? { result, metric: 'grace' } : invalid(result);
        }
        case 'rotate':
          return {
            result: { ok: true, session: await this.#rotate(tx, row, agent) },
            metric: 'ok',
          };
      }
    });
  }

  /**
   * Ends the session (plan 2.6): the family of the presented refresh cookie when it is the
   * principal's, else every family of the principal's user on this surface and membership. Always
   * succeeds; audited `core.session.ended` when anything was revoked.
   */
  async logout(
    surface: CookieSurface,
    principal: {
      readonly userId: string;
      readonly accountId: string | null;
      readonly membershipId: string | null;
    },
    facts: RequestFacts,
  ): Promise<void> {
    await this.store.run((tx) => this.endCurrent(tx, { surface, ...principal }, facts, 'logout'));
  }

  /**
   * Revokes the current session in the caller's transaction (logout, switch-account): the family
   * of the presented refresh cookie when it is the principal's, else every live family of the user
   * on this surface and membership; audited `core.session.ended` with the reason when anything was
   * revoked.
   */
  async endCurrent(
    tx: IdentityTransaction,
    principal: {
      readonly surface: CookieSurface;
      readonly userId: string;
      readonly accountId: string | null;
      readonly membershipId: string | null;
    },
    facts: RequestFacts,
    reason: 'logout' | 'switch_account',
  ): Promise<void> {
    const { surface } = principal;
    const presented = cookieValue(facts.cookieHeader, sessionCookieNames[surface].refresh);
    let families: string[] = [];
    const family =
      presented !== undefined && isOpaqueToken(presented)
        ? await tx.refreshTokens.familyOf(tokenHash(presented))
        : undefined;
    if (family !== undefined && family.userId === principal.userId) {
      if ((await tx.refreshTokens.revokeFamily(family.familyId, reason)) > 0) {
        families = [family.familyId];
      }
    } else {
      families = await tx.refreshTokens.revokeAll(principal.userId, reason, {
        surface,
        membershipId: principal.membershipId,
      });
    }
    if (families.length === 0) return;
    countRevocations(reason, families.length);
    await this.#deps.audit.record({
      actorType: surface === 'platform' ? 'platform_user' : 'user',
      actorId: principal.userId,
      accountId: principal.accountId,
      targetType: 'user',
      targetId: principal.userId,
      action: 'core.session.ended',
      after: { surface, families: families.length, reason },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
  }

  async #rotate(
    tx: IdentityTransaction,
    row: RefreshState,
    agent: Buffer | null,
  ): Promise<IssuedSession> {
    const successor = opaqueToken();
    const sliding = row.surface === 'platform';
    const inserted = await tx.refreshTokens.insert({
      id: uuidv7(),
      surface: row.surface,
      userId: row.userId,
      membershipId: row.membershipId,
      deviceId: row.deviceId,
      familyId: row.familyId,
      tokenHash: tokenHash(successor),
      tokenVersion: row.user.tokenVersion,
      amr: row.amr,
      userAgentHash: agent,
      expires: sliding
        ? { inSeconds: this.#deps.settings.platformIdleTtlSeconds }
        : { at: row.expiresAt },
    });
    const cipher = this.#deps.cipher;
    const kept =
      cipher === null || this.#deps.settings.refreshReuseGraceSeconds === 0
        ? null
        : Buffer.from(cipher.encrypt(successor, successorContext(row.id)).blob);
    await tx.refreshTokens.markUsed(row.id, kept);
    return {
      accessToken: await this.#deps.issuer.sign(claimsOfRow(row)),
      accessTtlSeconds: this.#deps.issuer.ttlSeconds,
      refreshToken: successor,
      refreshTtlSeconds: inserted.ttlSeconds,
    };
  }

  /**
   * The same successor again, with a fresh access token of the same claims (Q-23 "same pair"), only
   * while the successor itself is unused (adversary L-1): once it has rotated, handing it out again
   * would only lead the caller into a reuse. A used successor answers `token_invalid` without
   * revoking the family (a legitimate race fails closed, not as theft).
   */
  async #grace(tx: IdentityTransaction, row: RefreshState): Promise<RefreshOutcome> {
    const cipher = this.#deps.cipher;
    if (cipher === null || row.successorCiphertext === null) {
      return { ok: false, code: 'token_invalid' };
    }
    const successor = cipher.decrypt(row.successorCiphertext, successorContext(row.id));
    const next = await tx.refreshTokens.lockByHash(tokenHash(successor));
    if (next === undefined || next.revoked || next.usedAt !== null) {
      return { ok: false, code: 'token_invalid' };
    }
    const left = Math.max(0, Math.floor((next.expiresAt.getTime() - next.now.getTime()) / 1000));
    return {
      ok: true,
      session: {
        accessToken: await this.#deps.issuer.sign(claimsOfRow(row)),
        accessTtlSeconds: this.#deps.issuer.ttlSeconds,
        refreshToken: successor,
        refreshTtlSeconds: left,
      },
    };
  }

  async #revokeFamily(
    tx: IdentityTransaction,
    row: RefreshState,
    facts: RequestFacts,
    reason: 'reuse' | 'revoked' = 'reuse',
  ): Promise<void> {
    // A revoked device's families are usually revoked already (`revokeDriverDevice`): nothing then.
    const revoked = await tx.refreshTokens.revokeFamily(row.familyId, reason);
    if (reason === 'revoked' && revoked === 0) return;
    countRevocations(reason, 1);
    await this.#deps.audit.record({
      actorType: row.surface === 'platform' ? 'platform_user' : 'user',
      actorId: row.userId,
      accountId: row.membership?.accountId ?? null,
      targetType: 'session_family',
      targetId: row.familyId,
      action: 'core.session.family_revoked',
      after: { surface: row.surface, reason },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    this.#logger.warn(
      reason === 'reuse'
        ? `refresh token reuse: family revoked surface=${row.surface} user_id=${row.userId}`
        : `refresh from a revoked device: family revoked user_id=${row.userId} device_id=${row.deviceId ?? ''}`,
    );
  }
}

function claimsOf(subject: SessionSubject): SessionClaims {
  if (subject.surface === 'driver') {
    return {
      surface: 'driver',
      userId: subject.userId,
      accountId: subject.membership.accountId,
      membershipId: subject.membership.id,
      deviceId: subject.deviceId,
      roles: subject.membership.roles,
      sites: subject.membership.siteIds,
      tokenVersion: subject.tokenVersion,
      amr: subject.amr,
    };
  }
  return subject.surface === 'staff'
    ? {
        surface: 'staff',
        userId: subject.userId,
        accountId: subject.membership.accountId,
        membershipId: subject.membership.id,
        roles: subject.membership.roles,
        sites: subject.membership.siteIds,
        tokenVersion: subject.tokenVersion,
        amr: subject.amr,
      }
    : {
        surface: 'platform',
        userId: subject.userId,
        roles: [subject.role],
        tokenVersion: subject.tokenVersion,
        amr: subject.amr,
      };
}

/** The access claims of a refresh row, from its subject's current roles and sites. */
function claimsOfRow(row: RefreshState): SessionClaims {
  const amr = row.amr.filter((method): method is AuthenticationMethod =>
    (['pwd', 'otp', 'totp'] as const).includes(method as AuthenticationMethod),
  );
  if (row.surface === 'platform') {
    if (row.platformStaff === null) throw new ApiException('token_invalid');
    return {
      surface: 'platform',
      userId: row.userId,
      roles: [row.platformStaff.role],
      tokenVersion: row.user.tokenVersion,
      amr,
    };
  }
  if (row.membership === null || row.membershipId === null) throw new ApiException('token_invalid');
  if (row.surface === 'driver') {
    if (row.deviceId === null) throw new ApiException('token_invalid');
    return {
      surface: 'driver',
      userId: row.userId,
      accountId: row.membership.accountId,
      membershipId: row.membershipId,
      deviceId: row.deviceId,
      roles: row.membership.roles,
      sites: row.membership.siteIds,
      tokenVersion: row.user.tokenVersion,
      amr,
    };
  }
  return {
    surface: 'staff',
    userId: row.userId,
    accountId: row.membership.accountId,
    membershipId: row.membershipId,
    roles: row.membership.roles,
    sites: row.membership.siteIds,
    tokenVersion: row.user.tokenVersion,
    amr,
  };
}

function sessionEvent(
  subject: SessionSubject,
  facts: Pick<RequestFacts, 'ip' | 'userAgent' | 'requestId' | 'clientRequestId'>,
  action: string,
  familyId: string,
  after: Record<string, unknown>,
): AuditEvent {
  return {
    actorType: subject.surface === 'platform' ? 'platform_user' : 'user',
    actorId: subject.userId,
    accountId: subject.surface === 'platform' ? null : subject.membership.accountId,
    targetType: 'session_family',
    targetId: familyId,
    action,
    after,
    requestId: facts.requestId,
    clientRequestId: facts.clientRequestId,
    ip: facts.ip,
    userAgent: facts.userAgent,
  };
}
