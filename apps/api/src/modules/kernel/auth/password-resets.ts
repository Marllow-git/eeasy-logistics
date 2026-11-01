import type { CredentialsCipher } from '@eeasy-logistics/config';
import { uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import { ApiException } from '../errors/api-exception.js';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import type { IdentityStore } from '../platform/identity.repository.js';
import type { RateLimiter } from '../rate-limit/rate-limiter.js';
import { addressKey } from '../rate-limit/rate-limiter.js';
import { countRevocations } from './auth-metrics.js';
import { enqueueMail, mailLink } from './mail-links.js';
import type { BreachedPasswords, PasswordHasher } from './passwords.js';
import { passwordProblem } from './passwords.js';
import type { RequestFacts } from './request-facts.js';
import { passwordRefusal } from './sign-in.js';
import { isOpaqueToken, opaqueToken, tokenHash } from './tokens.js';

// Password resets (PLAT-11 plan 2.10; identity and tenancy §3.1, §4): an emailed one-time link
// valid 30 minutes (`/password-reset/<token>` on the web), one live token per user; confirming sets
// the password, moves `token_version` and revokes every refresh family. Staff only: platform staff
// reset through PLAT-13's door.

export const resetTtlSeconds = 30 * 60;

export interface PasswordResetsDependencies {
  readonly store: IdentityStore | null;
  readonly outbox: Pick<OutboxWriter, 'enqueue'>;
  readonly passwords: Pick<PasswordHasher, 'hash'>;
  readonly breached: Pick<BreachedPasswords, 'has'>;
  readonly audit: Pick<AuditSink, 'record'>;
  readonly limiter: Pick<RateLimiter, 'charge'> | undefined;
  /** The email pseudonym of the budget key (`StaffSignIn.emailRef`). */
  readonly emailRef: (email: string) => string;
  readonly publicWebUrl: string | undefined;
  /** Encrypts the link on the mail's outbox row (item J); null without credentials keys. */
  readonly cipher: CredentialsCipher | null;
}

export class PasswordResets {
  readonly #deps: PasswordResetsDependencies;
  readonly #logger = new Logger('PasswordResets');

  constructor(deps: PasswordResetsDependencies) {
    this.#deps = deps;
  }

  /**
   * `requestPasswordReset`: resolves the same way for every email (`202`; identity and tenancy §8).
   * Budgets: 3 per email and 20 per address an hour (plan 2.11). A link goes out only to an enabled
   * user with an active membership who is not platform staff.
   */
  async request(input: { email: string }, facts: RequestFacts): Promise<void> {
    const email = input.email.toLowerCase();
    await this.#deps.limiter?.charge('password_reset_email', this.#deps.emailRef(email));
    await this.#deps.limiter?.charge(
      'password_reset_ip',
      `ip:${addressKey(facts.ip ?? undefined)}`,
    );
    const store = this.#store();
    const token = opaqueToken();
    const link = mailLink(this.#deps.publicWebUrl, 'password-reset', token);
    await store.run(async (tx) => {
      const user = await tx.users.findByEmail(email);
      if (user === undefined || user.disabled || user.email === null) return;
      const staff = await tx.platformStaff.find(user.id);
      if (staff !== undefined && !staff.revoked) return;
      if ((await tx.memberships.signInMemberships(user.id)).length === 0) return;
      const resetId = uuidv7();
      await tx.resets.replace({
        id: resetId,
        userId: user.id,
        tokenHash: tokenHash(token),
        ttlSeconds: resetTtlSeconds,
      });
      await enqueueMail(
        this.#deps.outbox,
        tx,
        {
          type: 'core.password_reset.requested',
          aggregate: { type: 'password_reset', id: resetId },
          template: 'password_reset',
          to: user.email,
          locale: user.locale,
          params: { link },
          supersedeKey: `password_reset:${user.id}`,
        },
        this.#deps.cipher,
      );
      this.#logger.log(`password reset mailed user_id=${user.id}`);
    });
  }

  /**
   * `confirmPasswordReset`: a live, unused token sets the password (the rules of 2.2), marks the
   * token used, moves `token_version`, revokes every refresh family (`password_reset`) and is
   * audited `core.auth.password_reset`.
   */
  async confirm(input: { token: string; password: string }, facts: RequestFacts): Promise<void> {
    await this.#deps.limiter?.charge('auth_token_ip', `ip:${addressKey(facts.ip ?? undefined)}`);
    const problem = passwordProblem(input.password, this.#deps.breached);
    if (problem !== undefined) throw passwordRefusal('password', problem);
    if (!isOpaqueToken(input.token)) throw new ApiException('token_invalid');
    const passwordHash = await this.#deps.passwords.hash(input.password);
    await this.#store().run(async (tx) => {
      const reset = await tx.resets.lockByHash(tokenHash(input.token));
      if (reset === undefined || reset.used) throw new ApiException('token_invalid');
      if (reset.expired) throw new ApiException('token_expired');
      const user = await tx.users.lock(reset.userId);
      if (user === undefined || user.disabled) throw new ApiException('token_invalid');
      await tx.users.setPassword(user.id, passwordHash, { endSessions: true });
      await tx.resets.use(reset.id);
      const families = await tx.refreshTokens.revokeAll(user.id, 'password_reset');
      countRevocations('password_reset', families.length);
      await this.#deps.audit.record({
        actorType: 'user',
        actorId: user.id,
        accountId: null,
        targetType: 'user',
        targetId: user.id,
        action: 'core.auth.password_reset',
        after: { sessions_ended: families.length },
        requestId: facts.requestId,
        clientRequestId: facts.clientRequestId,
        ip: facts.ip,
        userAgent: facts.userAgent,
      });
    });
  }

  #store(): IdentityStore {
    const store = this.#deps.store;
    if (store === null) throw new ApiException('internal_error');
    return store;
  }
}
