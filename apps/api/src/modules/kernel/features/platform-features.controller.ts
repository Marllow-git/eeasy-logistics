import type {
  FeatureFlag,
  FeatureFlagList,
  RolloutMode,
  RolloutModeList,
} from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas } from '@eeasy-logistics/contracts/platform/schemas';
import { Controller, Get, HttpCode, Inject, Optional, Put } from '@nestjs/common';
import type { AuditSink } from '../audit/audit-sink.js';
import { AUDIT_SINK } from '../audit/audit-sink.js';
import type { RequestFacts } from '../auth/request-facts.js';
import { AuthRequest } from '../auth/request-facts.js';
import type { ContractInput } from '../contract/contract-pipe.js';
import { Input, Operation } from '../contract/contract-pipe.js';
import { Idempotent } from '../idempotency/idempotency.interceptor.js';
import { OutboxWriter } from '../outbox/outbox-writer.js';
import { CrossTenant, accountIdParam, optionalReason } from '../tenancy/cross-tenant.js';
import { FEATURE_RESOLVER } from './feature-gate.js';
import type { FeatureResolver } from './feature-resolver.js';
import type { FlagView, RolloutView } from './features.service.js';
import { FeaturesService } from './features.service.js';

// The platform surface's `rollout` tag (PLAT-13 plan 2.6; ADR-0006; K-6): the rollout modes
// (platform rows; setting one is `platform.rollout.manage`, super admins only by roles.yaml, and a
// holder of `platform.flags.manage` alone is answered `rollout_change_forbidden` by the permission
// guard) and an account's feature flags through the account's cross-tenant door (the flag change
// carries its reason in the body; the list takes an optional `X-Support-Reason`, lead ruling on
// 8.2 #8).

const listModesOp = operationSchemas.platformListRolloutModes;
const setModeOp = operationSchemas.platformSetRolloutMode;
const listFlagsOp = operationSchemas.platformListFeatureFlags;
const setFlagOp = operationSchemas.platformSetFeatureFlag;

function presentRolloutMode(view: RolloutView): RolloutMode {
  return {
    feature_key: view.featureKey,
    mode: view.mode,
    ...(view.updatedBy === null ? {} : { updated_by: view.updatedBy }),
    ...(view.updatedAt === null ? {} : { updated_at: view.updatedAt.toISOString() }),
  };
}

function presentFeatureFlag(view: FlagView): FeatureFlag {
  return {
    feature_key: view.featureKey,
    enabled: view.enabled,
    provisioned_by: view.provisionedBy,
    enabled_at: view.enabledAt?.toISOString() ?? null,
  };
}

@Controller('v1/platform')
export class PlatformFeaturesController {
  private readonly features: FeaturesService;

  constructor(
    @Inject(AUDIT_SINK) audit: AuditSink,
    outbox: OutboxWriter,
    @Optional() @Inject(FEATURE_RESOLVER) resolver?: FeatureResolver | null,
  ) {
    this.features = new FeaturesService({ audit, outbox, resolver: resolver ?? null });
  }

  @Get('rollout-modes')
  @Operation(listModesOp)
  async listModes(@Input() _input: ContractInput<typeof listModesOp>): Promise<RolloutModeList> {
    return { data: (await this.features.rolloutModes()).map(presentRolloutMode) };
  }

  @Put('rollout-modes/:feature_key')
  @HttpCode(200)
  @Idempotent()
  @Operation(setModeOp)
  async setMode(
    @Input() input: ContractInput<typeof setModeOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<RolloutMode> {
    const { mode, reason } = input.body;
    return presentRolloutMode(
      await this.features.setRolloutMode(input.params.feature_key, mode, reason, facts),
    );
  }

  @Get('accounts/:account_id/feature-flags')
  @CrossTenant(optionalReason)
  @Operation(listFlagsOp)
  async listFlags(@Input() _input: ContractInput<typeof listFlagsOp>): Promise<FeatureFlagList> {
    return { data: (await this.features.flags()).map(presentFeatureFlag) };
  }

  @Put('accounts/:account_id/feature-flags/:feature_key')
  @HttpCode(200)
  @CrossTenant({ from: 'path', name: accountIdParam, reason: 'body' })
  @Idempotent()
  @Operation(setFlagOp)
  async setFlag(
    @Input() input: ContractInput<typeof setFlagOp>,
    @AuthRequest() facts: RequestFacts,
  ): Promise<FeatureFlag> {
    const { enabled, reason } = input.body;
    return presentFeatureFlag(
      await this.features.setFlag(input.params.feature_key, enabled, reason, facts),
    );
  }
}
