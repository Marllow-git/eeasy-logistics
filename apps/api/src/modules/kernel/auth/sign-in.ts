import { createHmac, hkdfSync } from 'node:crypto';
import { uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import type { PermissionResolver } from '../authz/permission-resolver.js';
import { ApiException } from '../errors/api-exception.js';
import type { FieldProblem } from '../errors/api-exception.js';
import type {
  IdentityTransaction,
  MembershipRow,
  UserRow,
} from '../platform/identity.repository.js';
import { signInAccountStatuses } from '../platform/identity.repository.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { addressKey } from '../rate-limit/rate-limiter.js';
import type { AuthenticationMethod } from './access-token.js';
import { authenticationMethods } from './access-token.js';
import type { IssuedSession } from './cookies.js';
import type { StaffMeView } from './me.js';
import { permissionsOf, staffPrincipal } from './me.js';
import type { BreachedPasswords, PasswordHasher } from './passwords.js';
import { passwordProblem } from './passwords.js';
import type { Principal } from './principal.js';
import type { RequestFacts } from './request-facts.js';
import type { SessionService } from './sessions.js';
import {
  compoundToken,
  isOpaqueToken,
  opaqueToken,
  parseCompoundToken,
  tokenHash,
} from './tokens.js';

// Staff sign-in (PLAT-11 plan 2.7, 2.10, 2.11; identity and tenancy §3.1, §8; staff.yaml `login`,
// `selectAccount`, `switchAccount`, `acceptInvitation`). The password first, verified once whatever
// the email names (the dummy hash for an unknown, disabled or password-less user), one body for
// every failure; then the factors any of the user's accounts requires (N1, N2), and only then the
// account list or the session. The account of a session comes only from a pinned membership.

/** Challenge lifetimes (plan 2.7, N2; contracts README "Codes and challenges"). */
export const challengeTtlSeconds = {
  second_factor: 300,
  selection: 300,
  enrolment: 600,
} as const;

/** What `login` (and the steps that continue it) answers before or with a session. */
export type SignInStep =
  | { readonly kind: 'session'; readonly session: IssuedSession; readonly me: StaffMeView }
  | {
      readonly kind: 'selection';
      readonly selectionToken: string;
      readonly memberships: readonly MembershipRow[];
    }
  | { readonly kind: 'second_factor'; readonly challengeId: string }
  | { readonly kind: 'enrolment'; readonly enrolmentToken: string };

/** A session started for one membership (`selectAccount`, `switchAccount`, `acceptInvitation`). */
export interface StartedSession {
  readonly session: IssuedSession;
  readonly me: StaffMeView;
}

/**
 * A step that must answer `401 second_factor_required` after its transaction committed, with the
 * challenge to verify (`challenge_id`) or, when no factor is enrolled, the enrolment to start
 * (`enrolment_token`); empty when neither can be made.
 */
class FactorRequired {
  constructor(readonly details: Readonly<Record<string, string>>) {}
}

export interface StaffSignInDependencies {
  readonly sessions: SessionService;
  readonly passwords: Pick<PasswordHasher, 'verify' | 'hash' | 'dummyHash'>;
  readonly breached: Pick<BreachedPasswords, 'has'>;
  readonly resolver: Pick<PermissionResolver, 'grantsOf'> | undefined;
  readonly audit: Pick<AuditSink, 'record'>;
  /** Undefined without `REDIS_URL`: no budget is charged. */
  readonly limiter: Pick<RateLimiter, 'charge'> | undefined;
  /** The key of the email pseudonyms in budget keys (HKDF of the signing key); none: 500. */
  readonly emailKey: Buffer | undefined;
}

/** The HMAC key of email pseudonyms: HKDF-SHA256 of the signing key, info `elx-auth-email`. */
export function emailKeyOf(signingKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', signingKey, Buffer.alloc(0), 'elx-auth-email', 32));
}

const methods: ReadonlySet<string> = new Set(authenticationMethods);
const knownMethods = (amr: readonly string[]): AuthenticationMethod[] =>
  amr.filter((method): method is AuthenticationMethod => methods.has(method));

/** `400 validation_failed` at `/body/<field>` for a password the rules refuse. */
export function passwordRefusal(field: string, problem: string): ApiException {
  return new ApiException('validation_failed', {
    fields: [{ pointer: `/body/${field}`, code: problem } as FieldProblem],
  });
}

export class StaffSignIn {
  readonly #deps: StaffSignInDependencies;
  readonly #logger = new Logger('SignIn');

  constructor(deps: StaffSignInDependencies) {
    this.#deps = deps;
  }

  /** The budget identity of an email: an HMAC pseudonym of the lower-cased address (plan 2.11). */
  emailRef(email: string): string {
    const key = this.#deps.emailKey;
    if (key === undefined) throw new ApiException('internal_error');
    return `email:${createHmac('sha256', key).update(email.toLowerCase(), 'utf8').digest('base64url')}`;
  }

  /**
   * `login` (plan 2.7). Budgets first (10 per email, 50 per address an hour), so a refused request
   * costs no hash. Unknown, disabled, password-less and membership-less users get the same
   * `401 invalid_credentials` after the same one verification.
   */
  async login(
    input: { email: string; password: string },
    facts: RequestFacts,
  ): Promise<SignInStep> {
    const email = input.email.toLowerCase();
    await this.#deps.limiter?.charge('login_email', this.emailRef(email));
    await this.#deps.limiter?.charge('login_ip', `ip:${addressKey(facts.ip ?? undefined)}`);
    return this.#deps.sessions.store.run(async (tx) => {
      const user = await tx.users.findByEmail(email);
      const usable = user !== undefined && !user.disabled && user.passwordHash !== null;
      const check = await this.#deps.passwords.verify(
        input.password,
        usable
          ? (user.passwordHash ?? this.#deps.passwords.dummyHash)
          : this.#deps.passwords.dummyHash,
      );
      if (!usable || !check.ok) throw new ApiException('invalid_credentials');
      const memberships = await tx.memberships.signInMemberships(user.id);
      if (memberships.length === 0) throw new ApiException('invalid_credentials');
      if (check.needsRehash) {
        await tx.users.signedIn(user.id, await this.#deps.passwords.hash(input.password));
      }
      return this.continueSignIn(tx, user, memberships, ['pwd'], facts);
    });
  }

  /**
   * `selectAccount` (plan 2.7): consumes the selection challenge and starts the session on one of
   * its pinned memberships; another membership is `404 not_found` (the challenge stays usable).
   */
  async selectAccount(
    input: { selectionToken: string; membershipId: string },
    facts: RequestFacts,
  ): Promise<StartedSession> {
    await this.#chargeTokenDoor(facts);
    const token = parseCompoundToken(input.selectionToken);
    if (token === undefined) throw new ApiException('token_invalid');
    const result = await this.#deps.sessions.store.run(async (tx) => {
      const challenge = await tx.challenges.lock(token.id, tokenHash(token.secret), 'selection');
      if (challenge === undefined || challenge.consumed) throw new ApiException('token_invalid');
      if (challenge.expired) throw new ApiException('token_expired');
      if (!(challenge.membershipIds ?? []).includes(input.membershipId)) {
        throw new ApiException('not_found');
      }
      const user = await tx.users.find(challenge.userId);
      const membership = await tx.memberships.findOfUser(input.membershipId, challenge.userId);
      if (user === undefined || user.disabled) throw new ApiException('token_invalid');
      if (membership === undefined || !signInMembership(membership)) {
        throw new ApiException('not_found');
      }
      const amr = knownMethods(challenge.amr);
      const factor = await this.#factorFor(tx, user, membership, amr, facts);
      if (factor !== undefined) return factor;
      await tx.challenges.consume(challenge.id);
      return this.#start(tx, user, membership, amr, facts);
    });
    return this.#settle(result);
  }

  /**
   * `switchAccount` (plan 2.7): another active membership of the same user on an account that is
   * not suspended; the current family is revoked and a new session starts with the same `amr`.
   */
  async switchAccount(
    principal: Principal,
    membershipId: string,
    facts: RequestFacts,
  ): Promise<StartedSession> {
    if (principal.kind !== 'staff') throw new ApiException('unauthenticated');
    const result = await this.#deps.sessions.store.run(async (tx) => {
      const user = await tx.users.find(principal.userId);
      if (user === undefined || user.disabled || user.tokenVersion !== principal.tokenVersion) {
        throw new ApiException('token_invalid');
      }
      const membership = await tx.memberships.findOfUser(membershipId, principal.userId);
      if (membership === undefined || membership.status !== 'active') {
        throw new ApiException('not_found');
      }
      if (membership.account.status === 'suspended') throw new ApiException('account_suspended');
      if (!signInMembership(membership)) throw new ApiException('not_found');
      const amr = knownMethods(principal.amr ?? []);
      const factor = await this.#factorFor(tx, user, membership, amr, facts);
      if (factor !== undefined) return factor;
      await this.#deps.sessions.endCurrent(
        tx,
        {
          surface: 'staff',
          userId: principal.userId,
          accountId: principal.accountId,
          membershipId: principal.membershipId,
        },
        facts,
        'switch_account',
      );
      return this.#start(tx, user, membership, amr, facts);
    });
    return this.#settle(result);
  }

  /**
   * `acceptInvitation` (plan 2.10): a live `staff` invitation of an `invited` membership sets the
   * password (the rules of 2.2) and the name, activates the membership and is audited
   * `core.invitation.accepted`; then the factors of the user's accounts apply as at `login`, and the
   * session starts on the accepted membership.
   */
  async acceptInvitation(
    input: { token: string; name: string; password: string; locale?: 'ar' | 'en' | undefined },
    facts: RequestFacts,
  ): Promise<StartedSession> {
    await this.#chargeTokenDoor(facts);
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
    const result = await this.#deps.sessions.store.run(async (tx) => {
      const invitation = await tx.invitations.lockByHash(tokenHash(input.token), 'staff');
      if (invitation === undefined || invitation.accepted || invitation.membershipId === null) {
        throw new ApiException('token_invalid');
      }
      if (invitation.expired) throw new ApiException('token_expired');
      const pending = await tx.memberships.find(invitation.membershipId);
      const user = pending === undefined ? undefined : await tx.users.lock(pending.userId);
      if (
        pending === undefined ||
        pending.status !== 'invited' ||
        user === undefined ||
        user.disabled
      ) {
        throw new ApiException('token_invalid');
      }
      // A user who already had a password (a member of another account) ends their other sessions
      // with the change, as a reset would (identity and tenancy §4).
      const hadPassword = user.passwordHash !== null;
      await tx.users.setPassword(user.id, passwordHash, {
        name,
        locale: input.locale,
        endSessions: hadPassword,
      });
      if (hadPassword) await tx.refreshTokens.revokeAll(user.id, 'revoked');
      await tx.memberships.activate(pending.id);
      await tx.invitations.accept(invitation.id);
      await this.#deps.audit.record({
        actorType: 'user',
        actorId: user.id,
        accountId: pending.accountId,
        targetType: 'invitation',
        targetId: invitation.id,
        action: 'core.invitation.accepted',
        after: { membership_id: pending.id, roles: [...pending.roles] },
        requestId: facts.requestId,
        clientRequestId: facts.clientRequestId,
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
      const accepted = await tx.users.find(user.id);
      const membership = await tx.memberships.findOfUser(pending.id, user.id);
      if (accepted === undefined || membership === undefined)
        throw new Error('Accept lost its rows');
      if (!signInMembership(membership)) throw new ApiException('token_invalid');
      const memberships = await tx.memberships.signInMemberships(user.id);
      const step = await this.#factorStep(tx, accepted, memberships, ['pwd'], facts);
      if (step !== undefined) {
        return new FactorRequired(
          step.kind === 'second_factor'
            ? { challenge_id: step.challengeId }
            : { enrolment_token: step.enrolmentToken },
        );
      }
      return this.#start(tx, accepted, membership, ['pwd'], facts);
    });
    return this.#settle(result);
  }

  /**
   * After the password (and the OTP of `verifySecondFactor`): the factors still due, then the session
   * (one membership) or the selection (several).
   */
  async continueSignIn(
    tx: IdentityTransaction,
    user: UserRow,
    memberships: readonly MembershipRow[],
    amr: readonly AuthenticationMethod[],
    facts: RequestFacts,
  ): Promise<SignInStep> {
    const factor = await this.#factorStep(tx, user, memberships, amr, facts);
    if (factor !== undefined) return factor;
    const [only] = memberships;
    if (memberships.length === 1 && only !== undefined) {
      const started = await this.#start(tx, user, only, amr, facts);
      return { kind: 'session', ...started };
    }
    const selection = await this.#challenge(tx, 'selection', user.id, amr, facts, memberships);
    return { kind: 'selection', selectionToken: selection, memberships };
  }

  /**
   * The factor a set of memberships requires (N1, N2; identity and tenancy §3.1): an enrolled
   * factor is always asked for until it has passed; a factor an account requires but the user has
   * not enrolled asks for enrolment. Undefined when nothing more is due.
   */
  async #factorStep(
    tx: IdentityTransaction,
    user: UserRow,
    memberships: readonly MembershipRow[],
    amr: readonly AuthenticationMethod[],
    facts: RequestFacts,
  ): Promise<Extract<SignInStep, { kind: 'second_factor' | 'enrolment' }> | undefined> {
    if (amr.includes('otp')) return undefined;
    const required = memberships.some((membership) => membership.account.secondFactorRequired);
    if (user.secondFactorEnabled) {
      const challengeId = await this.#challenge(
        tx,
        'second_factor',
        user.id,
        amr,
        facts,
        memberships,
      );
      return { kind: 'second_factor', challengeId };
    }
    if (required) {
      const enrolmentToken = await this.#challenge(
        tx,
        'enrolment',
        user.id,
        amr,
        facts,
        memberships,
      );
      return { kind: 'enrolment', enrolmentToken };
    }
    return undefined;
  }

  /** The factor one target account needs and the session lacks (select and switch), if any. */
  async #factorFor(
    tx: IdentityTransaction,
    user: UserRow,
    membership: MembershipRow,
    amr: readonly AuthenticationMethod[],
    facts: RequestFacts,
  ): Promise<FactorRequired | undefined> {
    if (amr.includes('otp') || !membership.account.secondFactorRequired) return undefined;
    const kind = user.secondFactorEnabled ? 'second_factor' : 'enrolment';
    const token = await this.#challenge(tx, kind, user.id, amr, facts, [membership]);
    return new FactorRequired(
      kind === 'second_factor' ? { challenge_id: token } : { enrolment_token: token },
    );
  }

  async #challenge(
    tx: IdentityTransaction,
    kind: 'second_factor' | 'selection' | 'enrolment',
    userId: string,
    amr: readonly AuthenticationMethod[],
    facts: RequestFacts,
    memberships: readonly MembershipRow[],
  ): Promise<string> {
    const id = uuidv7();
    const secret = opaqueToken();
    await tx.challenges.insert({
      id,
      kind,
      userId,
      secretHash: tokenHash(secret),
      amr,
      membershipIds: memberships.map((membership) => membership.id),
      ttlSeconds: challengeTtlSeconds[kind],
      ip: facts.ip,
    });
    return compoundToken(id, secret);
  }

  async #start(
    tx: IdentityTransaction,
    user: UserRow,
    membership: MembershipRow,
    amr: readonly AuthenticationMethod[],
    facts: RequestFacts,
  ): Promise<StartedSession> {
    const session = await this.#deps.sessions.start(
      tx,
      { surface: 'staff', userId: user.id, tokenVersion: user.tokenVersion, membership, amr },
      facts,
    );
    const principal = staffPrincipal(user.id, membership, user.tokenVersion);
    this.#logger.log(`staff signed in user_id=${user.id}`);
    return {
      session,
      me: {
        user,
        membership,
        permissions: permissionsOf(this.#deps.resolver, principal),
        features: [],
      },
    };
  }

  /** `401 second_factor_required` with the challenge or enrolment it created, or the session. */
  #settle(result: StartedSession | FactorRequired): StartedSession {
    if (result instanceof FactorRequired) {
      throw new ApiException('second_factor_required', { details: { ...result.details } });
    }
    return result;
  }

  /** 20 an hour per address: accept, confirm a reset, redeem a link, select an account (2.11). */
  async #chargeTokenDoor(facts: RequestFacts): Promise<void> {
    await this.#deps.limiter?.charge('auth_token_ip', `ip:${addressKey(facts.ip ?? undefined)}`);
  }
}

/** An active membership on an account whose members may sign in. */
export function signInMembership(membership: MembershipRow): boolean {
  return (
    membership.status === 'active' &&
    (signInAccountStatuses as readonly string[]).includes(membership.account.status)
  );
}
