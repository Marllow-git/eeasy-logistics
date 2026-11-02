import type { UnitOfWork } from '@eeasy-logistics/db';
import type { DomainEvent, DomainEventConsumer } from '../../kernel/public/index.js';
import { OnDomainEvent } from '../../kernel/public/index.js';
import type { SystemShiftDependencies } from './shift-system.js';
import { ShiftsService } from './shifts.service.js';

/**
 * Ends every live shift of a suspended account by the system (DEL-5 plan 2.5; PLAT-13 plan 8.2
 * #35): `delivery.shift.ended` with `ended_by: system` and `reason: account_suspended`, plus an
 * audit row each, in the event's tenant unit of work on elx_app (its receipt commits with the
 * shifts, so a failure retries the whole account). Driver sessions are left to the refresh door's
 * `403 account_suspended` (driver app §7.3 keeps a read-only session).
 */
@OnDomainEvent('core.account.suspended')
export class SuspendedAccountShiftsConsumer implements DomainEventConsumer {
  /** Stable: names the receipts and dead letters. */
  readonly consumer = 'delivery.account_suspended_shifts';

  constructor(private readonly deps: SystemShiftDependencies) {}

  async handle(event: DomainEvent, uow?: UnitOfWork): Promise<void> {
    if (uow === undefined) return; // a platform-only event has no account, so no shifts
    await new ShiftsService(this.deps).endAllBySystem('account_suspended', event.id);
  }
}

/** Delivery's internal consumers in this build (the worker's registry). */
export function deliveryConsumers(deps: SystemShiftDependencies): DomainEventConsumer[] {
  return [new SuspendedAccountShiftsConsumer(deps)];
}
