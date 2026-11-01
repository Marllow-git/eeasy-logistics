// Violation: a bounded context opening a transaction committed regardless of its request
// (rule committed-side-effects-only-in-audit, PLAT-7 plan 2.4).
import { withCommittedSideEffect } from '@eeasy-logistics/db/committed';

export const sideEffect = withCommittedSideEffect;
