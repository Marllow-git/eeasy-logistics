import type { RolloutModeValue } from '../schema/rollout.js';
import type { FeatureKey } from './feature-keys.js';
import { featureKeys } from './feature-keys.js';

// K-6 (domain model §2.4; ADR-0006; identity and tenancy §6; PLAT-13 plan 2.5): a feature is
// visible to an account iff its rollout mode is `all`, or it is `allowlist` and the account's flag
// is `enabled` with `provisioned_by` set to a platform user. `off` hides it from everyone, flag or
// not. A key with no rollout row reads as `allowlist` (the column default; the migration seeds a
// row per registered key).

/** One account's flag of one key, as the tables hold it. */
export interface FlagState {
  readonly enabled: boolean;
  readonly provisionedBy: string | null;
}

/** Whether the flag counts under `allowlist`: enabled, by a platform user (the CHECK backs it). */
export function flagGrants(flag: FlagState | undefined): boolean {
  return flag !== undefined && flag.enabled && flag.provisionedBy !== null;
}

/** K-6 for one key. */
export function featureVisible(
  mode: RolloutModeValue | undefined,
  flag: FlagState | undefined,
): boolean {
  const effective = mode ?? 'allowlist';
  if (effective === 'all') return true;
  if (effective === 'off') return false;
  return flagGrants(flag);
}

/** The registered keys visible to an account, in registry order (`Me.features`). */
export function visibleFeatures(
  modes: ReadonlyMap<string, RolloutModeValue>,
  flags: ReadonlyMap<string, FlagState>,
): FeatureKey[] {
  return featureKeys.filter((key) => featureVisible(modes.get(key), flags.get(key)));
}
