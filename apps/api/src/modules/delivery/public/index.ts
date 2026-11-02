// Delivery's public surface: ports, event payload types and DTOs other contexts may import (ADR-0026).
// DEL-4: the cash PIN check DEL-8's handover and replay call (plan 2.9), and the push token
// invalidation handler the worker registers with INT-4's registry (plan 2.11).
export { cashPinRules, PinCheck } from '../drivers/cash-pin.js';
export { driverPushInvalidation } from '../drivers/push-invalidation.js';
// DEL-1: `CoverageQueryPort` (plan 2.5; domain model §1.1): DEL-2's intake and WMS-7's pack bench
// ask which zone and sites cover a point in their own unit of work; `outsideCoverage` is the typed
// reason an uncovered address is refused with.
export {
  CoverageQuery,
  isCovered,
  outsideCoverage,
  type CoverageAnswer,
  type CoveragePoint,
} from '../zones/coverage-query.js';
// DEL-5: `ShiftQuery` (plan 2.2): the driver's live shift for DEL-6's offers (D-12) and DEL-7's
// driver transitions (D-6), in the caller's unit of work.
export { ShiftQuery, type LiveShift } from '../shifts/shift-query.js';
