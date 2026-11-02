import type { UnitOfWork } from '@eeasy-logistics/db';
import type { OnModuleInit } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { SiteUseChecks } from '../../kernel/public/index.js';
import { terminalStatuses } from './order-machine.js';
import { OrdersRepository } from './orders.repository.js';

// PLAT-12's site-in-use registry (domain model K-5; DEL-2 plan 8.3, lead ruling on leg 1): a
// branch with an order that is not terminal (`failed` included: its parcel still comes back to
// the site) cannot be deactivated or stop being a branch; `site_in_use` names `open_orders`. The
// order create holds the site lock shared (`holdSites`), so the check sees every committed order.

/** The reason a branch with open orders is kept in use. */
export const openOrdersReason = 'open_orders';

export async function openOrdersCheck(
  siteId: string,
  uow: UnitOfWork,
): Promise<string | undefined> {
  const open = await new OrdersRepository(uow).hasOpenOn(siteId, [...terminalStatuses]);
  return open ? openOrdersReason : undefined;
}

@Injectable()
export class OrderSiteUse implements OnModuleInit {
  constructor(private readonly checks: SiteUseChecks) {}

  onModuleInit(): void {
    this.checks.register('branch', openOrdersCheck);
  }
}
