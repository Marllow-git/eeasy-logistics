import type { Config } from '@eeasy-logistics/config';
import { createCredentialsCipher } from '@eeasy-logistics/config';
import type { DynamicModule } from '@nestjs/common';
import { Logger, Module } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { PERMISSION_RESOLVER } from '../authz/permission-resolver.js';
import { OutboxWriter } from '../outbox/outbox-writer.js';
import { KernelModule } from '../kernel.module.js';
import { OtpService } from '../messaging/otp.service.js';
import { identityStoreOnPool } from '../platform/identity.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { RATE_LIMITER } from '../rate-limit/rate-limiter.js';
import { MembersController } from '../members/members.controller.js';
import { PlatformStaffController } from '../platform-staff/platform-staff.controller.js';
import { PlatformAccountsController } from '../provisioning/platform-accounts.controller.js';
import { AccessTokenIssuer } from './access-token.js';
import { Invitations } from './invitations.js';
import { PasswordResets } from './password-resets.js';
import { BreachedPasswords, PasswordHasher } from './passwords.js';
import { PlatformAuthController } from './platform-auth.controller.js';
import { PlatformSignIn } from './platform-sign-in.js';
import { SecondFactorResets } from './second-factor-resets.js';
import { StaffSecondFactor } from './second-factor.js';
import { SessionService } from './sessions.js';
import { StaffAuthController } from './staff-auth.controller.js';
import { StaffSignIn, emailKeyOf } from './sign-in.js';

/**
 * Staff and platform authentication (PLAT-11): the sign-in doors, sessions and `Me`. The identity
 * tables are reached only through the platform pool; without it, or without a signing key, the
 * doors answer 500 (production requires both). Without credentials keys the refresh reuse grace is
 * off (no successor can be kept encrypted).
 */
@Module({})
export class AuthModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: AuthModule,
      imports: [KernelModule],
      // PLAT-12: the staff surface's member doors, here because they delegate to `Invitations` and
      // `SecondFactorResets` (plan 2.9). PLAT-13: the platform account doors, here because the
      // provisioning door and `platformInviteOwner` delegate the owner's invitation to `Invitations`,
      // and the platform staff doors (leg 2) delegate `platformInviteStaff` to it.
      controllers: [
        StaffAuthController,
        PlatformAuthController,
        MembersController,
        PlatformAccountsController,
        PlatformStaffController,
      ],
      providers: [
        { provide: PasswordHasher, useFactory: () => new PasswordHasher() },
        // Read once at boot; a missing or malformed list stops the boot (plan 2.2).
        { provide: BreachedPasswords, useFactory: () => BreachedPasswords.bundled() },
        {
          provide: AccessTokenIssuer,
          useFactory: () => new AccessTokenIssuer(config.auth),
        },
        {
          provide: SessionService,
          inject: [
            AccessTokenIssuer,
            PLATFORM_POOL,
            AUDIT_SINK,
            { token: RATE_LIMITER, optional: true },
          ],
          useFactory: (
            issuer: AccessTokenIssuer,
            pool: Parameters<typeof identityStoreOnPool>[0],
            audit: AuditSink,
            limiter: RateLimiter | undefined,
          ) => {
            if (pool === null || !issuer.configured) {
              new Logger('Auth').warn(
                'DATABASE_URL_PLATFORM or the signing key is not set: the sign-in doors answer 500',
              );
            }
            return new SessionService({
              issuer,
              cipher:
                config.credentials === null ? null : createCredentialsCipher(config.credentials),
              store: identityStoreOnPool(pool),
              audit,
              limiter,
              settings: {
                staffRefreshTtlSeconds: config.auth.staffRefreshTtlSeconds,
                platformIdleTtlSeconds: config.auth.platformIdleTtlSeconds,
                refreshReuseGraceSeconds: config.auth.refreshReuseGraceSeconds,
              },
            });
          },
        },
        {
          provide: StaffSignIn,
          inject: [
            SessionService,
            PasswordHasher,
            BreachedPasswords,
            AUDIT_SINK,
            { token: PERMISSION_RESOLVER, optional: true },
            { token: RATE_LIMITER, optional: true },
          ],
          useFactory: (
            sessions: SessionService,
            passwords: PasswordHasher,
            breached: BreachedPasswords,
            audit: AuditSink,
            resolver: PermissionResolver | undefined,
            limiter: RateLimiter | undefined,
          ) =>
            new StaffSignIn({
              sessions,
              passwords,
              breached,
              audit,
              resolver,
              limiter,
              emailKey:
                config.auth.signingKey === undefined
                  ? undefined
                  : emailKeyOf(config.auth.signingKey.reveal()),
            }),
        },
        {
          // PLAT-11 plan 2.9, 2.10: platform sign-in with TOTP.
          provide: PlatformSignIn,
          inject: [
            SessionService,
            PasswordHasher,
            BreachedPasswords,
            AUDIT_SINK,
            StaffSignIn,
            { token: PERMISSION_RESOLVER, optional: true },
            { token: RATE_LIMITER, optional: true },
          ],
          useFactory: (
            sessions: SessionService,
            passwords: PasswordHasher,
            breached: BreachedPasswords,
            audit: AuditSink,
            signIn: StaffSignIn,
            resolver: PermissionResolver | undefined,
            limiter: RateLimiter | undefined,
          ) =>
            new PlatformSignIn({
              sessions,
              passwords,
              breached,
              resolver,
              audit,
              limiter,
              emailRef: (email) => signIn.emailRef(email),
              cipher:
                config.credentials === null ? null : createCredentialsCipher(config.credentials),
              totpIssuer: config.auth.totpIssuer,
            }),
        },
        {
          // PLAT-11 plan 2.8: the staff second-factor doors (PLAT-9's OTP service, `second_factor`).
          provide: StaffSecondFactor,
          inject: [
            SessionService,
            StaffSignIn,
            OtpService,
            PasswordHasher,
            AUDIT_SINK,
            { token: RATE_LIMITER, optional: true },
          ],
          useFactory: (
            sessions: SessionService,
            signIn: StaffSignIn,
            otp: OtpService,
            passwords: PasswordHasher,
            audit: AuditSink,
            limiter: RateLimiter | undefined,
          ) => new StaffSecondFactor({ sessions, signIn, otp, passwords, audit, limiter }),
        },
        {
          // PLAT-12 (`resetMemberSecondFactor`) calls it.
          provide: SecondFactorResets,
          inject: [PLATFORM_POOL, OutboxWriter, AUDIT_SINK],
          useFactory: (
            pool: Parameters<typeof identityStoreOnPool>[0],
            outbox: OutboxWriter,
            audit: AuditSink,
          ) =>
            new SecondFactorResets({
              store: identityStoreOnPool(pool),
              outbox,
              audit,
              publicWebUrl: config.app.publicWebUrl,
              cipher:
                config.credentials === null ? null : createCredentialsCipher(config.credentials),
            }),
        },
        {
          // PLAT-12 (`inviteMember`) and PLAT-13 (`platformInviteStaff`, bootstrap) call it.
          provide: Invitations,
          inject: [PLATFORM_POOL, OutboxWriter, { token: PERMISSION_RESOLVER, optional: true }],
          useFactory: (
            pool: Parameters<typeof identityStoreOnPool>[0],
            outbox: OutboxWriter,
            resolver: PermissionResolver | undefined,
          ) =>
            new Invitations({
              store: identityStoreOnPool(pool),
              outbox,
              resolver,
              publicWebUrl: config.app.publicWebUrl,
              publicAdminUrl: config.app.publicAdminUrl,
              cipher:
                config.credentials === null ? null : createCredentialsCipher(config.credentials),
            }),
        },
        {
          provide: PasswordResets,
          inject: [
            PLATFORM_POOL,
            OutboxWriter,
            PasswordHasher,
            BreachedPasswords,
            AUDIT_SINK,
            StaffSignIn,
            { token: RATE_LIMITER, optional: true },
          ],
          useFactory: (
            pool: Parameters<typeof identityStoreOnPool>[0],
            outbox: OutboxWriter,
            passwords: PasswordHasher,
            breached: BreachedPasswords,
            audit: AuditSink,
            signIn: StaffSignIn,
            limiter: RateLimiter | undefined,
          ) =>
            new PasswordResets({
              store: identityStoreOnPool(pool),
              outbox,
              passwords,
              breached,
              audit,
              limiter,
              emailRef: (email) => signIn.emailRef(email),
              publicWebUrl: config.app.publicWebUrl,
              cipher:
                config.credentials === null ? null : createCredentialsCipher(config.credentials),
            }),
        },
      ],
      exports: [
        SessionService,
        PasswordHasher,
        BreachedPasswords,
        AccessTokenIssuer,
        StaffSignIn,
        Invitations,
        SecondFactorResets,
      ],
    };
  }
}
