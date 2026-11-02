import type {
  CoverageCheck as CoverageCheckAnswer,
  ListCoverage200,
  SiteCoverage,
} from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { getContext } from '@eeasy-logistics/db';
import { Controller, Get, HttpCode, Inject, Optional, Post, Put } from '@nestjs/common';
import type {
  AuditSink,
  ContractInput,
  GeocoderService,
  ListSorts,
  RequestFacts,
} from '../../kernel/public/index.js';
import {
  ApiException,
  AUDIT_SINK,
  AuthRequest,
  CURSOR_CODEC,
  CursorCodec,
  GEOCODER,
  Idempotent,
  Input,
  Operation,
  planListPage,
  presentPage,
  SiteScoped,
  siteFilter,
  Feature,
} from '../../kernel/public/index.js';
import { delCoverage } from '../../kernel/public/index.js';
import { CoverageCheck } from './coverage-check.js';
import type { CoverageSortField } from './coverage.repository.js';
import { CoverageService } from './coverage.service.js';
import { maxZonesPerAccount } from './zone-input.js';
import { presentCoverage } from './zones.presenter.js';

// The staff surface's `coverage` tag (DEL-1 plan 2.4): `listCoverage` (`delivery.zones.read`, the
// principal's site scope) and `replaceSiteCoverage` (`delivery.coverage.manage`, `@SiteScoped()`),
// and `checkCoverage` (`delivery.orders.read`, plan 2.5: a read-only computation, no
// `Idempotency-Key`), enforced by PLAT-10's guard. The account is the token's.

const listOp = operationSchemas.listCoverage;
const replaceOp = operationSchemas.replaceSiteCoverage;
const checkOp = operationSchemas.checkCoverage;

const coverageSorts: ListSorts<CoverageSortField> = {
  fields: { created_at: 'timestamp' },
  default: '-created_at',
};

// The `delivery` module's feature gate (DEL-1 plan 2.9; ADR-0006): `403 feature_not_enabled`
// for an account the module is not visible to (K-6).
@Feature('delivery')
@Controller('v1/staff')
export class CoverageController {
  private readonly cursors: CursorCodec;
  private readonly coverage: CoverageService;
  private readonly checks: CoverageCheck;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    @Inject(GEOCODER) geocoder: GeocoderService,
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    this.coverage = new CoverageService({ audit });
    this.checks = new CoverageCheck(geocoder);
  }

  @Get('coverage')
  @SiteScoped({ from: 'query', name: 'site_id' })
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<ListCoverage200> {
    const { query } = input;
    const context = getContext();
    const plan = planListPage(this.cursors, {
      operation: 'listCoverage',
      reader: `account:${context.accountId}`,
      filters: { site_id: query.site_id },
      sorts: coverageSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = await this.coverage.list({
      plan,
      siteId: query.site_id,
      scope: siteFilter(context, delCoverage.siteId),
    });
    return presentPage(page, presentCoverage);
  }

  /** The site's zones become the body's set (plan 2.4); duplicates collapse. */
  @Put('sites/:site_id/coverage')
  @SiteScoped()
  @HttpCode(200)
  @Idempotent()
  @Operation(replaceOp)
  async replace(
    @Input() input: ContractInput<typeof replaceOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<SiteCoverage> {
    const zoneIds = input.body.zone_ids;
    if (zoneIds.length > maxZonesPerAccount) {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/body/zone_ids', code: 'too_long' }],
      });
    }
    const [stored] = await this.coverage.replace(
      [{ siteId: input.params.site_id, zoneIds }],
      'field',
      facts,
    );
    if (stored === undefined) throw new Error('The coverage replacement answered no set');
    return { site_id: stored.siteId, zone_ids: stored.zoneIds };
  }

  /**
   * Which zone covers a point or an address, and from which sites (plan 2.5); `point` wins when
   * both are sent, `site_id` limits the answer to that site's coverage.
   */
  @Post('coverage/check')
  @HttpCode(200)
  @Operation(checkOp)
  async check(@Input() input: ContractInput<typeof checkOp>): Promise<CoverageCheckAnswer> {
    const result = await this.checks.check(input.body);
    return {
      covered: result.siteIds.length > 0,
      zone_id: result.zoneId,
      site_ids: [...result.siteIds],
      ...(result.point === null ? {} : { point: result.point }),
    };
  }
}
