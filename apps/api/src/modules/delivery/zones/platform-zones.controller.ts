import type { CoverageList, Zone } from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import { Controller, HttpCode, Inject, Post, Put } from '@nestjs/common';
import type { AuditSink, ContractInput, RequestFacts } from '../../kernel/public/index.js';
import {
  ApiException,
  AUDIT_SINK,
  assertProvisionable,
  AuthRequest,
  CrossTenant,
  Idempotent,
  Input,
  Operation,
  optionalReason,
} from '../../kernel/public/index.js';
import { CoverageService } from './coverage.service.js';
import { maxZonesPerAccount } from './zone-input.js';
import { presentCoverage, presentZone } from './zones.presenter.js';
import { ZonesService } from './zones.service.js';

// The platform surface's provisioning doors of Delivery (DEL-1 plan 2.6; ADR-0015: coverage is
// explicit data created with the account): `platformProvisionZone` and
// `platformProvisionCoverage` (`platform.accounts.provision`), through the cross-tenant door with
// an optional `X-Support-Reason` (the contract declares none, PLAT-13 8.2 #8), so each call leaves
// the door's `platform.cross_tenant.accessed` row. The door's unit of work runs on the platform
// pool with `elx.account_id` set to the path account (PLAT-6); the zone and coverage writes go
// there, as the staff doors' rules have them, with the platform user as the audit actor. A closed
// account is `409 invalid_transition`; the kernel's `platformProvisionSite` completes the trio.

const zoneOp = operationSchemas.platformProvisionZone;
const coverageOp = operationSchemas.platformProvisionCoverage;

/** At most this many sites in one coverage call (well above any account's site limit). */
export const maxCoverageEntries = 100;

@Controller('v1/platform/accounts')
export class PlatformZonesController {
  private readonly zones: ZonesService;
  private readonly coverage: CoverageService;

  constructor(@Inject(AUDIT_SINK) audit: AuditSink) {
    this.zones = new ZonesService({ audit });
    this.coverage = new CoverageService({ audit });
  }

  @Post(':account_id/zones')
  @HttpCode(201)
  @CrossTenant(optionalReason)
  @Idempotent()
  @Operation(zoneOp)
  async provisionZone(
    @Input() input: ContractInput<typeof zoneOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Zone> {
    await assertProvisionable();
    return presentZone(await this.zones.create(input.body, facts));
  }

  /**
   * Each entry replaces that site's set (plan 2.6), all in the door's one transaction; every site
   * and zone must be the account's (`404`, the contract). Answers the account's coverage rows.
   */
  @Put(':account_id/coverage')
  @HttpCode(200)
  @CrossTenant(optionalReason)
  @Idempotent()
  @Operation(coverageOp)
  async provisionCoverage(
    @Input() input: ContractInput<typeof coverageOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<CoverageList> {
    const { entries } = input.body;
    const tooLong = [
      ...(entries.length > maxCoverageEntries ? ['/body/entries'] : []),
      ...entries.flatMap((entry, i) =>
        entry.zone_ids.length > maxZonesPerAccount ? [`/body/entries/${i}/zone_ids`] : [],
      ),
    ];
    if (tooLong.length > 0) {
      throw new ApiException('validation_failed', {
        fields: tooLong.map((pointer) => ({ pointer, code: 'too_long' as const })),
      });
    }
    await assertProvisionable();
    await this.coverage.replace(
      entries.map((entry) => ({ siteId: entry.site_id, zoneIds: entry.zone_ids })),
      'not_found',
      facts,
    );
    return { data: (await this.coverage.all()).map(presentCoverage) };
  }
}
