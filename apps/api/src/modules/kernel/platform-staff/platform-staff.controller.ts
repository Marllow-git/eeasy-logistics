import type {
  PlatformListStaffUsers200,
  PlatformRole,
  PlatformUser,
} from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import { findPlatformContext } from '@eeasy-logistics/db';
import { Controller, Get, HttpCode, Inject, Optional, Post, Put } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import { Invitations } from '../auth/invitations.js';
import type { RequestFacts } from '../auth/request-facts.js';
import { AuthRequest } from '../auth/request-facts.js';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation } from '../contract/contract-pipe.js';
import type { ListSorts } from '../contract/list-page.js';
import { CURSOR_CODEC, CursorCodec, planListPage, presentPage } from '../contract/list-page.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { OutboxWriter } from '../outbox/outbox-writer.js';
import type { StaffSortField } from '../platform/platform-staff.repository.js';
import type { PlatformStaffRole } from '../schema/identity.js';
import type { StaffView } from './platform-staff.service.js';
import { PlatformStaffService } from './platform-staff.service.js';
import { contractRoles } from './staff-rules.js';

// The platform surface's `staff` tag (PLAT-13 plan 2.9; identity and tenancy §3.3): list, invite,
// set roles, reset a TOTP. Platform work on the request's platform unit of work (no account, no
// door); `platform.staff.manage` (super admins by roles.yaml) is PLAT-10's guard, and the service
// re-checks the caller's stored role for the super-admin rules. Registered by `AuthModule`, whose
// `Invitations` the invitation is delegated to.

const listOp = operationSchemas.platformListStaffUsers;
const inviteOp = operationSchemas.platformInviteStaff;
const rolesOp = operationSchemas.platformSetStaffRoles;
const resetOp = operationSchemas.platformResetStaffTotp;

const staffSorts: ListSorts<StaffSortField> = {
  fields: { created_at: 'timestamp', name: 'text' },
  default: '-created_at',
};

function presentStaff(view: StaffView): PlatformUser {
  return {
    id: view.userId,
    created_at: view.createdAt.toISOString(),
    updated_at: view.updatedAt.toISOString(),
    name: view.name,
    email: view.email,
    phone: view.phone,
    locale: view.locale,
    second_factor_enabled: view.secondFactorEnabled,
    roles: view.roles as PlatformRole[],
    totp_enrolled: view.totpEnrolled,
  };
}

/** The stored roles a contract `roles` list names (the enum is closed, so every value maps). */
function storedRoles(roles: readonly PlatformRole[] | undefined): PlatformStaffRole[] {
  return (roles ?? []).map((role) => {
    const stored = contractRoles[role];
    if (stored === undefined) throw new Error(`Unknown platform role ${role}`);
    return stored;
  });
}

@Controller('v1/platform/staff-users')
export class PlatformStaffController {
  private readonly cursors: CursorCodec;
  private readonly staff: PlatformStaffService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    outbox: OutboxWriter,
    invitations: Invitations,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    this.staff = new PlatformStaffService({ invitations, audit, outbox });
  }

  @Get()
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<PlatformListStaffUsers200> {
    const { query } = input;
    const plan = planListPage(this.cursors, {
      operation: 'platformListStaffUsers',
      reader: `platform:${findPlatformContext()?.userId ?? ''}`,
      filters: {},
      sorts: staffSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    return presentPage(await this.staff.list(plan), presentStaff);
  }

  @Post('invitations')
  @HttpCode(201)
  @Idempotent()
  @Operation(inviteOp)
  async invite(
    @Input() input: ContractInput<typeof inviteOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<PlatformUser> {
    const { email, name, roles } = input.body;
    return presentStaff(await this.staff.invite({ email, name, roles: storedRoles(roles) }, facts));
  }

  @Put(':user_id/roles')
  @HttpCode(200)
  @Idempotent()
  @Operation(rolesOp)
  async setRoles(
    @Input() input: ContractInput<typeof rolesOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<PlatformUser> {
    const view = await this.staff.setRoles(
      input.params.user_id,
      storedRoles(input.body.roles),
      facts,
    );
    return presentStaff(view);
  }

  @Post(':user_id/totp/reset')
  @HttpCode(204)
  @Idempotent()
  @Operation(resetOp)
  async resetTotp(
    @Input() input: ContractInput<typeof resetOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<void> {
    await this.staff.resetTotp(input.params.user_id, input.body.reason, facts);
  }
}
