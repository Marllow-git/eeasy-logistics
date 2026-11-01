import type { CredentialsCipher } from '@eeasy-logistics/config';
import { uuidv7 } from '@eeasy-logistics/db';
import { Logger } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import { ApiException } from '../errors/api-exception.js';
import type { OutboxWriter } from '../outbox/outbox-writer.js';
import type { IdentityStore } from '../platform/identity.repository.js';
import { countRevocations } from './auth-metrics.js';
import { enqueueMail, mailLink } from './mail-links.js';
import { enrolmentLinkTtlSeconds } from './second-factor.js';
import { compoundToken, opaqueToken, tokenHash } from './tokens.js';

// Second-factor resets (PLAT-11 plan 2.8; staff.yaml `resetMemberSecondFactor`, `redeemEnrolmentLink`):
// PLAT-12's member door calls `issueLink` after its own checks (owner or admin, not on oneself, the
// reason audited there). The identity tables are on the platform pool only, so the reset itself
// happens here, in one platform transaction: the factor stops being asked for (its phone stays as
// the marker that only an emailed link may enrol again), `token_version` moves and every refresh
// family is revoked, earlier links are spent, and a one-time link valid 24 hours is mailed
// (`PUBLIC_WEB_URL/second-factor/enrol/<token>`, template `second_factor_reset`).

export interface SecondFactorLinkRequest {
  readonly userId: string;
  /** The member manager who reset the factor; null for a system reset. */
  readonly issuedBy: string | null;
  /** The account the reset was made in (the audit row's account). */
  readonly accountId: string | null;
  readonly requestId: string;
}

export interface IssuedLink {
  readonly challengeId: string;
  readonly expiresAt: Date;
}

export interface SecondFactorResetsDependencies {
  readonly store: IdentityStore | null;
  readonly outbox: Pick<OutboxWriter, 'enqueue'>;
  readonly audit: Pick<AuditSink, 'record'>;
  readonly publicWebUrl: string | undefined;
  /** Encrypts the link on the mail's outbox row (item J); null without credentials keys. */
  readonly cipher: CredentialsCipher | null;
}

export class SecondFactorResets {
  readonly #deps: SecondFactorResetsDependencies;
  readonly #logger = new Logger('SecondFactorResets');

  constructor(deps: SecondFactorResetsDependencies) {
    this.#deps = deps;
  }

  /**
   * Resets the user's second factor and mails the re-enrolment link. An unknown or disabled user,
   * or one without an email, is `404 not_found`.
   */
  async issueLink(input: SecondFactorLinkRequest): Promise<IssuedLink> {
    const store = this.#deps.store;
    if (store === null) throw new ApiException('internal_error');
    const id = uuidv7();
    const secret = opaqueToken();
    const link = mailLink(
      this.#deps.publicWebUrl,
      'second-factor/enrol',
      compoundToken(id, secret),
    );
    const issued = await store.run(async (tx) => {
      const user = await tx.users.lock(input.userId);
      if (user === undefined || user.disabled || user.email === null) {
        throw new ApiException('not_found');
      }
      await tx.users.resetSecondFactor(user.id);
      const families = await tx.refreshTokens.revokeAll(user.id, 'revoked');
      countRevocations('revoked', families.length);
      await tx.challenges.consumeOpen(user.id, 'enrolment_link');
      const expiresAt = await tx.challenges.insert({
        id,
        kind: 'enrolment_link',
        userId: user.id,
        secretHash: tokenHash(secret),
        amr: [],
        membershipIds: null,
        ttlSeconds: enrolmentLinkTtlSeconds,
        ip: null,
      });
      await enqueueMail(
        this.#deps.outbox,
        tx,
        {
          type: 'core.second_factor.reset',
          aggregate: { type: 'auth_challenge', id },
          template: 'second_factor_reset',
          to: user.email,
          locale: user.locale,
          params: { link },
          supersedeKey: `second_factor_reset:${user.id}`,
        },
        this.#deps.cipher,
      );
      await this.#deps.audit.record({
        actorType: input.issuedBy === null ? 'system' : 'user',
        actorId: input.issuedBy,
        accountId: input.accountId,
        targetType: 'user',
        targetId: user.id,
        action: 'core.auth.second_factor_reset',
        after: { sessions_ended: families.length, link_expires_at: expiresAt.toISOString() },
        requestId: input.requestId,
      });
      return { challengeId: id, expiresAt };
    });
    this.#logger.log(`second factor reset user_id=${input.userId}`);
    return issued;
  }
}
