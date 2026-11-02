import type { UnitOfWork } from '@eeasy-logistics/db';
import type { SiteKind } from '../schema/sites.js';

// What keeps a site in use (PLAT-12 plan 2.6; domain model K-4, K-5). A site serves as a branch
// (dispatch, coverage, cash custody) when its kind is `branch` or `both`, and as a warehouse (WMS
// locations, stock) when it is `warehouse` or `both`. The contexts that hang work off a site
// register a check for the role they use: DEL-2 open orders and DEL-8 unsettled cash on `branch`,
// WMS-2 stock on hand on `warehouse`. A check answers a reason (`open_orders`, ...) or nothing.
// Deactivating a site runs the checks of every role it serves; changing its kind runs those of the
// roles it stops serving. In wave 0 nothing is registered, so every deactivation and kind change
// passes. Membership `site_ids` are no reason: an inactive site stays assignable.

/** The role of a site a check protects. */
export type SiteRole = 'branch' | 'warehouse';

/**
 * One in-use check: the reason `siteId` cannot stop serving its role, or undefined. It runs in the
 * site door's tenant unit of work (the account of the context), so it reads with the same
 * repositories and sees the same transaction.
 */
export type SiteUseCheck = (siteId: string, uow: UnitOfWork) => Promise<string | undefined>;

/** The roles a site of `kind` serves. */
export function siteRoles(kind: SiteKind): readonly SiteRole[] {
  if (kind === 'both') return ['branch', 'warehouse'];
  return [kind];
}

/** The roles a site stops serving when its kind goes from `from` to `to`. */
export function droppedRoles(from: SiteKind, to: SiteKind): readonly SiteRole[] {
  const kept = new Set(siteRoles(to));
  return siteRoles(from).filter((role) => !kept.has(role));
}

/** The registry the site doors read; one per application, filled at module init. */
export class SiteUseChecks {
  readonly #checks = new Map<SiteRole, SiteUseCheck[]>();

  register(role: SiteRole, check: SiteUseCheck): void {
    const checks = this.#checks.get(role) ?? [];
    checks.push(check);
    this.#checks.set(role, checks);
  }

  /** Every reason the registered checks of `roles` give for `siteId`, in registration order. */
  async reasons(siteId: string, roles: readonly SiteRole[], uow: UnitOfWork): Promise<string[]> {
    const reasons: string[] = [];
    for (const role of roles) {
      for (const check of this.#checks.get(role) ?? []) {
        const reason = await check(siteId, uow);
        if (reason !== undefined && !reasons.includes(reason)) reasons.push(reason);
      }
    }
    return reasons;
  }
}
