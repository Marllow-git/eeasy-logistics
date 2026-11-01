import type { ListAuditLog200 } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { getUnitOfWork } from '@eeasy-logistics/db';
import { Controller, Get, Inject, Optional } from '@nestjs/common';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation } from '../contract/contract-pipe.js';
import { presentStaffAuditPage } from './audit-log.presenter.js';
import { AuditLogRepository } from './audit-log.repository.js';
import { planAuditPage } from './audit-page.js';
import { CURSOR_CODEC, CursorCodec } from './cursor.js';

// `listAuditLog` (staff surface; PLAT-7 plan 2.7): the token's account's audit log, newest first,
// keyset pages (ADR-0029). The account comes only from the token, through the unit of work
// (ADR-0025); no parameter names one. `x-permission: core.audit.read` is enforced by PLAT-10.

const operation = operationSchemas.listAuditLog;

@Controller('v1/staff/audit-log')
export class AuditLogController {
  private readonly cursors: CursorCodec;

  constructor(@Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec) {
    this.cursors = cursors ?? new CursorCodec(undefined);
  }

  @Get()
  @Operation(operation)
  async list(@Input() input: ContractInput<typeof operation>): Promise<ListAuditLog200> {
    const { query } = input;
    const plan = planAuditPage(this.cursors, {
      operation: 'listAuditLog',
      filters: {
        target_type: query.target_type,
        target_id: query.target_id,
        actor_id: query.actor_id,
        created_from: query.created_from,
        created_to: query.created_to,
      },
      repositoryFilters: {
        targetType: query.target_type,
        targetId: query.target_id,
        actorId: query.actor_id,
        from: query.created_from,
        to: query.created_to,
      },
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const rows = await new AuditLogRepository(getUnitOfWork()).page(plan.query);
    return presentStaffAuditPage(plan.page(rows));
  }
}
