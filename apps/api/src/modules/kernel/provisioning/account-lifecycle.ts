import type { DomainEventType } from '../outbox/domain-event.js';
import type { AccountStatus } from '../schema/accounts.js';

// The platform's account transitions (PLAT-13 plan 2.7; domain model §2.1 K-2, lifecycle
// `provisioned → active ⇄ suspended → closed`; identity and tenancy §6). `provisioned → active` is
// the owner's acceptance (2.3, `account-activation.ts`), never a platform door; the three doors
// below move an account only from the one state each names, and any other state answers
// `409 invalid_transition` with the current status and version (errors.md).

export type LifecycleAction = 'suspend' | 'reactivate' | 'close';

export interface LifecycleTransition {
  readonly from: AccountStatus;
  readonly to: AccountStatus;
  /** The audit action and the outbox event type (domain model §6.3). */
  readonly event: Extract<
    DomainEventType,
    'core.account.suspended' | 'core.account.reactivated' | 'core.account.closed'
  >;
}

export const lifecycleTransitions: Readonly<Record<LifecycleAction, LifecycleTransition>> =
  Object.freeze({
    suspend: { from: 'active', to: 'suspended', event: 'core.account.suspended' },
    reactivate: { from: 'suspended', to: 'active', event: 'core.account.reactivated' },
    close: { from: 'suspended', to: 'closed', event: 'core.account.closed' },
  });

/** The transition `action` makes from `current`, or undefined when the arrow does not exist. */
export function lifecycleTransition(
  action: LifecycleAction,
  current: AccountStatus,
): LifecycleTransition | undefined {
  const transition = lifecycleTransitions[action];
  return transition.from === current ? transition : undefined;
}
