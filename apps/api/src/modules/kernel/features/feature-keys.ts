// The feature-key registry (PLAT-13 plan 2.5, §7 #1; ADR-0006; domain model §2.4): the modules a
// rollout mode and a per-account flag govern. Wave 0 knows `delivery` and `wms`; the order that
// ships a module (`channels`, `api_keys`, `webhooks`, …) appends its key here and seeds its
// `core_rollout_modes` row in its own migration (as 0016 seeds these two; the rollout table test
// fails when the registry and the seeded rows differ). The web never reads this list: it gets the
// visible keys from `Me.features`.

export const featureKeys = ['delivery', 'wms'] as const;
export type FeatureKey = (typeof featureKeys)[number];

const known: ReadonlySet<string> = new Set(featureKeys);

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === 'string' && known.has(value);
}
