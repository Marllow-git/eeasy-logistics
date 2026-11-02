import type { ListSites200, Site } from '@eeasy-logistics/contracts/staff/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { getContext } from '@eeasy-logistics/db';
import { Controller, Get, HttpCode, Inject, Optional, Patch, Post } from '@nestjs/common';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import type { AuditSink } from '../audit/audit-sink.js';
import type { RequestFacts } from '../auth/request-facts.js';
import { AuthRequest } from '../auth/request-facts.js';
import { SiteScoped } from '../authz/site-scope.js';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation } from '../contract/contract-pipe.js';
import type { ListSorts } from '../contract/list-page.js';
import {
  CURSOR_CODEC,
  CursorCodec,
  enumListFilter,
  planListPage,
  presentPage,
} from '../contract/list-page.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { OutboxWriter } from '../outbox/outbox-writer.js';
import { accountStoreOnPool } from '../platform/accounts.repository.js';
import { PLATFORM_POOL } from '../platform/tokens.js';
import { siteStatuses } from '../schema/sites.js';
import { SiteUseChecks } from './site-use.js';
import type { SiteSortField } from './sites.repository.js';
import { presentSite } from './sites.presenter.js';
import { SitesService } from './sites.service.js';

// The staff surface's `sites` tag (PLAT-12 plan 2.4, 2.5, 2.6, 2.11): `listSites`, `createSite`,
// `getSite`, `updateSite`, `deactivateSite`, `activateSite`. The account is the token's; a site of
// another account, or outside a site-scoped principal's `site_ids`, is `404` (`@SiteScoped()` on
// the doors that name one, `siteFilter` on the list). `x-permission` (`core.sites.read`,
// `core.sites.manage`) is enforced by PLAT-10's guard.

const listOp = operationSchemas.listSites;
const createOp = operationSchemas.createSite;
const getOp = operationSchemas.getSite;
const updateOp = operationSchemas.updateSite;
const deactivateOp = operationSchemas.deactivateSite;
const activateOp = operationSchemas.activateSite;

const siteSorts: ListSorts<SiteSortField> = {
  fields: { created_at: 'timestamp', name_ar: 'text', name_en: 'text', status: 'text' },
  default: '-created_at',
};

@Controller('v1/staff/sites')
export class SitesController {
  private readonly cursors: CursorCodec;
  private readonly sites: SitesService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    outbox: OutboxWriter,
    checks: SiteUseChecks,
    @Optional() @Inject(PLATFORM_POOL) pool?: Parameters<typeof accountStoreOnPool>[0],
    @Optional() @Inject(CURSOR_CODEC) cursors?: CursorCodec,
  ) {
    this.cursors = cursors ?? new CursorCodec(undefined);
    this.sites = new SitesService({
      checks,
      accounts: accountStoreOnPool(pool ?? null),
      audit,
      outbox,
    });
  }

  @Get()
  @Operation(listOp)
  async list(@Input() input: ContractInput<typeof listOp>): Promise<ListSites200> {
    const { query } = input;
    // Filters are checked before the cursor, so a bad one answers on its own pointer.
    const statuses = enumListFilter(query.status, siteStatuses, '/query/status');
    const plan = planListPage(this.cursors, {
      operation: 'listSites',
      reader: `account:${getContext().accountId}`,
      filters: { status: query.status, kind: query.kind },
      sorts: siteSorts,
      sort: query.sort,
      cursor: query.cursor,
      limit: query.limit,
    });
    const page = await this.sites.list({ plan, statuses, kind: query.kind });
    return presentPage(page, presentSite);
  }

  @Post()
  @HttpCode(201)
  @Idempotent()
  @Operation(createOp)
  async create(
    @Input() input: ContractInput<typeof createOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Site> {
    return presentSite(await this.sites.create(input.body, facts));
  }

  @Get(':site_id')
  @SiteScoped()
  @Operation(getOp)
  async get(@Input() input: ContractInput<typeof getOp>): Promise<Site> {
    return presentSite(await this.sites.get(input.params.site_id));
  }

  /** The whole site (plan 2.5): an optional field left out of the body is cleared. */
  @Patch(':site_id')
  @SiteScoped()
  @HttpCode(200)
  @Idempotent()
  @Operation(updateOp)
  async update(
    @Input() input: ContractInput<typeof updateOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Site> {
    return presentSite(await this.sites.update(input.params.site_id, input.body, facts));
  }

  @Post(':site_id/deactivate')
  @SiteScoped()
  @HttpCode(200)
  @Idempotent()
  @Operation(deactivateOp)
  async deactivate(
    @Input() input: ContractInput<typeof deactivateOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Site> {
    return presentSite(await this.sites.deactivate(input.params.site_id, facts));
  }

  @Post(':site_id/activate')
  @SiteScoped()
  @HttpCode(200)
  @Idempotent()
  @Operation(activateOp)
  async activate(
    @Input() input: ContractInput<typeof activateOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<Site> {
    return presentSite(await this.sites.activate(input.params.site_id, facts));
  }
}
