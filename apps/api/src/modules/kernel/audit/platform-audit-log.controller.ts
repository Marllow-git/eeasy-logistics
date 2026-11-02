import type {
  PlatformListAccountAudit200,
  PlatformListAudit200,
} from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import { findPlatformContext, getContext, getUnitOfWork } from '@eeasy-logistics/db';
import { Controller, Get, Inject, Optional } from '@nestjs/common';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation } from '../contract/contract-pipe.js';
import { currentPlatformAuditLog } from '../platform/audit-log.repository.js';
import { CrossTenant, accountIdParam } from '../tenancy/cross-tenant.js';
import { presentPlatformAuditPage } from './audit-log.presenter.js';
import { CURSOR_CODEC, CursorCodec, planListPage } from '../contract/list-page.js';
import { auditKeyOf, auditListSorts, auditPageQuery } from './audit-log.query.js';
import { AuditLogRepository } from './audit-log.repository.js';

// The platform surface's audit reads (PLAT-7 plan 2.7). Account rows only through the cross-tenant
// door (`@CrossTenant()`, `X-Support-Reason`, one committed audit row per call); the platform's own
// rows (no account) without it. `x-permission` (`platform.tenants.read`, `platform.audit.read`) is
// enforced by PLAT-10.

/** The platform user of the request: the door's context, or the plain platform frame's. */
function platformUserId(doorAccount: string | undefined): string {
  const userId = doorAccount === undefined ? findPlatformContext()?.userId : getContext().userId;
  if (userId === undefined || userId === null) throw new Error('No platform user on this request');
  return userId;
}

const accountAudit = operationSchemas.platformListAccountAudit;
const platformAudit = operationSchemas.platformListAudit;

@Controller('v1/platform')
export class PlatformAuditLogController {
  private readonly cursors: CursorCodec;

  constructor(@Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec) {
    this.cursors = cursors ?? new CursorCodec(undefined);
  }

  /** `platformListAccountAudit`: one account's log through the door on `:account_id`. */
  @CrossTenant()
  @Get('accounts/:account_id/audit-log')
  @Operation(accountAudit)
  async listAccount(
    @Input() input: ContractInput<typeof accountAudit>,
  ): Promise<PlatformListAccountAudit200> {
    const { query } = input;
    const plan = planListPage(this.cursors, {
      operation: 'platformListAccountAudit',
      reader: `platform:${getContext().userId ?? ''}`,
      filters: {
        account_id: input.params.account_id,
        created_from: query.created_from,
        created_to: query.created_to,
      },
      sorts: auditListSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const rows = await new AuditLogRepository(getUnitOfWork()).page(
      auditPageQuery(plan, { from: query.created_from, to: query.created_to }),
    );
    return presentPlatformAuditPage(plan.page(rows, auditKeyOf));
  }

  /**
   * `platformListAudit`: with `account_id`, that account's log through the door, which takes the
   * account from this query parameter (the one declared exception, plan 2.7); without it, the
   * platform's own rows (no account), with no door.
   */
  @CrossTenant({ from: 'query', name: accountIdParam })
  @Get('audit-log')
  @Operation(platformAudit)
  async list(@Input() input: ContractInput<typeof platformAudit>): Promise<PlatformListAudit200> {
    const { query } = input;
    const plan = planListPage(this.cursors, {
      operation: 'platformListAudit',
      reader: `platform:${platformUserId(query.account_id)}`,
      filters: {
        account_id: query.account_id,
        actor_id: query.actor_id,
        action: query.action,
        created_from: query.created_from,
        created_to: query.created_to,
      },
      sorts: auditListSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = auditPageQuery(plan, {
      actorId: query.actor_id,
      action: query.action,
      from: query.created_from,
      to: query.created_to,
    });
    if (query.account_id === undefined) {
      const rows = await currentPlatformAuditLog().platformPage(page);
      return presentPlatformAuditPage(plan.page(rows, auditKeyOf));
    }
    // The door ran on the same parameter; a mismatch is a programming error, never a read.
    if (getContext().accountId !== query.account_id) throw new Error('Door and query disagree');
    const rows = await new AuditLogRepository(getUnitOfWork()).page(page);
    return presentPlatformAuditPage(plan.page(rows, auditKeyOf));
  }
}
