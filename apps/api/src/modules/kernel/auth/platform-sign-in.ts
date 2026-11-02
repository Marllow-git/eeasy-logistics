import type { CredentialsCipher } from '@eeasy-logistics/config';
import { uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { ApiException } from '../errors/api-exception.js';
import type {
  IdentityTransaction,
  PlatformStaffTotp,
  UserRow,
} from '../platform/identity.repository.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { addressKey } from '../rate-limit/rate-limiter.js';
import { countedLogin, countRevocations } from './auth-metrics.js';
import type { IssuedSession } from './cookies.js';
import type { PlatformMeView } from './me.js';
import { platformMe } from './me.js';
import type { BreachedPasswords, PasswordHasher } from './passwords.js';
import { passwordProblem } from './passwords.js';
import type { Principal } from './principal.js';
import type { RequestFacts } from './request-facts.js';
import type { SessionService } from './sessions.js';
import { passwordRefusal } from './sign-in.js';
import {
  compoundToken,
  isOpaqueToken,
  opaqueToken,
  parseCompoundToken,
  tokenHash,
} from './tokens.js';
import { base32, fromBase32, matchingStep, otpauthUri, totpSecret } from './totp.js';

// Platform sign-in (PLAT-11 plan 2.9, 2.10; identity and tenancy §3.3; platform.yaml tag `auth`):
// email and password, then TOTP, no exceptions; no cookie before the TOTP passes. A `totp`
// challenge (5 minutes, five attempts) carries the password step to `platformVerifyTotp`, or to
// `platformEnrolTotp` and `platformConfirmTotp` for a user with no secret yet. The secret is
// encrypted with the credentials key: under `core_auth_challenges:<id>` while pending, under
// `core_platform_staff:<user_id>` once confirmed (data §10); the otpauth URI is answered once and
// never logged. A code at or below `totp_last_step` is refused (replay), in the transaction that
// starts the session.

export const totpChallengeTtlSeconds = 300;
const maxAttempts = 5;

/**
 * On the `amr` of a platform re-enrolment link (PLAT-13 adversary M-2): an `enrolment_link` challenge
 * of `platformResetStaffTotp`, told apart from a staff second-factor link (which never carries it,
 * and whose door refuses one that does).
 */
export const platformLinkMarker = 'platform_totp_link';
/** On the `totp` challenge a redeemed link yields: after a reset, the only one that may enrol. */
const linkRedeemed = 'enrolment_link';
/** Looked up when no user has the email: a well-formed id no row carries (UUIDv7 never has 0 ms). */
const absentUserId = '00000000-0000-7000-8000-000000000000';

const staffContext = (userId: string) => `core_platform_staff:${userId}`;
const pendingContext = (challengeId: string) => `core_auth_challenges:${challengeId}`;

/** What the password step answers (`TotpChallenge`). */
export interface TotpChallengeStep {
  readonly challengeId: string;
  readonly totpEnrolmentRequired: boolean;
}

/** A started platform session and its `PlatformMe`. */
export interface PlatformSession {
  readonly session: IssuedSession;
  readonly me: PlatformMeView;
}

/** A refusal that must commit first (a counted attempt). */
class Refused {
  constructor(
    readonly code: 'otp_invalid' | 'token_invalid' | 'invalid_credentials' = 'otp_invalid',
  ) {}
}

/** `401 reauthentication_required` for an enrolment a reset reserves for the emailed link (M-2). */
const linkRequired = () =>
  new ApiException('reauthentication_required', { details: { enrolment_link_required: true } });

export interface PlatformSignInDependencies {
  readonly sessions: SessionService;
  readonly passwords: Pick<PasswordHasher, 'verify' | 'hash' | 'dummyHash'>;
  readonly breached: Pick<BreachedPasswords, 'has'>;
  readonly resolver: Pick<PermissionResolver, 'grantsOf'> | undefined;
  readonly audit: Pick<AuditSink, 'record'>;
  readonly limiter: Pick<RateLimiter, 'charge'> | undefined;
  /** The email pseudonym of budget keys (`StaffSignIn.emailRef`). */
  readonly emailRef: (email: string) => string;
  /** Null without credentials keys: the TOTP doors answer 500 (production requires them). */
  readonly cipher: CredentialsCipher | null;
  readonly totpIssuer: string;
  /** Milliseconds since the epoch; tests pass a fixed clock. */
  readonly now?: () => number;
}

export class PlatformSignIn {
  readonly #deps: PlatformSignInDependencies;
  readonly #logger = new Logger('PlatformSignIn');
  readonly #now: () => number;

  constructor(deps: PlatformSignInDependencies) {
    this.#deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  /**
   * `platformLogin`: budgets first (10 per email, 50 per address an hour), one password check
   * whatever the email names, one `401 invalid_credentials` for an unknown, disabled, password-less
   * or non-staff (or revoked) user; then a `totp` challenge.
   */
  async login(
    input: { email: string; password: string },
    facts: RequestFacts,
  ): Promise<TotpChallengeStep> {
    // The password step always leads to TOTP: its success is counted as `second_factor`.
    return countedLogin(
      'platform',
      () => this.#login(input, facts),
      () => 'second_factor',
    );
  }

  async #login(
    input: { email: string; password: string },
    facts: RequestFacts,
  ): Promise<TotpChallengeStep> {
    const email = input.email.toLowerCase();
    await this.#deps.limiter?.charge('platform_login_email', this.#deps.emailRef(email));
    await this.#deps.limiter?.charge(
      'platform_login_ip',
      `ip:${addressKey(facts.ip ?? undefined)}`,
    );
    return this.#deps.sessions.store.run(async (tx) => {
      const user = await tx.users.findByEmail(email);
      // The staff lookup runs for an unknown email too (adversary L-2), so the one Argon2 verify
      // is the only cost that differs between an unknown and a known address.
      const staff = await tx.platformStaff.find(user?.id ?? absentUserId);
      const usable =
        user !== undefined &&
        !user.disabled &&
        user.passwordHash !== null &&
        staff !== undefined &&
        !staff.revoked;
      const check = await this.#deps.passwords.verify(
        input.password,
        usable
          ? (user.passwordHash ?? this.#deps.passwords.dummyHash)
          : this.#deps.passwords.dummyHash,
      );
      if (!usable || !check.ok) throw new ApiException('invalid_credentials');
      if (check.needsRehash) {
        await tx.users.signedIn(user.id, await this.#deps.passwords.hash(input.password));
      }
      const challengeId = await this.#challenge(tx, user.id, facts);
      return { challengeId, totpEnrolmentRequired: !staff.totpEnrolled };
    });
  }

  /**
   * `platformVerifyTotp`: the code of the enrolled secret within one step, above the last accepted
   * step; starts the session (`amr` pwd, totp). Every failure is `401 otp_invalid` and counts an
   * attempt; an expired challenge is `401 token_expired`.
   */
  async verify(
    input: { challengeId: string; code: string },
    facts: RequestFacts,
  ): Promise<PlatformSession> {
    const token = parseCompoundToken(input.challengeId);
    if (token === undefined) throw new ApiException('otp_invalid');
    const result = await this.#deps.sessions.store.run(async (tx) => {
      const challenge = await tx.challenges.lock(token.id, tokenHash(token.secret), 'totp');
      if (challenge === undefined || challenge.consumed) return new Refused();
      if (challenge.expired) throw new ApiException('token_expired');
      if (challenge.attempts >= maxAttempts) return new Refused();
      const subject = await this.#subject(tx, challenge.userId);
      const secret =
        subject?.staff.secretCiphertext === null || subject === undefined
          ? undefined
          : this.#decrypt(subject.staff.secretCiphertext, staffContext(subject.user.id));
      const step =
        secret === undefined
          ? undefined
          : matchingStep(secret, input.code, this.#seconds(), subject?.staff.lastStep ?? null);
      if (subject === undefined || step === undefined) {
        await tx.challenges.recordFailure(challenge.id);
        return new Refused();
      }
      await tx.platformStaff.acceptedStep(subject.user.id, step);
      await tx.challenges.consume(challenge.id);
      return this.#start(tx, subject.user, subject.staff, facts);
    });
    if (result instanceof Refused) throw new ApiException(result.code);
    return result;
  }

  /**
   * `platformEnrolTotp`: only on a live `totp` challenge from the password step or an accepted
   * invitation (`401 reauthentication_required` without the password), for a user with no secret
   * (`409 second_factor_already_enrolled`). After a super admin's reset only the challenge of a
   * redeemed re-enrolment link may enrol (adversary M-2): the password alone is `401
   * reauthentication_required` with `details.enrolment_link_required`. A new 20-byte secret is kept
   * encrypted on the challenge until a code confirms it; the otpauth URI is answered once (a second
   * call replaces the secret).
   */
  async enrol(input: { challengeId: string }): Promise<{ challengeId: string; uri: string }> {
    const cipher = this.#cipher();
    const token = parseCompoundToken(input.challengeId);
    if (token === undefined) throw new ApiException('token_invalid');
    return this.#deps.sessions.store.run(async (tx) => {
      const challenge = await tx.challenges.lock(token.id, tokenHash(token.secret), 'totp');
      if (challenge === undefined || challenge.consumed || challenge.attempts >= maxAttempts) {
        throw new ApiException('token_invalid');
      }
      if (challenge.expired) throw new ApiException('token_expired');
      if (!challenge.amr.includes('pwd')) throw new ApiException('reauthentication_required');
      const subject = await this.#subject(tx, challenge.userId);
      if (subject === undefined || subject.user.email === null) {
        throw new ApiException('token_invalid');
      }
      if (subject.staff.totpEnrolled) throw new ApiException('second_factor_already_enrolled');
      if (subject.staff.enrolmentLinkRequired && !challenge.amr.includes(linkRedeemed)) {
        throw linkRequired();
      }
      const secret = totpSecret();
      const sealed = cipher.encrypt(base32(secret), pendingContext(challenge.id));
      await tx.challenges.setPendingSecret(challenge.id, sealed.blob, sealed.keyId);
      this.#logger.log(`totp enrolment started user_id=${subject.user.id}`);
      return {
        challengeId: input.challengeId,
        uri: otpauthUri({
          issuer: this.#deps.totpIssuer,
          account: subject.user.email,
          secret,
        }),
      };
    });
  }

  /**
   * `platformConfirmTotp`: the first code of the pending secret commits it (encrypted under the
   * staff row's context, its step as the replay guard), audited `core.auth.totp_enrolled`, and
   * starts the session. Every failure is `401 otp_invalid` and counts an attempt.
   */
  async confirm(
    input: { challengeId: string; code: string },
    facts: RequestFacts,
  ): Promise<PlatformSession> {
    const cipher = this.#cipher();
    const token = parseCompoundToken(input.challengeId);
    if (token === undefined) throw new ApiException('otp_invalid');
    const result = await this.#deps.sessions.store.run(async (tx) => {
      const challenge = await tx.challenges.lock(token.id, tokenHash(token.secret), 'totp');
      if (challenge === undefined || challenge.consumed) return new Refused();
      if (challenge.expired) throw new ApiException('token_expired');
      if (challenge.attempts >= maxAttempts) return new Refused();
      const subject = await this.#subject(tx, challenge.userId);
      const secret =
        challenge.pendingSecretCiphertext === null
          ? undefined
          : this.#decrypt(challenge.pendingSecretCiphertext, pendingContext(challenge.id));
      const step =
        secret === undefined ? undefined : matchingStep(secret, input.code, this.#seconds(), null);
      if (
        subject === undefined ||
        subject.staff.totpEnrolled ||
        (subject.staff.enrolmentLinkRequired && !challenge.amr.includes(linkRedeemed)) ||
        secret === undefined ||
        step === undefined
      ) {
        await tx.challenges.recordFailure(challenge.id);
        return new Refused();
      }
      const sealed = cipher.encrypt(base32(secret), staffContext(subject.user.id));
      await tx.platformStaff.enrolTotp(subject.user.id, sealed.blob, sealed.keyId, step);
      await tx.challenges.consume(challenge.id);
      await this.#deps.audit.record({
        actorType: 'platform_user',
        actorId: subject.user.id,
        accountId: null,
        targetType: 'user',
        targetId: subject.user.id,
        action: 'core.auth.totp_enrolled',
        after: { key_id: sealed.keyId },
        requestId: facts.requestId,
        clientRequestId: facts.clientRequestId,
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
      return this.#start(tx, subject.user, subject.staff, facts);
    });
    if (result instanceof Refused) throw new ApiException(result.code);
    return result;
  }

  /**
   * `platformAcceptInvitation`: a live `platform` invitation sets the password (the rules of 2.2)
   * and the name, grants the staff row with the invited role (audited `core.invitation.accepted`)
   * and answers a `totp` challenge; no session until TOTP is enrolled and verified. Budget: 20 an
   * hour per address (plan 2.11). Under the staff doors' role lock (PLAT-13 adversary H-1), a link
   * that a later invitation of the email superseded, or one whose user is live staff already, is
   * `401 token_invalid`: an invitation never changes a live member's role (that is
   * `platformSetStaffRoles`, under its rules), and an old link never outlives a newer one.
   */
  async acceptInvitation(
    input: { token: string; name: string; password: string },
    facts: RequestFacts,
  ): Promise<TotpChallengeStep> {
    await this.#deps.limiter?.charge('auth_token_ip', `ip:${addressKey(facts.ip ?? undefined)}`);
    const problem = passwordProblem(input.password, this.#deps.breached);
    if (problem !== undefined) throw passwordRefusal('password', problem);
    const name = input.name.trim();
    if (name === '') {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/body/name', code: 'required' }],
      });
    }
    if (!isOpaqueToken(input.token)) throw new ApiException('token_invalid');
    const passwordHash = await this.#deps.passwords.hash(input.password);
    return this.#deps.sessions.store.run(async (tx) => {
      await tx.platformStaff.lockRoles();
      const invitation = await tx.invitations.lockByHash(tokenHash(input.token), 'platform');
      if (invitation === undefined || invitation.accepted || invitation.platformRole === null) {
        throw new ApiException('token_invalid');
      }
      if (await tx.invitations.platformSuperseded(invitation.id, invitation.email)) {
        throw new ApiException('token_invalid');
      }
      const found = await tx.users.findByEmail(invitation.email);
      const user = found === undefined ? undefined : await tx.users.lock(found.id);
      if (user === undefined || user.disabled) throw new ApiException('token_invalid');
      const current = await tx.platformStaff.find(user.id);
      if (current !== undefined && !current.revoked) throw new ApiException('token_invalid');
      if (invitation.expired) throw new ApiException('token_expired');
      const hadPassword = user.passwordHash !== null;
      await tx.users.setPassword(user.id, passwordHash, { name, endSessions: hadPassword });
      if (hadPassword)
        countRevocations('revoked', (await tx.refreshTokens.revokeAll(user.id, 'revoked')).length);
      await tx.platformStaff.grant(user.id, invitation.platformRole, invitation.invitedBy);
      await tx.invitations.accept(invitation.id);
      await this.#deps.audit.record({
        actorType: 'platform_user',
        actorId: user.id,
        accountId: null,
        targetType: 'invitation',
        targetId: invitation.id,
        action: 'core.invitation.accepted',
        after: { kind: 'platform', role: invitation.platformRole },
        requestId: facts.requestId,
        clientRequestId: facts.clientRequestId,
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
      const staff = await tx.platformStaff.find(user.id);
      const challengeId = await this.#challenge(tx, user.id, facts);
      return { challengeId, totpEnrolmentRequired: staff?.totpEnrolled !== true };
    });
  }

  /**
   * `platformRedeemEnrolmentLink` (PLAT-13 adversary M-2, mirroring staff's `redeemEnrolmentLink`):
   * the link `platformResetStaffTotp` mailed (24 hours) plus the user's password yield a `totp`
   * challenge (5 minutes) on which `platformEnrolTotp` and `platformConfirmTotp` work; neither alone
   * is enough. The link is spent; a wrong password counts an attempt on it (five end it) and
   * answers `401 invalid_credentials`. Budget: 20 an hour per address (plan 2.11).
   */
  async redeemEnrolmentLink(
    input: { token: string; password: string },
    facts: RequestFacts,
  ): Promise<TotpChallengeStep> {
    await this.#deps.limiter?.charge('auth_token_ip', `ip:${addressKey(facts.ip ?? undefined)}`);
    const token = parseCompoundToken(input.token);
    if (token === undefined) throw new ApiException('token_invalid');
    const result = await this.#deps.sessions.store.run(async (tx) => {
      const link = await tx.challenges.lock(token.id, tokenHash(token.secret), 'enrolment_link');
      const usable =
        link !== undefined &&
        !link.consumed &&
        link.amr.includes(platformLinkMarker) &&
        link.attempts < maxAttempts;
      if (!usable) return new Refused('token_invalid');
      if (link.expired) throw new ApiException('token_expired');
      const user = await tx.users.find(link.userId);
      const staff = await tx.platformStaff.find(link.userId);
      const hash =
        user !== undefined && !user.disabled && staff !== undefined && !staff.revoked
          ? user.passwordHash
          : null;
      const check = await this.#deps.passwords.verify(
        input.password,
        hash ?? this.#deps.passwords.dummyHash,
      );
      if (hash === null || staff === undefined || !check.ok) {
        await tx.challenges.recordFailure(link.id);
        return new Refused(hash === null ? 'token_invalid' : 'invalid_credentials');
      }
      await tx.challenges.consume(link.id);
      const challengeId = await this.#challenge(tx, link.userId, facts, ['pwd', linkRedeemed]);
      return { challengeId, totpEnrolmentRequired: !staff.totpEnrolled };
    });
    if (result instanceof Refused) throw new ApiException(result.code);
    return result;
  }

  async #challenge(
    tx: IdentityTransaction,
    userId: string,
    facts: RequestFacts,
    amr: readonly string[] = ['pwd'],
  ): Promise<string> {
    const id = uuidv7();
    const secret = opaqueToken();
    await tx.challenges.insert({
      id,
      kind: 'totp',
      userId,
      secretHash: tokenHash(secret),
      amr,
      membershipIds: null,
      ttlSeconds: totpChallengeTtlSeconds,
      ip: facts.ip,
    });
    return compoundToken(id, secret);
  }

  /** The user and the staff row (locked) a TOTP step may continue for, or undefined. */
  async #subject(
    tx: IdentityTransaction,
    userId: string,
  ): Promise<{ user: UserRow; staff: PlatformStaffTotp } | undefined> {
    const user = await tx.users.find(userId);
    const staff = await tx.platformStaff.lockTotp(userId);
    if (user === undefined || user.disabled || staff === undefined || staff.revoked) {
      return undefined;
    }
    return { user, staff };
  }

  async #start(
    tx: IdentityTransaction,
    user: UserRow,
    staff: PlatformStaffTotp,
    facts: RequestFacts,
  ): Promise<PlatformSession> {
    const session = await this.#deps.sessions.start(
      tx,
      {
        surface: 'platform',
        userId: user.id,
        tokenVersion: user.tokenVersion,
        role: staff.role,
        amr: ['pwd', 'totp'],
      },
      facts,
    );
    const principal: Principal = {
      kind: 'platform',
      userId: user.id,
      roles: [staff.role],
      scopes: '',
      sites: [],
      tokenVersion: user.tokenVersion,
      amr: ['pwd', 'totp'],
    };
    return { session, me: await platformMe(tx, principal, this.#deps.resolver) };
  }

  /** The secret of a blob, or undefined when it does not decrypt (a retired key). */
  #decrypt(blob: Buffer, context: string): Buffer | undefined {
    try {
      return fromBase32(this.#cipher().decrypt(blob, context));
    } catch (error) {
      if (error instanceof ApiException) throw error;
      this.#logger.warn('a TOTP secret did not decrypt');
      return undefined;
    }
  }

  #cipher(): CredentialsCipher {
    const cipher = this.#deps.cipher;
    if (cipher === null) throw new ApiException('internal_error');
    return cipher;
  }

  #seconds(): number {
    return Math.floor(this.#now() / 1000);
  }
}
