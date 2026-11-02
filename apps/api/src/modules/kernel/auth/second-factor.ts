import { Logger } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import { ApiException } from '../errors/api-exception.js';
import type { OtpService } from '../messaging/otp.service.js';
import { otpRules } from '../messaging/otp.service.js';
import { normalisePhone, phoneTail } from '../messaging/phone.js';
import type {
  IdentityTransaction,
  MembershipRow,
  UserRow,
} from '../platform/identity.repository.js';
import type { ChallengeRow } from '../platform/auth-challenges.repository.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { addressKey } from '../rate-limit/rate-limiter.js';
import type { ChallengeKind } from '../schema/identity.js';
import type { AuthenticationMethod } from './access-token.js';
import { authenticationMethods } from './access-token.js';
import type { PasswordHasher } from './passwords.js';
import { platformLinkMarker } from './platform-sign-in.js';
import type { RequestFacts } from './request-facts.js';
import type { SessionService } from './sessions.js';
import type { SignInStep, StaffSignIn } from './sign-in.js';
import { challengeTtlSeconds, signInMembership } from './sign-in.js';
import { compoundToken, opaqueToken, parseCompoundToken, tokenHash } from './tokens.js';

// The staff second factor (PLAT-11 plan 2.8; identity and tenancy §3.1; staff.yaml
// `requestSecondFactor`, `verifySecondFactor`, `enrolSecondFactor`, `confirmSecondFactor`,
// `redeemEnrolmentLink`; PLAT-9 `OtpService`, purpose `second_factor`, and `second_factor_enrol`
// while enrolling). The code goes only to the phone stored on the user (or, while enrolling, the
// phone the enrolment holds), never to a phone from the request of a sign-in (PLAT-9 adversary
// M-1). An enrolment's codes have their own purpose (PLAT-11 adversary M-1): the phone it names may
// be anyone's, and under the sign-in purpose it would supersede, cool down and spend the attempts of
// that phone's live sign-in code. Every challenge counts its own attempts
// before the code is checked, so five tries end it whatever the OTP's own count says; a check runs
// in three steps (the challenge charged and committed, the code verified in PLAT-9's transaction,
// the challenge consumed), so no request holds two platform connections at once.

/** Enrolment tokens accept both kinds: login's (N2) and a redeemed emailed link's (`pwd` passed). */
const enrolmentKinds: readonly ChallengeKind[] = ['enrolment', 'enrolment_link'];

/** An emailed link's life (plan 2.8: 24 hours). */
export const enrolmentLinkTtlSeconds = 24 * 3600;

const methods: ReadonlySet<string> = new Set(authenticationMethods);
const knownMethods = (amr: readonly string[]): AuthenticationMethod[] =>
  amr.filter((method): method is AuthenticationMethod => methods.has(method));

/** A refusal decided inside a transaction that must commit first (a counted attempt). */
class Refused {
  constructor(readonly code: 'otp_invalid' | 'token_invalid' | 'invalid_credentials') {}
}

export interface StaffSecondFactorDependencies {
  readonly sessions: Pick<SessionService, 'store'>;
  readonly signIn: Pick<StaffSignIn, 'continueSignIn'>;
  readonly otp: Pick<OtpService, 'request' | 'verify'>;
  readonly passwords: Pick<PasswordHasher, 'verify' | 'dummyHash'>;
  readonly audit: Pick<AuditSink, 'record'>;
  /** Undefined without `REDIS_URL`: no budget is charged. */
  readonly limiter: Pick<RateLimiter, 'charge'> | undefined;
}

export class StaffSecondFactor {
  readonly #deps: StaffSecondFactorDependencies;
  readonly #logger = new Logger('SecondFactor');

  constructor(deps: StaffSecondFactorDependencies) {
    this.#deps = deps;
  }

  /**
   * `requestSecondFactor`: a live `second_factor` challenge sends a code to the user's enrolled
   * phone (PLAT-9 cooldown and budgets apply; `503 messaging_unavailable` passes through). An
   * unknown, used, expired or exhausted challenge is `401 token_invalid` (the one code the
   * operation lists).
   */
  async request(input: { challengeId: string }, facts: RequestFacts): Promise<void> {
    const token = parseCompoundToken(input.challengeId);
    if (token === undefined) throw new ApiException('token_invalid');
    const target = await this.#deps.sessions.store.run(async (tx) => {
      const challenge = await tx.challenges.lock(
        token.id,
        tokenHash(token.secret),
        'second_factor',
      );
      if (!isOpen(challenge)) throw new ApiException('token_invalid');
      const user = await tx.users.find(challenge.userId);
      if (user === undefined || user.disabled || !user.secondFactorEnabled) {
        throw new ApiException('token_invalid');
      }
      const phone = user.secondFactorPhone;
      if (phone === null) throw new ApiException('token_invalid');
      return { phone, locale: user.locale };
    });
    await this.#deps.otp.request({
      phone: target.phone,
      purpose: 'second_factor',
      ip: facts.ip ?? undefined,
      locale: target.locale,
    });
  }

  /**
   * `verifySecondFactor`: the code of the user's phone passes the challenge; `otp` joins the
   * methods and the sign-in continues as `login` does (the session, or the selection of the pinned
   * memberships that still allow sign-in). Every failure is `401 otp_invalid`; an expired
   * challenge is `401 token_expired`.
   */
  async verify(
    input: { challengeId: string; code: string },
    facts: RequestFacts,
  ): Promise<SignInStep> {
    const token = parseCompoundToken(input.challengeId);
    if (token === undefined) throw new ApiException('otp_invalid');
    const secretHash = tokenHash(token.secret);
    const store = this.#deps.sessions.store;
    const charged = await store.run(async (tx) => {
      const challenge = await tx.challenges.lock(token.id, secretHash, 'second_factor');
      if (challenge === undefined || challenge.consumed) return new Refused('otp_invalid');
      if (challenge.expired) throw new ApiException('token_expired');
      if (challenge.attempts >= otpRules.maxAttempts) return new Refused('otp_invalid');
      await tx.challenges.recordFailure(challenge.id);
      const user = await tx.users.find(challenge.userId);
      if (user === undefined || user.disabled || !user.secondFactorEnabled) {
        return new Refused('otp_invalid');
      }
      return user.secondFactorPhone ?? new Refused('otp_invalid');
    });
    if (charged instanceof Refused) throw new ApiException(charged.code);
    await this.#deps.otp.verify({ phone: charged, purpose: 'second_factor', code: input.code });
    const step = await store.run(async (tx) => {
      const challenge = await tx.challenges.lock(token.id, secretHash, 'second_factor');
      if (challenge === undefined || challenge.consumed) throw new ApiException('otp_invalid');
      const user = await tx.users.find(challenge.userId);
      if (user === undefined || user.disabled || user.secondFactorPhone !== charged) {
        throw new ApiException('otp_invalid');
      }
      const memberships = await pinnedMemberships(tx, challenge, user);
      if (memberships.length === 0) throw new ApiException('otp_invalid');
      await tx.challenges.consume(challenge.id);
      const amr = knownMethods([...challenge.amr, 'otp']);
      this.#logger.log(`second factor passed user_id=${user.id}`);
      return this.#deps.signIn.continueSignIn(tx, user, memberships, unique(amr), facts);
    });
    return step;
  }

  /**
   * `enrolSecondFactor` (N2): only on an enrolment token (login's, or a redeemed emailed link's).
   * A user with a factor enrolled is `409 second_factor_already_enrolled`; so is a user whose factor
   * was reset, until an emailed link is redeemed (the password alone cannot enrol again,
   * staff.yaml). The phone is normalised (PLAT-9) and kept on the challenge; the code goes to it.
   */
  async enrol(
    input: { enrolmentToken: string; phone: string },
    facts: RequestFacts,
  ): Promise<{ challengeId: string; expiresAt: Date }> {
    const token = parseCompoundToken(input.enrolmentToken);
    if (token === undefined) throw new ApiException('token_invalid');
    const phone = normalisePhone(input.phone);
    if (phone === undefined) {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/body/phone', code: 'invalid' }],
      });
    }
    const pending = await this.#deps.sessions.store.run(async (tx) => {
      const challenge = await this.#enrolment(tx, token.id, tokenHash(token.secret));
      const user = await tx.users.find(challenge.userId);
      if (user === undefined || user.disabled) throw new ApiException('token_invalid');
      if (
        user.secondFactorEnabled ||
        (challenge.kind === 'enrolment' && user.secondFactorPhone !== null)
      ) {
        throw new ApiException('second_factor_already_enrolled');
      }
      await tx.challenges.setPendingPhone(challenge.id, phone);
      return { id: challenge.id, expiresAt: challenge.expiresAt, locale: user.locale };
    });
    await this.#deps.otp.request({
      phone,
      purpose: 'second_factor_enrol',
      ip: facts.ip ?? undefined,
      locale: pending.locale,
    });
    this.#logger.log(`second factor enrolment code sent phone=${phoneTail(phone)}`);
    const codeExpiry = Date.now() + otpRules.ttlSeconds * 1000;
    return {
      challengeId: pending.id,
      expiresAt: new Date(Math.min(codeExpiry, pending.expiresAt.getTime())),
    };
  }

  /**
   * `confirmSecondFactor`: the enrolment token, its challenge id (the enrolment's row) and the code
   * sent to the pending phone. Five attempts per enrolment; on success the factor is enabled on that
   * phone, the token is spent, `core.auth.second_factor_enrolled` is audited, and the user signs in
   * again (`204`, no session).
   */
  async confirm(
    input: { enrolmentToken: string; challengeId: string; code: string },
    facts: RequestFacts,
  ): Promise<void> {
    const token = parseCompoundToken(input.enrolmentToken);
    if (token === undefined || token.id !== input.challengeId) {
      throw new ApiException('token_invalid');
    }
    const secretHash = tokenHash(token.secret);
    const store = this.#deps.sessions.store;
    const charged = await store.run(async (tx) => {
      const challenge = await this.#enrolment(tx, token.id, secretHash);
      if (challenge.pendingPhone === null || challenge.attempts >= otpRules.maxAttempts) {
        return new Refused('otp_invalid');
      }
      await tx.challenges.recordFailure(challenge.id);
      const user = await tx.users.find(challenge.userId);
      if (user === undefined || user.disabled || user.secondFactorEnabled) {
        return new Refused('token_invalid');
      }
      return challenge.pendingPhone;
    });
    if (charged instanceof Refused) throw new ApiException(charged.code);
    await this.#deps.otp.verify({
      phone: charged,
      purpose: 'second_factor_enrol',
      code: input.code,
    });
    await store.run(async (tx) => {
      const challenge = await this.#enrolment(tx, token.id, secretHash);
      if (challenge.pendingPhone !== charged) throw new ApiException('otp_invalid');
      const user = await tx.users.lock(challenge.userId);
      if (user === undefined || user.disabled || user.secondFactorEnabled) {
        throw new ApiException('token_invalid');
      }
      await tx.users.enableSecondFactor(user.id, charged);
      await tx.challenges.consume(challenge.id);
      await this.#deps.audit.record({
        actorType: 'user',
        actorId: user.id,
        accountId: null,
        targetType: 'user',
        targetId: user.id,
        action: 'core.auth.second_factor_enrolled',
        after: { method: 'otp', via: challenge.kind === 'enrolment_link' ? 'link' : 'sign_in' },
        requestId: facts.requestId,
        clientRequestId: facts.clientRequestId,
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
    });
    this.#logger.log(`second factor enrolled phone=${phoneTail(charged)}`);
  }

  /**
   * `redeemEnrolmentLink`: the emailed link plus the user's password yield an enrolment token (10
   * minutes); neither alone is enough. The link's own secret stops working; a wrong password counts
   * an attempt on the link (five end it) and answers `401 invalid_credentials`. Budget: 20 an hour
   * per address (plan 2.11).
   */
  async redeemLink(
    input: { linkToken: string; password: string },
    facts: RequestFacts,
  ): Promise<{ enrolmentToken: string; expiresAt: Date }> {
    await this.#deps.limiter?.charge('auth_token_ip', `ip:${addressKey(facts.ip ?? undefined)}`);
    const token = parseCompoundToken(input.linkToken);
    if (token === undefined) throw new ApiException('token_invalid');
    const secret = opaqueToken();
    const result = await this.#deps.sessions.store.run(async (tx) => {
      const link = await tx.challenges.lock(token.id, tokenHash(token.secret), 'enrolment_link');
      const usable =
        link !== undefined &&
        !link.consumed &&
        !link.amr.includes('pwd') &&
        // A platform TOTP re-enrolment link is the platform door's only (PLAT-13 adversary M-2).
        !link.amr.includes(platformLinkMarker) &&
        link.attempts < otpRules.maxAttempts;
      if (!usable) return new Refused('token_invalid');
      if (link.expired) throw new ApiException('token_expired');
      const user = await tx.users.find(link.userId);
      const hash = user !== undefined && !user.disabled ? user.passwordHash : null;
      const check = await this.#deps.passwords.verify(
        input.password,
        hash ?? this.#deps.passwords.dummyHash,
      );
      if (hash === null || !check.ok) {
        await tx.challenges.recordFailure(link.id);
        return new Refused(hash === null ? 'token_invalid' : 'invalid_credentials');
      }
      const expiresAt = await tx.challenges.redeem(
        link.id,
        tokenHash(secret),
        ['pwd'],
        challengeTtlSeconds.enrolment,
      );
      return { id: link.id, expiresAt };
    });
    if (result instanceof Refused) throw new ApiException(result.code);
    return { enrolmentToken: compoundToken(result.id, secret), expiresAt: result.expiresAt };
  }

  /** A live enrolment challenge (login's, or a redeemed link's), or the refusal. */
  async #enrolment(tx: IdentityTransaction, id: string, secretHash: Buffer): Promise<ChallengeRow> {
    const challenge = await tx.challenges.lock(id, secretHash, enrolmentKinds);
    if (challenge === undefined || challenge.consumed) throw new ApiException('token_invalid');
    if (challenge.kind === 'enrolment_link' && !challenge.amr.includes('pwd')) {
      throw new ApiException('token_invalid');
    }
    if (challenge.expired) throw new ApiException('token_expired');
    return challenge;
  }
}

/** Unconsumed, unexpired and under its attempts. */
function isOpen(challenge: ChallengeRow | undefined): challenge is ChallengeRow {
  return (
    challenge !== undefined &&
    !challenge.consumed &&
    !challenge.expired &&
    challenge.attempts < otpRules.maxAttempts
  );
}

/** The challenge's pinned memberships that still allow sign-in, in the user's sign-in order. */
async function pinnedMemberships(
  tx: IdentityTransaction,
  challenge: ChallengeRow,
  user: UserRow,
): Promise<MembershipRow[]> {
  const pinned = new Set(challenge.membershipIds ?? []);
  const current = await tx.memberships.signInMemberships(user.id);
  return current.filter((membership) => pinned.has(membership.id) && signInMembership(membership));
}

function unique(amr: readonly AuthenticationMethod[]): AuthenticationMethod[] {
  return [...new Set(amr)];
}
