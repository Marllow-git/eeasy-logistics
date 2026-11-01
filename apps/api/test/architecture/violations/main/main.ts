// Violation: a static import of the telemetry SDK from main.ts would load it for the migrate role
// too (rule main-loads-telemetry-lazily, PLAT-14 plan 2.1).
import { startTelemetry } from '../../../../src/modules/kernel/telemetry/sdk.js';

export const start = startTelemetry;
