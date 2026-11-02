import type { AuditSink } from '../audit/audit-sink.js';
import type { RequestFacts } from '../auth/request-facts.js';
import type { IdentityTransaction } from '../platform/identity.repository.js';
import { ProvisionedAccounts } from '../platform/provisioning.repository.js';

// Account activation (PLAT-13 plan 2.3, §7 #5; domain model §2.1 `provisioned → active`): an
// account turns `active` when its owner first accepts the invitation, not when it is provisioned,
// so one whose owner never accepted stays visibly `provisioned` in the console.

/** The accepted membership as `acceptInvitation` holds it. */
export interface AcceptedMembership {
  readonly id: string;
  readonly accountId: string;
  readonly userId: string;
  readonly roles: readonly string[];
}

export const AccountActivation = {
  /**
   * The kernel hook of PLAT-11's `acceptInvitation`, in its identity transaction: when the accepted
   * membership holds `owner` and the account is still `provisioned`, the account becomes `active`
   * (`version + 1`) and `core.account.activated` is audited as the accepting user in the same
   * transaction. Any other acceptance, or an account in any other state, changes nothing.
   */
  async onOwnerAccepted(
    tx: IdentityTransaction,
    membership: AcceptedMembership,
    audit: Pick<AuditSink, 'record'>,
    facts: Pick<RequestFacts, 'requestId' | 'clientRequestId' | 'ip' | 'userAgent'>,
  ): Promise<boolean> {
    if (!membership.roles.includes('owner')) return false;
    const activated = await new ProvisionedAccounts(tx.uow).activateProvisioned(
      membership.accountId,
    );
    if (activated === undefined) return false;
    await audit.record({
      actorType: 'user',
      actorId: membership.userId,
      accountId: membership.accountId,
      targetType: 'account',
      targetId: membership.accountId,
      action: 'core.account.activated',
      before: { status: 'provisioned' },
      after: { status: 'active', membership_id: membership.id },
      requestId: facts.requestId,
      clientRequestId: facts.clientRequestId,
      ip: facts.ip,
      userAgent: facts.userAgent,
    });
    return true;
  },
};
