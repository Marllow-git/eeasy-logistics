import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import type { AppDatabase, Pool } from '@eeasy-logistics/db';
import { withUnitOfWork } from '@eeasy-logistics/db';
import type { FactoryProvider } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { APP_POOL } from '../../../database/database.module.js';
import type { AuditSink } from '../audit/audit-sink.js';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import { ApiException } from '../errors/api-exception.js';
import { OtpService } from '../messaging/otp.service.js';
import { normalisePhone, phoneTail } from '../messaging/phone.js';
import type { DriverSignInRow, IdentityStore } from '../platform/identity.repository.js';
import { identityStoreOnPool } from '../platform/identity.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { addressKey, RATE_LIMITER } from '../rate-limit/rate-limiter.js';
import { AccessTokenIssuer } from './access-token.js';
import type { IssuedSession } from './cookies.js';
import type { RequestFacts } from './request-facts.js';
import type { RefreshOutcome } from './sessions.js';
import { SessionService } from './sessions.js';

// The kernel's half of a driver's sign-in (DEL-4 plan 2.7, 2.12; identity and tenancy §3.2, §4, §8;
// ADR-0023, ADR-0031): the phone, the code and the person live on the platform pool, the token issue
// is PLAT-11's `SessionService`; Delivery keeps the device (it binds the device row in the tenant
// unit of work this class opens for the driver's account, then asks for the session on that row).
// Every refusal of a code is the same `401 otp_invalid`, and the request door answers and costs the
// same for any phone: a phone that is no one's driver gets a challenge row and no message.

/** A driver a phone signed in as: the person, the membership, its account and the driver row. */
export type SignedInDriver = DriverSignInRow;

export interface DriverSignInDependencies {
  readonly otp: Pick<OtpService, 'request' | 'verify'>;
  readonly sessions: SessionService;
  /** Null without `DATABASE_URL_PLATFORM`: every call answers 500. */
  readonly identity: IdentityStore | null;
  /** Null without `DATABASE_URL_APP`: the device cannot be bound, every verification answers 500. */
  readonly app: AppDatabase | null;
  readonly limiter?: Pick<RateLimiter, 'charge'> | undefined;
  readonly logger?: Pick<Logger, 'log' | 'warn'>;
}

export class DriverSignIn {
  readonly #deps: DriverSignInDependencies;
  readonly #logger: Pick<Logger, 'log' | 'warn'>;

  constructor(deps: DriverSignInDependencies) {
    this.#deps = deps;
    this.#logger = deps.logger ?? new Logger('DriverSignIn');
  }

  /**
   * `driverRequestOtp` (plan 2.7): the phone normalised (`400` at `/body/phone` when it is none),
   * the drivers it may sign in as looked up, then PLAT-9's request for every phone (availability,
   * cooldown, the phone, day, address and global budgets, the challenge), with the message only
   * when the phone is an eligible driver's. Resolves the same way for any phone.
   */
  async requestCode(input: {
    readonly phone: string;
    readonly locale: 'ar' | 'en';
    readonly ip: string | null;
  }): Promise<void> {
    const phone = normalisePhone(input.phone);
    if (phone === undefined) {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/body/phone', code: 'invalid' }],
      });
    }
    const drivers = await this.#identity().run((tx) => tx.memberships.driversOfPhone(phone));
    await this.#deps.otp.request({
      phone,
      purpose: 'driver_login',
      ip: input.ip ?? undefined,
      locale: input.locale,
      deliver: drivers.length > 0,
    });
  }

  /**
   * The code check of `driverVerifyOtp` (plan 2.7, 2.12): `driver_verify_ip` charged, PLAT-9's
   * verification (single use under its row lock, five attempts) run once for every phone, then the
   * driver the phone may sign in as (the most recently changed when it drives for several
   * accounts). No driver (a disabled person, a membership or account not active, a suspended or
   * archived driver) is the same `401 otp_invalid` as a wrong code.
   */
  async verifyCode(
    input: { readonly phone: string; readonly code: string },
    facts: Pick<RequestFacts, 'ip'>,
  ): Promise<SignedInDriver> {
    await this.#deps.limiter?.charge('driver_verify_ip', `ip:${addressKey(facts.ip ?? undefined)}`);
    const { phone } = await this.#deps.otp.verify({
      phone: input.phone,
      purpose: 'driver_login',
      code: input.code,
    });
    const [driver] = await this.#identity().run((tx) => tx.memberships.driversOfPhone(phone));
    if (driver === undefined) {
      this.#logger.log(`driver sign-in refused: no eligible driver phone=${phoneTail(phone)}`);
      throw new ApiException('otp_invalid');
    }
    return driver;
  }

  /**
   * Runs `fn` in a tenant unit of work for the driver's account (plan 2.7: the device is bound under
   * the driver row lock there), with the driver as the context's user and membership.
   */
  inAccount<T>(driver: SignedInDriver, requestId: string, fn: () => Promise<T>): Promise<T> {
    const app = this.#deps.app;
    if (app === null) throw this.#unconfigured('DATABASE_URL_APP');
    return withUnitOfWork(
      app,
      {
        accountId: driver.accountId,
        membershipId: driver.membershipId,
        userId: driver.userId,
        deviceId: null,
        actingCrossTenant: false,
        requestId,
      },
      () => fn(),
    );
  }

  /**
   * Starts the driver's session on the bound device row (plan 2.7): a new refresh family bound to
   * `deviceRowId` (90 days, absolute), the access token with `dev`, `amr: ['otp']`, audited
   * `core.session.started` with the account, on the platform pool.
   */
  start(
    driver: SignedInDriver,
    deviceRowId: string,
    facts: Pick<RequestFacts, 'ip' | 'userAgent' | 'requestId' | 'clientRequestId'>,
  ): Promise<IssuedSession> {
    const sessions = this.#deps.sessions;
    return sessions.store.run((tx) =>
      sessions.start(
        tx,
        {
          surface: 'driver',
          userId: driver.userId,
          tokenVersion: driver.tokenVersion,
          membership: {
            id: driver.membershipId,
            accountId: driver.accountId,
            roles: driver.roles,
            siteIds: driver.siteIds,
          },
          deviceId: deviceRowId,
          amr: ['otp'],
        },
        facts,
      ),
    );
  }

  /**
   * A fresh code for the signed-in driver's own phone (plan 2.9: the first cash PIN, or one after a
   * dispatcher's reset): PLAT-9's verification for the person's phone and `driver_login`, single
   * use; anything else is `401 otp_invalid`.
   */
  async verifyOwnCode(userId: string, code: string): Promise<void> {
    const [person] = await this.#identity().run((tx) => tx.users.findByIds([userId]));
    if (person?.phone === null || person?.phone === undefined) {
      throw new ApiException('otp_invalid');
    }
    await this.#deps.otp.verify({ phone: person.phone, purpose: 'driver_login', code });
  }

  /** `driver_pin_ip` (plan 2.12): one cash PIN set or check from this client address. */
  async chargeCashPin(facts: Pick<RequestFacts, 'ip'>): Promise<void> {
    await this.#deps.limiter?.charge('driver_pin_ip', `ip:${addressKey(facts.ip ?? undefined)}`);
  }

  /** `driverRefresh` (plan 2.8): PLAT-11's rotation with the device verdict, from the body. */
  refresh(
    input: { readonly refreshToken: string; readonly deviceId: string },
    facts: RequestFacts,
  ): Promise<RefreshOutcome> {
    return this.#deps.sessions.refreshDriver(input, facts);
  }

  /** `driverLogout` (plan 2.8): the families of the token's device end; audited when any did. */
  logout(
    principal: {
      readonly userId: string;
      readonly accountId: string;
      readonly membershipId: string;
      readonly deviceId: string;
    },
    facts: Pick<RequestFacts, 'ip' | 'userAgent' | 'requestId' | 'clientRequestId'>,
  ): Promise<number> {
    return this.#deps.sessions.logoutDevice(principal, facts);
  }

  #identity(): IdentityStore {
    const store = this.#deps.identity;
    if (store === null) throw this.#unconfigured('DATABASE_URL_PLATFORM');
    return store;
  }

  #unconfigured(variable: string): ApiException {
    this.#logger.warn(`${variable} is not set: the driver sign-in doors answer 500`);
    return new ApiException('internal_error');
  }
}

/**
 * The provider a context module lists (Delivery, DEL-4): PLAT-9's OTP service, PLAT-11's session
 * rules on a `SessionService` of the driver lifetime, the platform and app pools.
 */
export function driverSignInProvider(config: Config): FactoryProvider<DriverSignIn> {
  return {
    provide: DriverSignIn,
    inject: [
      OtpService,
      AUDIT_SINK,
      { token: PLATFORM_POOL, optional: true },
      { token: APP_POOL, optional: true },
      { token: RATE_LIMITER, optional: true },
    ],
    useFactory: (
      otp: OtpService,
      audit: AuditSink,
      pool: Parameters<typeof identityStoreOnPool>[0] | undefined,
      appPool: Pool<AppDatabase> | null | undefined,
      limiter: RateLimiter | undefined,
    ) => {
      const identity = identityStoreOnPool(pool ?? null);
      return new DriverSignIn({
        otp,
        identity,
        app: appPool?.db ?? null,
        limiter,
        sessions: new SessionService({
          issuer: new AccessTokenIssuer(config.auth),
          cipher: config.credentials === null ? null : createCredentialsCipher(config.credentials),
          store: identity,
          audit,
          limiter,
          settings: {
            staffRefreshTtlSeconds: config.auth.staffRefreshTtlSeconds,
            platformIdleTtlSeconds: config.auth.platformIdleTtlSeconds,
            refreshReuseGraceSeconds: config.auth.refreshReuseGraceSeconds,
            driverRefreshTtlSeconds: config.auth.driverRefreshTtlSeconds,
          },
        }),
      });
    },
  };
}
