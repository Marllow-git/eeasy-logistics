// Fixture: the kernel audit folder is the one place that may open a committed side effect
// (rule committed-side-effects-only-in-audit, PLAT-7 plan 2.4).
import type { withCommittedSideEffect } from '@eeasy-logistics/db/committed';

export type CommittedWriter = typeof withCommittedSideEffect;
