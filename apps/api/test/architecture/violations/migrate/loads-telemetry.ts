// Violation: the migration job reaching the OpenTelemetry SDK (rule
// migrate-job-loads-no-application, PLAT-14 plan 2.1: the migrate role has no telemetry).
import { trace } from '@opentelemetry/api';

export const tracer = trace.getTracer('migrate');
